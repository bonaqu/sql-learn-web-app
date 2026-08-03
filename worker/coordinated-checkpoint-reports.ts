import {
  canonicalEvidenceJson,
  type CheckpointReportReceipt
} from '../src/lib/checkpoint-report-integrity';
import { isCoordinatedCheckpointId } from '../src/lib/checkpoint-attempt-reservation-contract';
import type { CheckpointReservationAuth } from './checkpoint-attempt-reservations';

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

type CoordinatedCheckpointReportPayload = {
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
  coordination: 'cloud';
  reservationId: string;
};

type StoredReportRow = {
  user_id: string;
  checkpoint_id: string;
  attempt_number: number;
  payload: string;
  payload_digest: string | null;
  persisted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ReservationRow = {
  reservation_id: string;
  report_id: string;
  user_id: string;
  checkpoint_id: string;
  attempt_number: number;
  status: CheckpointStatus | 'active';
  deadline_at: string;
  expires_at: string;
  completed_report_id: string | null;
};

const ID_PATTERN = /^[a-f0-9-]{16,80}$/i;
const TASK_ID_PATTERN = /^task-[0-9]{3}$/;
const MODULE_ID_PATTERN = /^[a-z0-9-]{2,64}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_REPORT_BYTES = 120_000;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }
});

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

function validReport(value: unknown): value is CoordinatedCheckpointReportPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Partial<CoordinatedCheckpointReportPayload>;
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
    && ID_PATTERN.test(report.id)
    && typeof report.userId === 'string'
    && ID_PATTERN.test(report.userId)
    && isCoordinatedCheckpointId(report.checkpointId)
    && (report.status === 'completed' || report.status === 'expired' || report.status === 'abandoned')
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
    && report.remediationModules.every(item => moduleIds.includes(item))
    && report.coordination === 'cloud'
    && typeof report.reservationId === 'string'
    && ID_PATTERN.test(report.reservationId);
}

async function parseBody(request: Request) {
  try {
    return await request.json<unknown>();
  } catch {
    return null;
  }
}

async function digestHex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function persistedAt(row: StoredReportRow, fallback: string) {
  for (const value of [row.persisted_at, row.created_at, row.updated_at, fallback]) {
    if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

function receipt(
  report: CoordinatedCheckpointReportPayload,
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

async function storedReport(env: Cloudflare.Env, reportId: string) {
  return env.DB.prepare(`SELECT user_id, checkpoint_id, attempt_number, payload,
      payload_digest, persisted_at, created_at, updated_at
    FROM checkpoint_reports WHERE id = ?`)
    .bind(reportId)
    .first<StoredReportRow>();
}

async function reservation(env: Cloudflare.Env, reservationId: string) {
  return env.DB.prepare(`SELECT reservation_id, report_id, user_id, checkpoint_id,
      attempt_number, status, deadline_at, expires_at, completed_report_id
    FROM checkpoint_attempt_reservations WHERE reservation_id = ?`)
    .bind(reservationId)
    .first<ReservationRow>();
}

async function immutableResponse(
  env: Cloudflare.Env,
  body: CoordinatedCheckpointReportPayload,
  incomingDigest: string,
  auth: CheckpointReservationAuth,
  replayed: boolean
) {
  const stored = await storedReport(env, body.id);
  const reserved = await reservation(env, body.reservationId);
  if (!stored || !reserved) return json({
    error: 'Coordinated checkpoint report was not persisted',
    code: 'CHECKPOINT_ATTEMPT_BINDING_MISMATCH',
    reportId: body.id
  }, 409);
  if (stored.user_id !== auth.userId || reserved.user_id !== auth.userId) {
    return json({ error: 'Checkpoint owner mismatch' }, 403);
  }
  let parsed: CoordinatedCheckpointReportPayload | null = null;
  try {
    const candidate = JSON.parse(stored.payload) as unknown;
    parsed = validReport(candidate) ? candidate : null;
  } catch {
    parsed = null;
  }
  if (!parsed) return json({
    error: 'Stored coordinated checkpoint report is invalid',
    code: 'CHECKPOINT_REPORT_STORED_INVALID',
    reportId: body.id
  }, 409);
  const storedDigest = stored.payload_digest && DIGEST_PATTERN.test(stored.payload_digest)
    ? stored.payload_digest.toLowerCase()
    : await digestHex(canonicalEvidenceJson(parsed));
  if (storedDigest !== incomingDigest) return json({
    error: 'Completed checkpoint report is immutable',
    code: 'CHECKPOINT_REPORT_CONFLICT',
    reportId: body.id
  }, 409);
  if (reserved.report_id !== body.id
    || reserved.checkpoint_id !== body.checkpointId
    || reserved.attempt_number !== body.attemptNumber
    || reserved.completed_report_id !== body.id
    || reserved.status !== body.status) {
    return json({
      error: 'Checkpoint reservation does not match the completed report',
      code: 'CHECKPOINT_ATTEMPT_BINDING_MISMATCH',
      reportId: body.id
    }, 409);
  }
  const receiptTime = persistedAt(stored, parsed.completedAt);
  if (stored.payload_digest !== storedDigest || !stored.persisted_at) {
    await env.DB.prepare(`UPDATE checkpoint_reports
      SET payload_digest = ?, persisted_at = COALESCE(persisted_at, ?)
      WHERE id = ? AND user_id = ?`)
      .bind(storedDigest, receiptTime, body.id, auth.userId)
      .run();
  }
  return json({ ok: true, replayed, coordinated: true, receipt: receipt(parsed, storedDigest, receiptTime) });
}

export async function handleCoordinatedCheckpointReportRequest(
  request: Request,
  env: Cloudflare.Env,
  auth: CheckpointReservationAuth
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/checkpoints/reports' || request.method !== 'POST') return null;
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_REPORT_BYTES) {
    return json({ error: 'Checkpoint report is too large' }, 413);
  }
  const value = await parseBody(request.clone());
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (value as { coordination?: unknown }).coordination !== 'cloud') return null;
  if (!validReport(value)) return json({
    error: 'Invalid coordinated checkpoint report',
    code: 'CHECKPOINT_ATTEMPT_BINDING_MISMATCH'
  }, 400);
  const body = value;
  if (body.userId !== auth.userId) return json({ error: 'Checkpoint owner mismatch' }, 403);
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPORT_BYTES) {
    return json({ error: 'Checkpoint report is too large' }, 413);
  }
  const incomingDigest = await digestHex(canonicalEvidenceJson(body));
  const existing = await storedReport(env, body.id);
  if (existing) return immutableResponse(env, body, incomingDigest, auth, true);

  const reserved = await reservation(env, body.reservationId);
  if (!reserved
    || reserved.user_id !== auth.userId
    || reserved.report_id !== body.id
    || reserved.checkpoint_id !== body.checkpointId
    || reserved.attempt_number !== body.attemptNumber) {
    return json({
      error: 'Checkpoint reservation does not match this report',
      code: 'CHECKPOINT_ATTEMPT_BINDING_MISMATCH',
      reportId: body.id
    }, 409);
  }
  const now = new Date().toISOString();
  if (reserved.status !== 'active' || reserved.completed_report_id) {
    return immutableResponse(env, body, incomingDigest, auth, true);
  }
  if (body.status === 'completed' && reserved.expires_at <= now) {
    return json({
      error: 'Checkpoint reservation expired before completion',
      code: 'CHECKPOINT_ATTEMPT_EXPIRED',
      reportId: body.id
    }, 409);
  }
  if (body.status === 'expired' && reserved.deadline_at > body.completedAt) {
    return json({
      error: 'Checkpoint cannot expire before its reserved deadline',
      code: 'CHECKPOINT_ATTEMPT_BINDING_MISMATCH',
      reportId: body.id
    }, 409);
  }

  const receiptTime = now;
  const [inserted] = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO checkpoint_reports(
      id, user_id, checkpoint_id, status, started_at, completed_at, duration_seconds,
      attempt_number, score, best_score, passed, payload, payload_digest, persisted_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM checkpoint_attempt_reservations
    WHERE reservation_id = ? AND user_id = ? AND checkpoint_id = ?
      AND report_id = ? AND attempt_number = ? AND status = 'active'
      AND completed_report_id IS NULL
      AND (? <> 'completed' OR expires_at > ?)
      AND (? <> 'expired' OR deadline_at <= ?)`)
      .bind(
        body.id,
        auth.userId,
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
        receiptTime,
        body.reservationId,
        auth.userId,
        body.checkpointId,
        body.id,
        body.attemptNumber,
        body.status,
        now,
        body.status,
        body.completedAt
      ),
    env.DB.prepare(`UPDATE checkpoint_attempt_reservations
      SET status = ?, completed_report_id = ?, updated_at = ?
      WHERE reservation_id = ? AND user_id = ? AND checkpoint_id = ?
        AND report_id = ? AND attempt_number = ? AND status = 'active'
        AND completed_report_id IS NULL
        AND EXISTS (
          SELECT 1 FROM checkpoint_reports
          WHERE id = ? AND user_id = ? AND checkpoint_id = ?
            AND attempt_number = ? AND payload_digest = ?
        )`)
      .bind(
        body.status,
        body.id,
        now,
        body.reservationId,
        auth.userId,
        body.checkpointId,
        body.id,
        body.attemptNumber,
        body.id,
        auth.userId,
        body.checkpointId,
        body.attemptNumber,
        incomingDigest
      )
  ]);

  return immutableResponse(env, body, incomingDigest, auth, inserted.meta.changes !== 1);
}
