import {
  CHECKPOINT_ATTEMPT_GRACE_MINUTES,
  checkpointDurationMinutesFromContract,
  isCoordinatedCheckpointId,
  validCheckpointClientRequestId,
  type CheckpointAttemptReservation,
  type CheckpointAttemptReservationResponse,
  type CheckpointAttemptReservationStatus,
  type CoordinatedCheckpointId
} from '../src/lib/checkpoint-attempt-reservation-contract';
import { handleCheckpointProvisionalAdoptionRequest } from './checkpoint-provisional-adoptions';

export type CheckpointReservationAuth = {
  userId: string;
  sessionId: string;
  deviceName: string;
};

type ReservationRow = {
  reservation_id: string;
  report_id: string;
  checkpoint_id: string;
  client_request_id: string;
  attempt_number: number;
  status: CheckpointAttemptReservationStatus;
  started_at: string;
  deadline_at: string;
  expires_at: string;
  session_id: string;
  device_name: string;
};

const MAX_BODY_BYTES = 4_096;

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
  return Number.isFinite(length) && length > MAX_BODY_BYTES;
}

async function readJson(request: Request) {
  try {
    return await request.json<unknown>();
  } catch {
    return null;
  }
}

function cleanDeviceName(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 64) || 'Браузер';
}

function toReservation(row: ReservationRow, auth: CheckpointReservationAuth): CheckpointAttemptReservation {
  return {
    version: 1,
    reservationId: row.reservation_id,
    reportId: row.report_id,
    checkpointId: row.checkpoint_id as CoordinatedCheckpointId,
    clientRequestId: row.client_request_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    expiresAt: row.expires_at,
    deviceName: row.device_name,
    ownedByCurrentSession: row.session_id === auth.sessionId
  };
}

function response(
  reservation: CheckpointAttemptReservation,
  created: boolean,
  replayed: boolean,
  activeElsewhere: boolean
): CheckpointAttemptReservationResponse {
  return { reservation, created, replayed, activeElsewhere };
}

async function expireStale(
  env: Cloudflare.Env,
  userId: string,
  checkpointId: CoordinatedCheckpointId,
  now: string
) {
  await env.DB.prepare(`UPDATE checkpoint_attempt_reservations
    SET status = 'expired', updated_at = ?
    WHERE user_id = ? AND checkpoint_id = ? AND status = 'active' AND expires_at <= ?`)
    .bind(now, userId, checkpointId, now)
    .run();
}

async function reservationByRequest(
  env: Cloudflare.Env,
  auth: CheckpointReservationAuth,
  checkpointId: CoordinatedCheckpointId,
  clientRequestId: string
) {
  const row = await env.DB.prepare(`SELECT
      reservation_id, report_id, checkpoint_id, client_request_id, attempt_number,
      status, started_at, deadline_at, expires_at, session_id, device_name
    FROM checkpoint_attempt_reservations
    WHERE user_id = ? AND checkpoint_id = ? AND client_request_id = ?`)
    .bind(auth.userId, checkpointId, clientRequestId)
    .first<ReservationRow>();
  return row ? toReservation(row, auth) : null;
}

async function activeReservation(
  env: Cloudflare.Env,
  auth: CheckpointReservationAuth,
  checkpointId: CoordinatedCheckpointId
) {
  const row = await env.DB.prepare(`SELECT
      reservation_id, report_id, checkpoint_id, client_request_id, attempt_number,
      status, started_at, deadline_at, expires_at, session_id, device_name
    FROM checkpoint_attempt_reservations
    WHERE user_id = ? AND checkpoint_id = ? AND status = 'active'
    ORDER BY started_at DESC, reservation_id DESC
    LIMIT 1`)
    .bind(auth.userId, checkpointId)
    .first<ReservationRow>();
  return row ? toReservation(row, auth) : null;
}

async function reserveAttempt(
  request: Request,
  env: Cloudflare.Env,
  auth: CheckpointReservationAuth
) {
  if (bodyTooLarge(request)) return json({ error: 'Checkpoint reservation request is too large' }, 413);
  const body = await readJson(request) as { checkpointId?: unknown; clientRequestId?: unknown } | null;
  if (!body
    || !isCoordinatedCheckpointId(body.checkpointId)
    || !validCheckpointClientRequestId(body.clientRequestId)) {
    return json({
      error: 'Invalid checkpoint reservation request',
      code: 'CHECKPOINT_ATTEMPT_INVALID'
    }, 400);
  }

  const checkpointId = body.checkpointId;
  const clientRequestId = body.clientRequestId;
  const durationMinutes = checkpointDurationMinutesFromContract(checkpointId);
  if (!durationMinutes) return json({ error: 'Unknown checkpoint', code: 'CHECKPOINT_ATTEMPT_INVALID' }, 400);

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const deadlineAt = new Date(nowDate.getTime() + durationMinutes * 60_000).toISOString();
  const expiresAt = new Date(
    nowDate.getTime() + (durationMinutes + CHECKPOINT_ATTEMPT_GRACE_MINUTES) * 60_000
  ).toISOString();
  const reservationId = crypto.randomUUID();
  const reportId = crypto.randomUUID();
  const deviceName = cleanDeviceName(auth.deviceName);

  const [, inserted] = await env.DB.batch([
    env.DB.prepare(`UPDATE checkpoint_attempt_reservations
      SET status = 'expired', updated_at = ?
      WHERE user_id = ? AND checkpoint_id = ? AND status = 'active' AND expires_at <= ?`)
      .bind(now, auth.userId, checkpointId, now),
    env.DB.prepare(`INSERT OR IGNORE INTO checkpoint_attempt_reservations(
      reservation_id, report_id, user_id, checkpoint_id, client_request_id,
      attempt_number, status, started_at, deadline_at, expires_at,
      session_id, device_name, created_at, updated_at
    )
    SELECT ?, ?, ?, ?, ?,
      COALESCE((
        SELECT MAX(attempt_number) FROM (
          SELECT attempt_number FROM checkpoint_reports WHERE user_id = ? AND checkpoint_id = ?
          UNION ALL
          SELECT attempt_number FROM checkpoint_attempt_reservations WHERE user_id = ? AND checkpoint_id = ?
        )
      ), 0) + 1,
      'active', ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM checkpoint_attempt_reservations
      WHERE user_id = ? AND checkpoint_id = ? AND status = 'active'
    )`)
      .bind(
        reservationId,
        reportId,
        auth.userId,
        checkpointId,
        clientRequestId,
        auth.userId,
        checkpointId,
        auth.userId,
        checkpointId,
        now,
        deadlineAt,
        expiresAt,
        auth.sessionId,
        deviceName,
        now,
        now,
        auth.userId,
        checkpointId
      )
  ]);

  const requested = await reservationByRequest(env, auth, checkpointId, clientRequestId);
  if (requested) {
    return json(response(
      requested,
      inserted.meta.changes === 1,
      inserted.meta.changes !== 1,
      requested.status === 'active' && !requested.ownedByCurrentSession
    ));
  }

  const active = await activeReservation(env, auth, checkpointId);
  if (active) {
    return json({
      error: 'Another checkpoint attempt is already active',
      code: 'CHECKPOINT_ATTEMPT_ACTIVE',
      ...response(active, false, false, !active.ownedByCurrentSession)
    }, 409);
  }

  return json({
    error: 'Checkpoint attempt could not be reserved',
    code: 'CHECKPOINT_ATTEMPT_NOT_FOUND'
  }, 409);
}

async function getActiveAttempt(
  request: Request,
  env: Cloudflare.Env,
  auth: CheckpointReservationAuth
) {
  const checkpointId = new URL(request.url).searchParams.get('checkpointId');
  if (!isCoordinatedCheckpointId(checkpointId)) {
    return json({ error: 'Invalid checkpoint', code: 'CHECKPOINT_ATTEMPT_INVALID' }, 400);
  }
  const now = new Date().toISOString();
  await expireStale(env, auth.userId, checkpointId, now);
  return json({ reservation: await activeReservation(env, auth, checkpointId) });
}

export async function handleCheckpointAttemptReservationRequest(
  request: Request,
  env: Cloudflare.Env,
  auth: CheckpointReservationAuth
): Promise<Response | null> {
  const provisionalAdoptionResponse = await handleCheckpointProvisionalAdoptionRequest(request, env, auth);
  if (provisionalAdoptionResponse) return provisionalAdoptionResponse;

  const url = new URL(request.url);
  if (url.pathname !== '/api/checkpoints/reservations') return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);
  if (request.method === 'GET') return getActiveAttempt(request, env, auth);
  if (request.method === 'POST') return reserveAttempt(request, env, auth);
  return json({ error: 'Method not allowed' }, 405, { allow: 'GET, POST' });
}
