import type { CoordinatedCheckpointId } from './checkpoint-attempt-reservation-contract';
import {
  CheckpointAttemptReservationError,
  CheckpointAttemptReservationUnavailableError,
  clearCheckpointReservationClientRequest,
  reserveCheckpointAttempt
} from './checkpoint-attempt-reservations';
import { loadAuthSession } from './auth';
import {
  buildCheckpointReport,
  clearCheckpointSession,
  createCheckpointSession,
  loadLocalCheckpointReports,
  saveCheckpointSession,
  saveLocalCheckpointReport,
  type CheckpointReport,
  type CheckpointSession,
  type CheckpointStatus
} from './checkpoints';
import type { Progress } from './progress';

export type CheckpointCoordinationMode = 'cloud' | 'provisional';

export type CoordinatedCheckpointSession = CheckpointSession & {
  coordination: CheckpointCoordinationMode;
  reservationId?: string;
  reservationClientRequestId?: string;
  coordinatedAttemptNumber?: number;
  reservationExpiresAt?: string;
  reservationDeviceName?: string;
};

export type CoordinatedCheckpointReport = CheckpointReport & {
  coordination: CheckpointCoordinationMode;
  reservationId?: string;
};

export type StartCheckpointSessionResult = {
  session: CoordinatedCheckpointSession | null;
  activeReservation: CheckpointAttemptReservationError['reservation'];
  provisional: boolean;
  message: string;
};

function asCoordinatedSession(session: CheckpointSession | null): CoordinatedCheckpointSession | null {
  if (!session) return null;
  const value = session as Partial<CoordinatedCheckpointSession>;
  return value.coordination === 'cloud' || value.coordination === 'provisional'
    ? value as CoordinatedCheckpointSession
    : null;
}

export function checkpointSessionCoordination(session: CheckpointSession | null) {
  return asCoordinatedSession(session)?.coordination || 'legacy';
}

export async function createCheckpointSessionWithCoordination(
  checkpointId: CoordinatedCheckpointId,
  progress: Progress,
  reports = loadLocalCheckpointReports()
): Promise<StartCheckpointSessionResult> {
  const auth = loadAuthSession();
  if (!auth) throw new Error('Необходим вход в аккаунт');
  try {
    const result = await reserveCheckpointAttempt(checkpointId);
    const reservation = result.reservation;
    if (reservation.status !== 'active') {
      clearCheckpointReservationClientRequest(
        auth.userId,
        checkpointId,
        reservation.clientRequestId
      );
      throw new Error('Предыдущая reservation уже завершена. Обнови Checkpoint Center и начни новую попытку.');
    }
    if (!reservation.ownedByCurrentSession) {
      return {
        session: null,
        activeReservation: reservation,
        provisional: false,
        message: `Попытка #${reservation.attemptNumber} уже активна на другом устройстве.`
      };
    }

    const base = createCheckpointSession(checkpointId, progress, reports);
    const session = saveCheckpointSession({
      ...base,
      id: reservation.reportId,
      startedAt: reservation.startedAt,
      updatedAt: reservation.startedAt,
      deadlineAt: reservation.deadlineAt,
      coordination: 'cloud',
      reservationId: reservation.reservationId,
      reservationClientRequestId: reservation.clientRequestId,
      coordinatedAttemptNumber: reservation.attemptNumber,
      reservationExpiresAt: reservation.expiresAt,
      reservationDeviceName: reservation.deviceName
    } satisfies CoordinatedCheckpointSession) as CoordinatedCheckpointSession;
    clearCheckpointReservationClientRequest(
      auth.userId,
      checkpointId,
      reservation.clientRequestId
    );
    return {
      session,
      activeReservation: null,
      provisional: false,
      message: `Cloud-coordinated попытка #${reservation.attemptNumber} зарезервирована.`
    };
  } catch (error) {
    if (error instanceof CheckpointAttemptReservationError) {
      if (error.code === 'CHECKPOINT_ATTEMPT_ACTIVE' && error.reservation) {
        return {
          session: null,
          activeReservation: error.reservation,
          provisional: false,
          message: `Попытка #${error.reservation.attemptNumber} уже активна на другом устройстве.`
        };
      }
      if (error.status < 500) throw error;
    } else if (!(error instanceof CheckpointAttemptReservationUnavailableError)) {
      throw error;
    }

    const base = createCheckpointSession(checkpointId, progress, reports);
    const session = saveCheckpointSession({
      ...base,
      coordination: 'provisional'
    } satisfies CoordinatedCheckpointSession) as CoordinatedCheckpointSession;
    return {
      session,
      activeReservation: null,
      provisional: true,
      message: 'Cloud coordination недоступна: начата явно помеченная provisional попытка.'
    };
  }
}

export function finishCheckpointSessionWithCoordination(
  session: CheckpointSession,
  status: Exclude<CheckpointStatus, 'active'>
): CoordinatedCheckpointReport {
  const coordinated = asCoordinatedSession(session);
  const base = buildCheckpointReport(session, status);
  const report: CoordinatedCheckpointReport = coordinated?.coordination === 'cloud'
    ? {
        ...base,
        id: coordinated.id,
        attemptNumber: coordinated.coordinatedAttemptNumber || base.attemptNumber,
        coordination: 'cloud',
        reservationId: coordinated.reservationId
      }
    : {
        ...base,
        coordination: 'provisional'
      };
  saveLocalCheckpointReport(report);
  clearCheckpointSession(session.userId);
  return report;
}
