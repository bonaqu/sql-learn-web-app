import {
  canonicalEvidenceJson,
  type CheckpointReportReceipt
} from '../src/lib/checkpoint-report-integrity';

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

type StoredCheckpointReport = {
  user_id: string;
  checkpoint_id: string;
  payload: string;
  payload_digest: string | null;
  persisted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ListedCheckpointReport = {
  payload: string;
  payload_digest: string | null;
  persisted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
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
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
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

function persistedAt(...candidates: Array<string | null | undefined>) {
  for (const value of candidates) {
    if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

async function digestHex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function reportDigest(report: CheckpointReportPayload) {
  return digestHex(canonicalEvidenceJson(report));
}

function receipt(
  report: CheckpointReportPayload,
  payloadDigest: string,
  receiptTime: string
): CheckpointReportReceipt {
  return {
    version: 1,
    reportId: report.id,
    checkpointId: report.checkpointId,
    persistedAt: receiptTime,
    payloadDigest
  };
}

async function listReports(env: Cloudflare.Env, userId: string) {
  const rows = await env.DB.prepare(`SELECT payload, payload_digest, persisted_at, created_at, updated_at
    FROM checkpoint_reports
    WHERE user_id = ?
    ORDER BY completed_at DESC, attempt_number DESC, id DESC
    LIMIT 50`)
    .bind(userId)
    .all<ListedCheckpointReport>();
  const reports: CheckpointReportPayload[] = [];
  const receipts: CheckpointReportReceipt[] = [];
  for (const row of rows.results) {
    try {
      const parsed = JSON.parse(row.payload) as CheckpointReportPayload;
      if (!validReport(parsed)) continue;
      const payloadDigest = row.payload_digest && DIGEST_PATTERN.test(row.payload_digest)
        ? row.payload_digest.toLowerCase()
        : await reportDigest(parsed);
      const receiptTime = persistedAt(row.persisted_at, row.created_at, row.updated_at, parsed.completedAt);
      reports.push(parsed);
      receipts.push(receipt(parsed, payloadDigest, receiptTime));
    } catch {
      // Ignore malformed legacy rows rather than exposing stored payload details.
    }
  }
  return json({ reports, receipts });
}

async function saveReport(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request, MAX_REPORT_BYTES)) return json({ error: 'Checkpoint report is too large' }, 413);
  const body = await readJson(request);
  if (!validReport(body)) return json({ error: 'Invalid checkpoint report' }, 400);
  if (body.userId !== userId) return json({ error: 'Checkpoint owner mismatch' }, 403);
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPORT_BYTES) return json({ error: 'Checkpoint report is too large' }, 413);
  const incomingDigest = await reportDigest(body);

  const existing = await env.DB.prepare(`SELECT
      user_id, checkpoint_id, payload, payload_digest, persisted_at, created_at, updated_at
    FROM checkpoint_reports WHERE id = ?`)
    .bind(body.id)
    .first<StoredCheckpointReport>();
  if (existing && existing.user_id !== userId) return json({ error: 'Checkpoint owner mismatch' }, 403);

  if (existing) {
    let storedReport: CheckpointReportPayload | null = null;
    try {
      const parsed = JSON.parse(existing.payload) as unknown;
      storedReport = validReport(parsed) ? parsed : null;
    } catch {
      storedReport = null;
    }
    if (!storedReport || existing.checkpoint_id !== body.checkpointId) {
      return json({
        error: 'Stored checkpoint report cannot be replayed safely',
        code: 'CHECKPOINT_REPORT_STORED_INVALID',
        reportId: body.id
      }, 409);
    }
    const storedDigest = existing.payload_digest && DIGEST_PATTERN.test(existing.payload_digest)
      ? existing.payload_digest.toLowerCase()
      : await reportDigest(storedReport);
    if (storedDigest !== incomingDigest) {
      return json({
        error: 'Completed checkpoint report is immutable',
        code: 'CHECKPOINT_REPORT_CONFLICT',
        reportId: body.id
      }, 409);
    }
    const receiptTime = persistedAt(existing.persisted_at, existing.created_at, existing.updated_at, storedReport.completedAt);
    if (existing.payload_digest !== storedDigest || !existing.persisted_at) {
      await env.DB.prepare(`UPDATE checkpoint_reports
        SET payload_digest = ?, persisted_at = COALESCE(persisted_at, ?)
        WHERE id = ? AND user_id = ?`)
        .bind(storedDigest, receiptTime, body.id, userId)
        .run();
    }
    return json({
      ok: true,
      replayed: true,
      receipt: receipt(storedReport, storedDigest, receiptTime)
    });
  }

  const receiptTime = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO checkpoint_reports(
    id, user_id, checkpoint_id, status, started_at, completed_at, duration_seconds,
    attempt_number, score, best_score, passed, payload, payload_digest, persisted_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
      serialized,
      incomingDigest,
      receiptTime
    )
    .run();
  return json({
    ok: true,
    replayed: false,
    receipt: receipt(body, incomingDigest, receiptTime)
  });
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
