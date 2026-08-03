import type { CheckpointReport } from './checkpoints';

export type CheckpointReportConflictLocation = 'local-cloud-merge' | 'cloud-upload';

export type CheckpointReportConflictSummary = {
  completedAt: string;
  attemptNumber: number;
  score: number;
  passed: boolean;
};

export type CheckpointReportConflictRecord = {
  version: 1;
  id: string;
  reportId: string;
  checkpointId: string;
  detectedAt: string;
  location: CheckpointReportConflictLocation;
  activeSource: 'cloud';
  local: CheckpointReportConflictSummary;
  remote: CheckpointReportConflictSummary | null;
};

export const CHECKPOINT_REPORT_CONFLICTS_CHANGED_EVENT = 'sql-academy-checkpoint-report-conflicts-changed';
const CONFLICTS_PREFIX = 'sql-academy-checkpoint-report-conflicts-v1';
const MAX_CONFLICTS = 20;

function conflictsKey(userId: string) {
  return `${CONFLICTS_PREFIX}:${userId}`;
}

function summary(report: CheckpointReport): CheckpointReportConflictSummary {
  return {
    completedAt: report.completedAt,
    attemptNumber: report.attemptNumber,
    score: report.score,
    passed: report.passed
  };
}

function validSummary(value: unknown): value is CheckpointReportConflictSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<CheckpointReportConflictSummary>;
  return typeof item.completedAt === 'string'
    && Number.isFinite(Date.parse(item.completedAt))
    && Number.isInteger(item.attemptNumber)
    && (item.attemptNumber ?? 0) >= 1
    && Number.isInteger(item.score)
    && (item.score ?? -1) >= 0
    && (item.score ?? 101) <= 100
    && typeof item.passed === 'boolean';
}

function validConflict(value: unknown): value is CheckpointReportConflictRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<CheckpointReportConflictRecord>;
  return item.version === 1
    && typeof item.id === 'string'
    && item.id.length > 0
    && typeof item.reportId === 'string'
    && item.reportId.length > 0
    && typeof item.checkpointId === 'string'
    && item.checkpointId.length > 0
    && typeof item.detectedAt === 'string'
    && Number.isFinite(Date.parse(item.detectedAt))
    && (item.location === 'local-cloud-merge' || item.location === 'cloud-upload')
    && item.activeSource === 'cloud'
    && validSummary(item.local)
    && (item.remote === null || validSummary(item.remote));
}

function recordId(
  reportId: string,
  location: CheckpointReportConflictLocation,
  local: CheckpointReportConflictSummary,
  remote: CheckpointReportConflictSummary | null
) {
  return [
    reportId,
    location,
    local.completedAt,
    local.attemptNumber,
    local.score,
    remote?.completedAt || 'missing',
    remote?.attemptNumber || 0,
    remote?.score ?? -1
  ].join(':');
}

function ordered(items: CheckpointReportConflictRecord[]) {
  return [...items]
    .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt) || right.id.localeCompare(left.id))
    .slice(0, MAX_CONFLICTS);
}

export function loadCheckpointReportConflicts(userId: string | null | undefined) {
  if (!userId || typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(conflictsKey(userId)) || '[]') as unknown;
    return Array.isArray(parsed) ? ordered(parsed.filter(validConflict)) : [];
  } catch {
    return [];
  }
}

export function quarantineCheckpointReportConflict(
  userId: string,
  localReport: CheckpointReport,
  remoteReport: CheckpointReport | null,
  location: CheckpointReportConflictLocation,
  now = new Date().toISOString()
) {
  const local = summary(localReport);
  const remote = remoteReport ? summary(remoteReport) : null;
  const id = recordId(localReport.id, location, local, remote);
  const previous = loadCheckpointReportConflicts(userId);
  if (previous.some(item => item.id === id)) return previous;
  const next = ordered([{
    version: 1,
    id,
    reportId: localReport.id,
    checkpointId: remoteReport?.checkpointId || localReport.checkpointId,
    detectedAt: now,
    location,
    activeSource: 'cloud',
    local,
    remote
  }, ...previous]);
  localStorage.setItem(conflictsKey(userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHECKPOINT_REPORT_CONFLICTS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function latestCheckpointReportConflict(userId: string | null | undefined) {
  return loadCheckpointReportConflicts(userId)[0] || null;
}
