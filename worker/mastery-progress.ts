import { authenticateSession, type AuthenticatedUser } from './auth';

type AttemptErrorKind =
  | 'syntax'
  | 'schema'
  | 'runtime'
  | 'result-shape'
  | 'row-set'
  | 'ordering'
  | 'values'
  | 'null-filter'
  | 'aggregation'
  | 'join-cardinality';

type AttemptDiagnosticPayload = {
  kind: AttemptErrorKind;
  title: string;
  explanation: string;
  nextStep: string;
  atlasId?: string;
};

type TaskStatsPayload = {
  attempts: number;
  incorrect: number;
  hintsUsed: number;
  solutionViews?: number;
  independentPasses?: number;
  lastIndependentAt?: string;
  errorKinds?: Partial<Record<AttemptErrorKind, number>>;
  lastDiagnostic?: AttemptDiagnosticPayload;
  lastAttemptAt?: string;
  completedAt?: string;
};

type ProgressPayload = {
  version: 4;
  completed: string[];
  taskStats: Record<string, TaskStatsPayload>;
  xp: number;
  streak: number;
  history: Array<{ day: string; solved: number }>;
  lastTask?: string;
  lastStudyDate?: string;
};

const MAX_PROGRESS_BYTES = 200_000;
const TASK_ID_PATTERN = /^task-[0-9]{3}$/;
const ATTEMPT_ERROR_KINDS = new Set<AttemptErrorKind>([
  'syntax',
  'schema',
  'runtime',
  'result-shape',
  'row-set',
  'ordering',
  'values',
  'null-filter',
  'aggregation',
  'join-cardinality'
]);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  }
});

const boundedInteger = (value: unknown, max = 1_000_000) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

const boundedString = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max;

function validAttemptDiagnostic(value: unknown): value is AttemptDiagnosticPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const diagnostic = value as Partial<AttemptDiagnosticPayload>;
  return ATTEMPT_ERROR_KINDS.has(diagnostic.kind as AttemptErrorKind)
    && boundedString(diagnostic.title, 160)
    && boundedString(diagnostic.explanation, 1_200)
    && boundedString(diagnostic.nextStep, 1_200)
    && (diagnostic.atlasId === undefined || boundedString(diagnostic.atlasId, 120));
}

function validErrorKinds(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([kind, count]) =>
    ATTEMPT_ERROR_KINDS.has(kind as AttemptErrorKind) && boundedInteger(count, 10_000));
}

function validTaskStats(value: unknown): value is TaskStatsPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const stats = value as Partial<TaskStatsPayload>;
  return boundedInteger(stats.attempts, 10_000)
    && boundedInteger(stats.incorrect, 10_000)
    && boundedInteger(stats.hintsUsed, 10_000)
    && (stats.solutionViews === undefined || boundedInteger(stats.solutionViews, 10_000))
    && (stats.independentPasses === undefined || boundedInteger(stats.independentPasses, 10_000))
    && (stats.lastIndependentAt === undefined || boundedString(stats.lastIndependentAt, 80))
    && validErrorKinds(stats.errorKinds)
    && (stats.lastDiagnostic === undefined || validAttemptDiagnostic(stats.lastDiagnostic))
    && (stats.lastAttemptAt === undefined || boundedString(stats.lastAttemptAt, 80))
    && (stats.completedAt === undefined || boundedString(stats.completedAt, 80));
}

function validProgress(payload: unknown): payload is ProgressPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = payload as Partial<ProgressPayload>;
  if (value.version !== 4
    || !Array.isArray(value.completed)
    || !value.completed.every(item => typeof item === 'string' && TASK_ID_PATTERN.test(item))
    || !value.taskStats
    || typeof value.taskStats !== 'object'
    || Array.isArray(value.taskStats)
    || !boundedInteger(value.xp)
    || !boundedInteger(value.streak, 100_000)
    || !Array.isArray(value.history)
    || value.history.length > 31) return false;

  return value.history.every(point => point
      && typeof point.day === 'string'
      && point.day.length <= 16
      && boundedInteger(point.solved, 10_000))
    && Object.entries(value.taskStats).every(([taskId, stats]) => TASK_ID_PATTERN.test(taskId) && validTaskStats(stats))
    && (value.lastTask === undefined || TASK_ID_PATTERN.test(value.lastTask))
    && (value.lastStudyDate === undefined || boundedString(value.lastStudyDate, 80));
}

async function readJson(request: Request) {
  try {
    return await request.json<unknown>();
  } catch {
    return null;
  }
}

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function authenticatedProgress(
  request: Request,
  env: Cloudflare.Env,
  auth: AuthenticatedUser
) {
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT payload, revision, updated_at FROM progress WHERE profile_id = ?')
      .bind(auth.userId).first<{ payload: string; revision: number; updated_at: string }>();
    if (!row) return json({ progress: null, revision: 0, updatedAt: null });
    try {
      return json({ progress: JSON.parse(row.payload), revision: row.revision || 0, updatedAt: row.updated_at });
    } catch {
      return json({ error: 'Stored progress is corrupted' }, 500);
    }
  }

  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PUT' });
  const body = await readJson(request) as { progress?: unknown; baseRevision?: unknown } | null;
  if (!body || !validProgress(body.progress) || !boundedInteger(body.baseRevision, 1_000_000)) {
    return json({ error: 'Invalid progress sync payload' }, 400);
  }
  const baseRevision = Number(body.baseRevision);
  const serialized = JSON.stringify(body.progress);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROGRESS_BYTES) {
    return json({ error: 'Progress payload is too large' }, 413);
  }

  const updatedAt = sqliteTime();
  const nextRevision = baseRevision + 1;
  if (baseRevision === 0) {
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO progress(profile_id, payload, updated_at, revision)
      VALUES(?, ?, ?, 1)`).bind(auth.userId, serialized, updatedAt).run();
    if ((inserted.meta.changes || 0) !== 1) {
      const current = await env.DB.prepare('SELECT revision, updated_at FROM progress WHERE profile_id = ?')
        .bind(auth.userId).first<{ revision: number; updated_at: string }>();
      return json({ error: 'Progress conflict', revision: current?.revision || 0, updatedAt: current?.updated_at || null }, 409);
    }
  } else {
    const updated = await env.DB.prepare(`UPDATE progress SET payload = ?, updated_at = ?, revision = revision + 1
      WHERE profile_id = ? AND revision = ?`).bind(serialized, updatedAt, auth.userId, baseRevision).run();
    if ((updated.meta.changes || 0) !== 1) {
      const current = await env.DB.prepare('SELECT revision, updated_at FROM progress WHERE profile_id = ?')
        .bind(auth.userId).first<{ revision: number; updated_at: string }>();
      return json({ error: 'Progress conflict', revision: current?.revision || 0, updatedAt: current?.updated_at || null }, 409);
    }
  }
  return json({ ok: true, progress: body.progress, revision: nextRevision, updatedAt });
}

export async function handleMasteryProgressRequest(request: Request, env: Cloudflare.Env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/user/progress') return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);
  const auth = await authenticateSession(request, env);
  if (auth instanceof Response) return auth;
  return authenticatedProgress(request, env, auth);
}
