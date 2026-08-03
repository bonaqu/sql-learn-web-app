type CheckpointStatus = 'completed' | 'expired' | 'abandoned';

type CheckpointTaskScore = {
  taskId: string;
  title: string;
  module: string;
  correct: boolean;
  skipped: boolean;
  attempts: number;
  elapsedSeconds: number;
  score: number;
};

type CheckpointModuleScore = {
  module: string;
  title: string;
  score: number;
  correct: number;
  total: number;
};

type CheckpointReportPayload = {
  version: 1;
  id: string;
  userId: string;
  checkpointId: string;
  status: CheckpointStatus;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  attemptNumber: number;
  score: number;
  bestScore: number;
  passingScore: number;
  passed: boolean;
  accuracy: number;
  firstAttemptRate: number;
  independence: number;
  taskScores: CheckpointTaskScore[];
  moduleScores: CheckpointModuleScore[];
  remediationModules: string[];
};

const CHECKPOINT_IDS = new Set([
  'checkpoint-foundation',
  'checkpoint-query-design',
  'checkpoint-production',
  'checkpoint-support-readiness',
  'checkpoint-data-change',
  'checkpoint-advanced-querying',
  'checkpoint-modern-sql',
  'checkpoint-production-operations'
]);
const STATUSES = new Set<CheckpointStatus>(['completed', 'expired', 'abandoned']);
const REPORT_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const USER_ID_PATTERN = /^[a-f0-9-]{16,80}$/i;
const TASK_ID_PATTERN = /^task-[0-9]{3}$/;
const MODULE_ID_PATTERN = /^[a-z0-9-]{2,64}$/;
const MAX_REPORT_BYTES = 120_000;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  }
});

function bodyTooLarge(request: Request, maximum: number) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > maximum;
}

async function readJson(request: Request) {
  try {
    return await request.json<unknown>();
  } catch {
    return null;
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function shortText(value: unknown, maximum: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function validIsoDate(value: unknown) {
  return shortText(value, 64) && Number.isFinite(Date.parse(value as string));
}

function uniqueStrings(values: string[]) {
  return new Set(values).size === values.length;
}

function validTaskScore(value: unknown): value is CheckpointTaskScore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const score = value as Partial<CheckpointTaskScore>;
  return typeof score.taskId === 'string'
    && TASK_ID_PATTERN.test(score.taskId)
    && shortText(score.title, 240)
    && typeof score.module === 'string'
    && MODULE_ID_PATTERN.test(score.module)
    && typeof score.correct === 'boolean'
    && typeof score.skipped === 'boolean'
    && !(score.correct && score.skipped)
    && boundedInteger(score.attempts, 0, 1_000)
    && boundedInteger(score.elapsedSeconds, 0, 86_400)
    && boundedInteger(score.score, 0, 100)
    && (!score.correct || (score.attempts ?? 0) >= 1)
    && (score.correct || score.score === 0);
}

function validModuleScore(value: unknown): value is CheckpointModuleScore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const score = value as Partial<CheckpointModuleScore>;
  return typeof score.module === 'string'
    && MODULE_ID_PATTERN.test(score.module)
    && shortText(score.title, 160)
    && boundedInteger(score.score, 0, 100)
    && boundedInteger(score.correct, 0, 8)
    && boundedInteger(score.total, 1, 8)
    && (score.correct ?? 0) <= (score.total ?? 0);
}

function validReport(value: unknown): value is CheckpointReportPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Partial<CheckpointReportPayload>;
  if (!Array.isArray(report.taskScores)
    || report.taskScores.length < 1
    || report.taskScores.length > 8
    || !report.taskScores.every(validTaskScore)) return false;
  if (!Array.isArray(report.moduleScores)
    || report.moduleScores.length < 1
    || report.moduleScores.length > 8
    || !report.moduleScores.every(validModuleScore)) return false;
  if (!Array.isArray(report.remediationModules)
    || report.remediationModules.length > 8
    || !report.remediationModules.every(item => typeof item === 'string' && MODULE_ID_PATTERN.test(item))) return false;

  const taskIds = report.taskScores.map(item => item.taskId);
  const moduleIds = report.moduleScores.map(item => item.module);
  const taskModules = new Set(report.taskScores.map(item => item.module));
  const startedAt = typeof report.startedAt === 'string' ? Date.parse(report.startedAt) : NaN;
  const completedAt = typeof report.completedAt === 'string' ? Date.parse(report.completedAt) : NaN;

  return report.version === 1
    && typeof report.id === 'string'
    && REPORT_ID_PATTERN.test(report.id)
    && typeof report.userId === 'string'
    && USER_ID_PATTERN.test(report.userId)
    && typeof report.checkpointId === 'string'
    && CHECKPOINT_IDS.has(report.checkpointId)
    && STATUSES.has(report.status as CheckpointStatus)
    && validIsoDate(report.startedAt)
    && validIsoDate(report.completedAt)
    && completedAt >= startedAt
    && boundedInteger(report.durationSeconds, 0, 86_400)
    && boundedInteger(report.attemptNumber, 1, 1_000)
    && boundedInteger(report.score, 0, 100)
    && boundedInteger(report.bestScore, 0, 100)
    && (report.bestScore ?? 0) >= (report.score ?? 0)
    && boundedInteger(report.passingScore, 50, 100)
    && typeof report.passed === 'boolean'
    && report.passed === (report.status === 'completed' && (report.score ?? 0) >= (report.passingScore ?? 101))
    && boundedInteger(report.accuracy, 0, 100)
    && boundedInteger(report.firstAttemptRate, 0, 100)
    && boundedInteger(report.independence, 0, 100)
    && uniqueStrings(taskIds)
    && uniqueStrings(moduleIds)
    && report.moduleScores.every(item => taskModules.has(item.module))
    && report.taskScores.every(item => moduleIds.includes(item.module))
    && uniqueStrings(report.remediationModules)
    && report.remediationModules.every(item => moduleIds.includes(item));
}

async function listReports(env: Cloudflare.Env, userId: string) {
  const rows = await env.DB.prepare(`SELECT payload FROM checkpoint_reports
    WHERE user_id = ?
    ORDER BY completed_at DESC, attempt_number DESC, id DESC
    LIMIT 50`)
    .bind(userId)
    .all<{ payload: string }>();
  const reports = rows.results.flatMap(row => {
    try {
      const parsed = JSON.parse(row.payload) as CheckpointReportPayload;
      return validReport(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
  return json({ reports });
}

async function saveReport(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request, MAX_REPORT_BYTES)) return json({ error: 'Checkpoint report is too large' }, 413);
  const body = await readJson(request);
  if (!validReport(body)) return json({ error: 'Invalid checkpoint report' }, 400);
  if (body.userId !== userId) return json({ error: 'Checkpoint owner mismatch' }, 403);
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPORT_BYTES) return json({ error: 'Checkpoint report is too large' }, 413);

  const existing = await env.DB.prepare('SELECT user_id FROM checkpoint_reports WHERE id = ?')
    .bind(body.id)
    .first<{ user_id: string }>();
  if (existing && existing.user_id !== userId) return json({ error: 'Checkpoint owner mismatch' }, 403);

  if (existing) {
    await env.DB.prepare(`UPDATE checkpoint_reports SET
      checkpoint_id = ?, status = ?, started_at = ?, completed_at = ?, duration_seconds = ?,
      attempt_number = ?, score = ?, best_score = ?, passed = ?, payload = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`)
      .bind(
        body.checkpointId,
        body.status,
        body.startedAt,
        body.completedAt,
        body.durationSeconds,
        body.attemptNumber,
        body.score,
        body.bestScore,
        body.passed ? 1 : 0,
        serialized,
        body.id,
        userId
      )
      .run();
  } else {
    await env.DB.prepare(`INSERT INTO checkpoint_reports(
      id, user_id, checkpoint_id, status, started_at, completed_at, duration_seconds,
      attempt_number, score, best_score, passed, payload
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        body.id,
        userId,
        body.checkpointId,
        body.status,
        body.startedAt,
        body.completedAt,
        body.durationSeconds,
        body.attemptNumber,
        body.score,
        body.bestScore,
        body.passed ? 1 : 0,
        serialized
      )
      .run();
  }
  return json({ ok: true });
}

export async function handleCheckpointRequest(request: Request, env: Cloudflare.Env, userId: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/checkpoints')) return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (url.pathname === '/api/checkpoints/reports') {
    if (request.method === 'GET') return listReports(env, userId);
    if (request.method === 'POST') return saveReport(request, env, userId);
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET, POST' });
  }
  return json({ error: 'Not found' }, 404);
}
