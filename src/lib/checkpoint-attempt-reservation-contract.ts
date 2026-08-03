export const CHECKPOINT_ATTEMPT_GRACE_MINUTES = 5;

export const CHECKPOINT_DURATION_MINUTES = {
  'checkpoint-foundation': 30,
  'checkpoint-query-design': 30,
  'checkpoint-production': 30,
  'checkpoint-support-readiness': 30,
  'checkpoint-data-change': 35,
  'checkpoint-advanced-querying': 35,
  'checkpoint-modern-sql': 35,
  'checkpoint-production-operations': 35
} as const;

export type CoordinatedCheckpointId = keyof typeof CHECKPOINT_DURATION_MINUTES;
export type CheckpointAttemptReservationStatus = 'active' | 'completed' | 'expired' | 'abandoned';

export type CheckpointAttemptReservation = {
  version: 1;
  reservationId: string;
  reportId: string;
  checkpointId: CoordinatedCheckpointId;
  clientRequestId: string;
  attemptNumber: number;
  status: CheckpointAttemptReservationStatus;
  startedAt: string;
  deadlineAt: string;
  expiresAt: string;
  deviceName: string;
  ownedByCurrentSession: boolean;
};

export type CheckpointAttemptReservationResponse = {
  reservation: CheckpointAttemptReservation;
  created: boolean;
  replayed: boolean;
  activeElsewhere: boolean;
};

export type CheckpointAttemptReservationErrorCode =
  | 'CHECKPOINT_ATTEMPT_ACTIVE'
  | 'CHECKPOINT_ATTEMPT_INVALID'
  | 'CHECKPOINT_ATTEMPT_NOT_FOUND'
  | 'CHECKPOINT_ATTEMPT_EXPIRED'
  | 'CHECKPOINT_ATTEMPT_BINDING_MISMATCH';

const REQUEST_ID_PATTERN = /^[a-f0-9-]{16,80}$/i;

export function isCoordinatedCheckpointId(value: unknown): value is CoordinatedCheckpointId {
  return typeof value === 'string' && Object.hasOwn(CHECKPOINT_DURATION_MINUTES, value);
}

export function checkpointDurationMinutesFromContract(checkpointId: string) {
  return isCoordinatedCheckpointId(checkpointId)
    ? CHECKPOINT_DURATION_MINUTES[checkpointId]
    : null;
}

export function validCheckpointClientRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function validCheckpointAttemptReservation(value: unknown): value is CheckpointAttemptReservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<CheckpointAttemptReservation>;
  return item.version === 1
    && typeof item.reservationId === 'string'
    && REQUEST_ID_PATTERN.test(item.reservationId)
    && typeof item.reportId === 'string'
    && REQUEST_ID_PATTERN.test(item.reportId)
    && isCoordinatedCheckpointId(item.checkpointId)
    && validCheckpointClientRequestId(item.clientRequestId)
    && Number.isInteger(item.attemptNumber)
    && (item.attemptNumber ?? 0) >= 1
    && (item.attemptNumber ?? 1001) <= 1000
    && (item.status === 'active'
      || item.status === 'completed'
      || item.status === 'expired'
      || item.status === 'abandoned')
    && typeof item.startedAt === 'string'
    && Number.isFinite(Date.parse(item.startedAt))
    && typeof item.deadlineAt === 'string'
    && Number.isFinite(Date.parse(item.deadlineAt))
    && typeof item.expiresAt === 'string'
    && Number.isFinite(Date.parse(item.expiresAt))
    && Date.parse(item.deadlineAt) > Date.parse(item.startedAt)
    && Date.parse(item.expiresAt) >= Date.parse(item.deadlineAt)
    && typeof item.deviceName === 'string'
    && item.deviceName.length >= 1
    && item.deviceName.length <= 64
    && typeof item.ownedByCurrentSession === 'boolean';
}

export function validCheckpointAttemptReservationResponse(
  value: unknown
): value is CheckpointAttemptReservationResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<CheckpointAttemptReservationResponse>;
  return validCheckpointAttemptReservation(item.reservation)
    && typeof item.created === 'boolean'
    && typeof item.replayed === 'boolean'
    && typeof item.activeElsewhere === 'boolean'
    && !(item.created && item.replayed)
    && (!item.activeElsewhere || !item.reservation.ownedByCurrentSession);
}
