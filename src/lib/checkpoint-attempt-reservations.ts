import { loadAuthSession } from './auth';
import {
  validCheckpointAttemptReservation,
  validCheckpointAttemptReservationResponse,
  type CheckpointAttemptReservation,
  type CheckpointAttemptReservationErrorCode,
  type CheckpointAttemptReservationResponse,
  type CoordinatedCheckpointId
} from './checkpoint-attempt-reservation-contract';

const PENDING_PREFIX = 'sql-academy-checkpoint-reservation-request-v1';

export type CheckpointAttemptReservationResult = CheckpointAttemptReservationResponse & {
  provisional: false;
};

export class CheckpointAttemptReservationError extends Error {
  constructor(
    readonly code: CheckpointAttemptReservationErrorCode,
    readonly status: number,
    readonly reservation: CheckpointAttemptReservation | null,
    message: string
  ) {
    super(message);
    this.name = 'CheckpointAttemptReservationError';
  }
}

export class CheckpointAttemptReservationUnavailableError extends Error {
  constructor(message = 'Cloud coordination checkpoint attempt недоступна.') {
    super(message);
    this.name = 'CheckpointAttemptReservationUnavailableError';
  }
}

function pendingKey(userId: string, checkpointId: CoordinatedCheckpointId) {
  return `${PENDING_PREFIX}:${userId}:${checkpointId}`;
}

function readPendingRequest(userId: string, checkpointId: CoordinatedCheckpointId) {
  try {
    const value = localStorage.getItem(pendingKey(userId, checkpointId));
    return value && /^[a-f0-9-]{16,80}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function checkpointReservationClientRequestId(
  userId: string,
  checkpointId: CoordinatedCheckpointId
) {
  const existing = readPendingRequest(userId, checkpointId);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(pendingKey(userId, checkpointId), next);
  return next;
}

export function clearCheckpointReservationClientRequest(
  userId: string,
  checkpointId: CoordinatedCheckpointId,
  expectedRequestId?: string
) {
  const key = pendingKey(userId, checkpointId);
  if (expectedRequestId) {
    const current = localStorage.getItem(key);
    if (current !== expectedRequestId) return false;
  }
  localStorage.removeItem(key);
  return true;
}

async function parsePayload(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function request(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new CheckpointAttemptReservationUnavailableError(
      error instanceof Error ? error.message : undefined
    );
  }
}

function errorCode(value: unknown): CheckpointAttemptReservationErrorCode {
  return value === 'CHECKPOINT_ATTEMPT_ACTIVE'
    || value === 'CHECKPOINT_ATTEMPT_INVALID'
    || value === 'CHECKPOINT_ATTEMPT_NOT_FOUND'
    || value === 'CHECKPOINT_ATTEMPT_EXPIRED'
    || value === 'CHECKPOINT_ATTEMPT_BINDING_MISMATCH'
    ? value
    : 'CHECKPOINT_ATTEMPT_NOT_FOUND';
}

export async function reserveCheckpointAttempt(
  checkpointId: CoordinatedCheckpointId
): Promise<CheckpointAttemptReservationResult> {
  const auth = loadAuthSession();
  if (!auth) throw new Error('Необходим вход в аккаунт');
  const clientRequestId = checkpointReservationClientRequestId(auth.userId, checkpointId);
  const response = await request('/api/checkpoints/reservations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checkpointId, clientRequestId })
  });
  const payload = await parsePayload(response);
  if (response.ok) {
    if (!validCheckpointAttemptReservationResponse(payload)) {
      throw new TypeError('Сервер вернул некорректную reservation попытки.');
    }
    return { ...payload, provisional: false };
  }
  const reservation = validCheckpointAttemptReservation(payload.reservation)
    ? payload.reservation
    : null;
  throw new CheckpointAttemptReservationError(
    errorCode(payload.code),
    response.status,
    reservation,
    typeof payload.error === 'string' ? payload.error : 'Не удалось зарезервировать checkpoint attempt.'
  );
}

export async function loadActiveCheckpointAttempt(
  checkpointId: CoordinatedCheckpointId
): Promise<CheckpointAttemptReservation | null> {
  const response = await request(`/api/checkpoints/reservations?checkpointId=${encodeURIComponent(checkpointId)}`);
  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new CheckpointAttemptReservationError(
      errorCode(payload.code),
      response.status,
      validCheckpointAttemptReservation(payload.reservation) ? payload.reservation : null,
      typeof payload.error === 'string' ? payload.error : 'Не удалось проверить активную попытку.'
    );
  }
  if (payload.reservation === null) return null;
  if (!validCheckpointAttemptReservation(payload.reservation)) {
    throw new TypeError('Сервер вернул некорректную active reservation.');
  }
  return payload.reservation;
}

export function activeCheckpointAttemptMessage(reservation: CheckpointAttemptReservation) {
  const deadline = new Date(reservation.deadlineAt).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  });
  return reservation.ownedByCurrentSession
    ? `Попытка #${reservation.attemptNumber} уже активна на этом устройстве до ${deadline}.`
    : `Попытка #${reservation.attemptNumber} уже активна на «${reservation.deviceName}» до ${deadline}. Продолжи её там или дождись автоматического истечения.`;
}
