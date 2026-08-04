import {
  CHECKPOINT_PROVISIONAL_ADOPTION_CODES,
  CHECKPOINT_PROVISIONAL_ADOPTION_ENDPOINT,
  canonicalProvisionalCheckpointEvidenceJson,
  isProvisionalCheckpointReport,
  projectAdoptedCheckpointReport,
  type CheckpointProvisionalAdoptionReceipt,
  type ProvisionalCheckpointReport
} from '../src/lib/checkpoint-provisional-reconciliation-contract';
import { canonicalEvidenceJson } from '../src/lib/checkpoint-report-integrity';
import { isCoordinatedCheckpointId } from '../src/lib/checkpoint-attempt-reservation-contract';
import type { CheckpointReservationAuth } from './checkpoint-attempt-reservations';

type CheckpointTaskScore = ProvisionalCheckpointReport['taskScores'][number];
type CheckpointModuleScore = ProvisionalCheckpointReport['moduleScores'][number];

type AdoptionRow = {
  report_id: string;
  user_id: string;
  checkpoint_id: string;
  provisional_attempt_number: number;
  canonical_attempt_number: number;
  evidence_digest: string;
  adopted_at: string;
  payload: string;
  payload_digest: string | null;
  persisted_at: string | null;
};

type ExistingReportRow = {
  id: string;
  user_id: string;
  checkpoint_id: string;
  payload_digest: string | null;
};

type ActiveReservationRow = {
  reservation_id: string;
};

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

function bodyTooLarge(request: Request) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > MAX_REPORT_BYTES;
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

function validProvisionalReport(value: unknown): value is ProvisionalCheckpointReport {
  if (!isProvisionalCheckpointReport(value)) return false;
  const report = value;
  if (!isCoordinatedCheckpointId(report.checkpointId)) return false;
  if (report.taskScores.length < 1
    || report.taskScores.length > 8
    || !report.taskScores.every(validTaskScore)) return false;
  if (report.moduleScores.length < 1
    || report.moduleScores.length > 8
    || !report.moduleScores.every(validModuleScore)) return false;
  if (report.remediationModules.length > 8
    || !report.remediationModules.every(item => MODULE_ID_PATTERN.test(item))) return false;

  const taskIds = report.taskScores.map(item => item.taskId);
  const moduleIds = report.moduleScores.map(item => item.module);
  const taskModules = new Set(report.taskScores.map(item => item.module));
  const startedAt = Date.parse(report.startedAt);
  const completedAt = Date.parse(report.completedAt);

  return completedAt >= startedAt
    && boundedInteger(report.durationSeconds, 0, 86_400)
    && boundedInteger(report.bestScore, 0, 100)
    && report.bestScore >= report.score
    && boundedInteger(report.passingScore, 50, 100)
    && report.passed === (report.status === 'completed' && report.score >= report.passingScore)
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

async function digestHex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function adoptionByReport(env: Cloudflare.Env, reportId: string) {
  return env.DB.prepare(`SELECT
      a.report_id, a.user_id, a.checkpoint_id, a.provisional_attempt_number,
      a.canonical_attempt_number, a.evidence_digest, a.adopted_at,
      r.payload, r.payload_digest, r.persisted_at
    FROM checkpoint_provisional_adoptions a
    JOIN checkpoint_reports r ON r.id = a.report_id
    WHERE a.report_id = ?`)
    .bind(reportId)
    .first<AdoptionRow>();
}

async function existingReport(env: Cloudflare.Env, reportId: string) {
  return env.DB.prepare(`SELECT id, user_id, checkpoint_id, payload_digest
    FROM checkpoint_reports WHERE id = ?`)
    .bind(reportId)
    .first<ExistingReportRow>();
}

async function activeReservation(env: Cloudflare.Env, userId: string, checkpointId: string) {
  return env.DB.prepare(`SELECT reservation_id
    FROM checkpoint_attempt_reservations
    WHERE user_id = ? AND checkpoint_id = ? AND status = 'active'
    ORDER BY started_at DESC, reservation_id DESC
    LIMIT 1`)
    .bind(userId, checkpointId)
    .first<ActiveReservationRow>();
}

function adoptionReceipt(row: AdoptionRow): CheckpointProvisionalAdoptionReceipt {
  return {
    version: 1,
    reportId: row.report_id,
    checkpointId: row.checkpoint_id,
    provisionalAttemptNumber: row.provisional_attempt_number,
    canonicalAttemptNumber: row.canonical_attempt_number,
    adoptedAt: new Date(row.adopted_at).toISOString(),
    evidenceDigest: row.evidence_digest.toLowerCase()
  };
}

async function adoptionResponse(
  row: AdoptionRow,
  incoming: ProvisionalCheckpointReport,
  incomingPayloadDigest: string,
  incomingEvidenceDigest: string,
  auth: CheckpointReservationAuth,
  replayed: boolean
) {
  if (row.user_id !== auth.userId) {
    return json({ error: 'Checkpoint provisional report owner mismatch' }, 403);
  }
  if (row.checkpoint_id !== incoming.checkpointId
    || row.provisional_attempt_number !== incoming.attemptNumber
    || !DIGEST_PATTERN.test(row.evidence_digest)
    || row.evidence_digest.toLowerCase() !== incomingEvidenceDigest
    || !row.payload_digest
    || row.payload_digest.toLowerCase() !== incomingPayloadDigest) {
    return json({
      error: 'Provisional checkpoint report conflicts with adopted evidence',
      code: CHECKPOINT_PROVISIONAL_ADOPTION_CODES.conflict,
      reportId: incoming.id,
      checkpointId: incoming.checkpointId
    }, 409);
  }

  let stored: ProvisionalCheckpointReport | null = null;
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    stored = validProvisionalReport(parsed) ? parsed : null;
  } catch {
    stored = null;
  }
  if (!stored) {
    return json({
      error: 'Stored provisional checkpoint report is invalid',
      code: CHECKPOINT_PROVISIONAL_ADOPTION_CODES.storedInvalid,
      reportId: incoming.id
    }, 409);
  }
  const receipt = adoptionReceipt(row);
  return json({
    ok: true,
    replayed,
    report: projectAdoptedCheckpointReport(stored, receipt),
    receipt
  });
}

function activeConflict(report: ProvisionalCheckpointReport, active: ActiveReservationRow) {
  return json({
    error: 'A cloud checkpoint attempt is active for this checkpoint',
    code: CHECKPOINT_PROVISIONAL_ADOPTION_CODES.activeAttempt,
    reportId: report.id,
    checkpointId: report.checkpointId,
    activeReservationId: active.reservation_id
  }, 409);
}

async function adoptProvisionalReport(
  request: Request,
  env: Cloudflare.Env,
  auth: CheckpointReservationAuth
) {
  if (bodyTooLarge(request)) return json({ error: 'Provisional checkpoint report is too large' }, 413);
  const value = await readJson(request);
  if (!validProvisionalReport(value)) {
    return json({
      error: 'Invalid provisional checkpoint report',
      code: CHECKPOINT_PROVISIONAL_ADOPTION_CODES.invalid
    }, 400);
  }
  const report = value;
  if (report.userId !== auth.userId) {
    return json({
      error: 'Checkpoint provisional report owner mismatch',
      code: CHECKPOINT_PROVISIONAL_ADOPTION_CODES.ownerMismatch,
      reportId: report.id
    }, 403);
  }

  const serialized = JSON.stringify(report);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPORT_BYTES) {
    return json({ error: 'Provisional checkpoint report is too large' }, 413);
  }
  const payloadDigest = await digestHex(canonicalEvidenceJson(report));
  const evidenceDigest = await digestHex(canonicalProvisionalCheckpointEvidenceJson(report));

  const existingAdoption = await adoptionByReport(env, report.id);
  if (existingAdoption) {
    return adoptionResponse(
      existingAdoption,
      report,
      payloadDigest,
      evidenceDigest,
      auth,
      true
    );
  }

  const collision = await existingReport(env, report.id);
  if (collision) {
    return json({
      error: 'Checkpoint report ID already belongs to different cloud evidence',
      code: CHECKPOINT_PROVISIONAL_ADOPTION_CODES.conflict,
      reportId: report.id,
      checkpointId: report.checkpointId
    }, collision.user_id === auth.userId ? 409 : 403);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE checkpoint_attempt_reservations
    SET status = 'expired', updated_at = ?
    WHERE user_id = ? AND checkpoint_id = ? AND status = 'active' AND expires_at <= ?`)
    .bind(now, auth.userId, report.checkpointId, now)
    .run();

  const active = await activeReservation(env, auth.userId, report.checkpointId);
  if (active) return activeConflict(report, active);

  let insertedChanges = 0;
  try {
    const [inserted] = await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO checkpoint_reports(
        id, user_id, checkpoint_id, status, started_at, completed_at, duration_seconds,
        attempt_number, score, best_score, passed, payload, payload_digest, persisted_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?,
        COALESCE((
          SELECT MAX(attempt_number) FROM (
            SELECT attempt_number FROM checkpoint_reports WHERE user_id = ? AND checkpoint_id = ?
            UNION ALL
            SELECT attempt_number FROM checkpoint_attempt_reservations WHERE user_id = ? AND checkpoint_id = ?
          )
        ), 0) + 1,
        ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM checkpoint_attempt_reservations
        WHERE user_id = ? AND checkpoint_id = ? AND status = 'active'
      )
      AND NOT EXISTS (SELECT 1 FROM checkpoint_reports WHERE id = ?)`)
        .bind(
          report.id,
          auth.userId,
          report.checkpointId,
          report.status,
          report.startedAt,
          report.completedAt,
          report.durationSeconds,
          auth.userId,
          report.checkpointId,
          auth.userId,
          report.checkpointId,
          report.score,
          report.bestScore,
          report.passed ? 1 : 0,
          serialized,
          payloadDigest,
          now,
          auth.userId,
          report.checkpointId,
          report.id
        ),
      env.DB.prepare(`INSERT OR IGNORE INTO checkpoint_provisional_adoptions(
        report_id, user_id, checkpoint_id, provisional_attempt_number,
        canonical_attempt_number, evidence_digest, adopted_at
      )
      SELECT r.id, r.user_id, r.checkpoint_id, ?, r.attempt_number, ?, ?
      FROM checkpoint_reports r
      WHERE r.id = ? AND r.user_id = ? AND r.checkpoint_id = ?
        AND r.payload_digest = ? AND r.payload = ?
        AND NOT EXISTS (
          SELECT 1 FROM checkpoint_attempt_reservations
          WHERE user_id = ? AND checkpoint_id = ? AND status = 'active'
        )`)
        .bind(
          report.attemptNumber,
          evidenceDigest,
          now,
          report.id,
          auth.userId,
          report.checkpointId,
          payloadDigest,
          serialized,
          auth.userId,
          report.checkpointId
        ),
      env.DB.prepare(`INSERT INTO checkpoint_provisional_adoption_commits(report_id, committed_at)
      VALUES((
        SELECT a.report_id
        FROM checkpoint_provisional_adoptions a
        JOIN checkpoint_reports r ON r.id = a.report_id
        WHERE a.report_id = ? AND a.user_id = ? AND a.checkpoint_id = ?
          AND a.provisional_attempt_number = ? AND a.evidence_digest = ?
          AND r.payload_digest = ? AND r.payload = ?
      ), ?)
      ON CONFLICT(report_id) DO NOTHING`)
        .bind(
          report.id,
          auth.userId,
          report.checkpointId,
          report.attemptNumber,
          evidenceDigest,
          payloadDigest,
          serialized,
          now
        )
    ]);
    insertedChanges = inserted.meta.changes;
  } catch {
    const afterRace = await adoptionByReport(env, report.id);
    if (afterRace) {
      return adoptionResponse(afterRace, report, payloadDigest, evidenceDigest, auth, true);
    }
    const racedActive = await activeReservation(env, auth.userId, report.checkpointId);
    if (racedActive) return activeConflict(report, racedActive);
    return json({
      error: 'Provisional checkpoint report could not be adopted safely',
      code: CHECKPOINT_PROVISIONAL_ADOPTION_CODES.conflict,
      reportId: report.id,
      checkpointId: report.checkpointId
    }, 409);
  }

  const adopted = await adoptionByReport(env, report.id);
  if (!adopted) {
    return json({
      error: 'Provisional checkpoint adoption receipt was not persisted',
      code: CHECKPOINT_PROVISIONAL_ADOPTION_CODES.storedInvalid,
      reportId: report.id
    }, 409);
  }
  return adoptionResponse(
    adopted,
    report,
    payloadDigest,
    evidenceDigest,
    auth,
    insertedChanges !== 1
  );
}

export async function handleCheckpointProvisionalAdoptionRequest(
  request: Request,
  env: Cloudflare.Env,
  auth: CheckpointReservationAuth
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== CHECKPOINT_PROVISIONAL_ADOPTION_ENDPOINT) return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);
  if (request.method === 'POST') return adoptProvisionalReport(request, env, auth);
  return json({ error: 'Method not allowed' }, 405, { allow: 'POST' });
}
