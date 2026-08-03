import { curriculumCheckpoints } from '../data/complete-curriculum';

export type CheckpointAttemptRecord = {
  source: Record<string, unknown>;
  id: string;
  userId: string;
  checkpointId: string;
  completedAt: string;
  attemptNumber: number;
  passed: boolean;
  score: number;
  bestScore: number;
  passingScore: number;
};

export type CheckpointAttemptState = {
  checkpointId: string;
  currentAttempt: CheckpointAttemptRecord;
  historicalBestScore: number;
};

export type CheckpointAttemptSnapshot = {
  userId: string | null;
  states: CheckpointAttemptState[];
  currentAttempts: CheckpointAttemptRecord[];
  attemptedCheckpointIds: string[];
  passedCheckpointIds: string[];
};

const checkpointIds = curriculumCheckpoints.map(checkpoint => checkpoint.id);
const knownCheckpointIds = new Set(checkpointIds);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedScore(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function completedAt(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function attemptNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.round(number)) : 1;
}

export function compareCheckpointAttempts(
  left: CheckpointAttemptRecord,
  right: CheckpointAttemptRecord
) {
  return right.completedAt.localeCompare(left.completedAt)
    || right.attemptNumber - left.attemptNumber
    || right.id.localeCompare(left.id);
}

export function normalizeCheckpointAttempt(
  value: unknown,
  expectedUserId?: string | null
): CheckpointAttemptRecord | null {
  const item = record(value);
  if (!item
    || item.version !== 1
    || item.status !== 'completed'
    || typeof item.id !== 'string'
    || typeof item.userId !== 'string'
    || !item.userId
    || (expectedUserId && item.userId !== expectedUserId)
    || typeof item.checkpointId !== 'string'
    || !knownCheckpointIds.has(item.checkpointId)) return null;
  const finishedAt = completedAt(item.completedAt);
  if (!finishedAt) return null;
  return {
    source: item,
    id: item.id,
    userId: item.userId,
    checkpointId: item.checkpointId,
    completedAt: finishedAt,
    attemptNumber: attemptNumber(item.attemptNumber),
    passed: item.passed === true,
    score: boundedScore(item.score),
    bestScore: boundedScore(item.bestScore),
    passingScore: boundedScore(item.passingScore)
  };
}

export function checkpointAttemptSnapshotFromReports(
  reports: unknown,
  userId?: string | null
): CheckpointAttemptSnapshot {
  if (!Array.isArray(reports)) {
    return {
      userId: userId || null,
      states: [],
      currentAttempts: [],
      attemptedCheckpointIds: [],
      passedCheckpointIds: []
    };
  }
  const normalized = reports
    .map(report => normalizeCheckpointAttempt(report, userId))
    .filter((report): report is CheckpointAttemptRecord => Boolean(report));
  const resolvedUserId = userId
    || normalized[0]?.userId
    || null;
  const owned = resolvedUserId
    ? normalized.filter(report => report.userId === resolvedUserId)
    : [];
  const byCheckpoint = new Map<string, CheckpointAttemptRecord[]>();
  for (const report of owned) {
    byCheckpoint.set(report.checkpointId, [
      ...(byCheckpoint.get(report.checkpointId) || []),
      report
    ]);
  }
  const states = checkpointIds.flatMap(checkpointId => {
    const attempts = byCheckpoint.get(checkpointId);
    if (!attempts?.length) return [];
    const ordered = [...attempts].sort(compareCheckpointAttempts);
    const currentAttempt = ordered[0];
    return [{
      checkpointId,
      currentAttempt,
      historicalBestScore: Math.max(
        ...ordered.map(attempt => Math.max(attempt.score, attempt.bestScore)),
        0
      )
    } satisfies CheckpointAttemptState];
  });
  return {
    userId: resolvedUserId,
    states,
    currentAttempts: states.map(state => state.currentAttempt),
    attemptedCheckpointIds: states.map(state => state.checkpointId),
    passedCheckpointIds: states
      .filter(state => state.currentAttempt.passed)
      .map(state => state.checkpointId)
  };
}

export function checkpointAttemptState(
  checkpointId: string,
  reports: unknown,
  userId?: string | null
) {
  return checkpointAttemptSnapshotFromReports(reports, userId).states
    .find(state => state.checkpointId === checkpointId) || null;
}
