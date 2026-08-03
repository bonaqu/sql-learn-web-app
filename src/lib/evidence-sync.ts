import type { AssessmentReport } from './assessment';
import type { CheckpointReport } from './checkpoints';
import {
  CheckpointReportConflictError,
  sameImmutableCheckpointReport,
  type CheckpointReportReceipt,
  validCheckpointReportReceipt
} from './checkpoint-report-integrity';
import {
  loadCheckpointReportReceipts,
  saveCheckpointReportReceipt,
  saveCheckpointReportReceipts
} from './checkpoint-report-receipts';
import {
  quarantineCheckpointReportConflict
} from './checkpoint-report-conflicts';
import {
  checkpointReportsToUpload,
  reconcileCheckpointReportHistories
} from './checkpoint-report-reconciliation';

export type SyncableEvidenceReport = {
  version?: number;
  id: string;
  userId?: string;
  completedAt: string;
};

export type EvidenceSyncResult = {
  assessment: { local: number; remote: number; uploaded: number };
  checkpoint: {
    local: number;
    remote: number;
    uploaded: number;
    replayed: number;
    receipts: number;
    conflicts: number;
  };
};

type SyncError = Error & {
  status?: number;
  code?: string;
  reportId?: string;
};
type EvidenceKind = 'assessment' | 'checkpoint';

const AUTH_SESSION_KEY = 'sql-academy-auth-session-v2';
const COLLECTIONS = {
  assessment: {
    endpoint: '/api/assessment/reports',
    keyPrefix: 'sql-academy-assessment-reports-v1:',
    event: 'sql-academy-assessment-reports-changed',
    limit: 20
  },
  checkpoint: {
    endpoint: '/api/checkpoints/reports',
    keyPrefix: 'sql-academy-checkpoint-reports-v1:',
    event: 'sql-academy-checkpoint-reports-changed',
    limit: 50
  }
} as const;

function serialized(value: unknown) {
  return JSON.stringify(value);
}

function preferredReport<T extends SyncableEvidenceReport>(left: T, right: T) {
  if (left.completedAt !== right.completedAt) {
    return left.completedAt > right.completedAt ? left : right;
  }
  const leftValue = serialized(left);
  const rightValue = serialized(right);
  if (leftValue.length !== rightValue.length) return leftValue.length > rightValue.length ? left : right;
  return leftValue >= rightValue ? left : right;
}

export function mergeEvidenceReports<T extends SyncableEvidenceReport>(
  local: T[],
  remote: T[],
  limit: number
) {
  const byId = new Map<string, T>();
  for (const report of [...remote, ...local]) {
    const existing = byId.get(report.id);
    byId.set(report.id, existing ? preferredReport(existing, report) : report);
  }
  return Array.from(byId.values())
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function reportsToUpload<T extends SyncableEvidenceReport>(local: T[], remote: T[]) {
  const remoteById = new Map(remote.map(report => [report.id, report]));
  return local.filter(report => {
    const existing = remoteById.get(report.id);
    if (!existing) return true;
    const preferred = preferredReport(report, existing);
    return preferred === report && serialized(report) !== serialized(existing);
  });
}

function currentUserId() {
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null') as { userId?: unknown } | null;
    return typeof session?.userId === 'string' && session.userId ? session.userId : null;
  } catch {
    return null;
  }
}

function validLocalReport<T extends SyncableEvidenceReport>(value: unknown, userId: string): value is T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Partial<SyncableEvidenceReport>;
  return report.version === 1
    && typeof report.id === 'string'
    && report.id.length > 0
    && typeof report.completedAt === 'string'
    && report.completedAt.length > 0
    && (!report.userId || report.userId === userId);
}

function localKey(kind: EvidenceKind, userId: string) {
  return `${COLLECTIONS[kind].keyPrefix}${userId}`;
}

function readLocalReports<T extends SyncableEvidenceReport>(kind: EvidenceKind, userId: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(localKey(kind, userId)) || '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((report): report is T => validLocalReport<T>(report, userId)).slice(0, COLLECTIONS[kind].limit)
      : [];
  } catch {
    return [];
  }
}

function writeLocalReports<T extends SyncableEvidenceReport>(
  kind: EvidenceKind,
  userId: string,
  reports: T[]
) {
  const key = localKey(kind, userId);
  const existing = localStorage.getItem(key);
  if (existing === null && reports.length === 0) return false;
  const next = serialized(reports);
  if (existing === next) return false;
  localStorage.setItem(key, next);
  window.dispatchEvent(new CustomEvent(COLLECTIONS[kind].event, { detail: reports }));
  return true;
}

async function parseResponsePayload(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function syncError(response: Response, payload: Record<string, unknown>) {
  const error = new Error(
    typeof payload.error === 'string'
      ? payload.error
      : `Evidence sync failed with ${response.status}`
  ) as SyncError;
  error.status = response.status;
  if (typeof payload.code === 'string') error.code = payload.code;
  if (typeof payload.reportId === 'string') error.reportId = payload.reportId;
  return error;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await parseResponsePayload(response);
  if (!response.ok) throw syncError(response, payload);
  return payload as T;
}

async function postAssessmentReports<T extends SyncableEvidenceReport>(endpoint: string, reports: T[]) {
  let uploaded = 0;
  for (const report of reports) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report)
    });
    const payload = await parseResponsePayload(response);
    if (!response.ok) throw syncError(response, payload);
    uploaded += 1;
  }
  return uploaded;
}

async function fetchCheckpointCloud(userId: string) {
  const response = await fetch(COLLECTIONS.checkpoint.endpoint);
  const payload = await responseJson<{
    reports?: CheckpointReport[];
    receipts?: CheckpointReportReceipt[];
  }>(response);
  const reports = Array.isArray(payload.reports)
    ? payload.reports.filter(report => validLocalReport<CheckpointReport>(report, userId))
    : [];
  const receipts = Array.isArray(payload.receipts)
    ? payload.receipts.filter(validCheckpointReportReceipt)
    : [];
  saveCheckpointReportReceipts(userId, receipts);
  return { reports, receipts };
}

async function postCheckpointReports(userId: string, reports: CheckpointReport[]) {
  let uploaded = 0;
  let replayed = 0;
  const conflicts: CheckpointReport[] = [];
  for (const report of reports) {
    const response = await fetch(COLLECTIONS.checkpoint.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report)
    });
    const payload = await parseResponsePayload(response);
    if (response.status === 409 && payload.code === 'CHECKPOINT_REPORT_CONFLICT') {
      conflicts.push(report);
      continue;
    }
    if (!response.ok) throw syncError(response, payload);
    if (!validCheckpointReportReceipt(payload.receipt)) {
      throw new TypeError(`Checkpoint report ${report.id} was accepted without a valid receipt.`);
    }
    saveCheckpointReportReceipt(userId, payload.receipt);
    if (payload.replayed === true) replayed += 1;
    else uploaded += 1;
  }
  return { uploaded, replayed, conflicts };
}

async function syncAssessmentCollection<T extends SyncableEvidenceReport>(userId: string) {
  const config = COLLECTIONS.assessment;
  const local = readLocalReports<T>('assessment', userId);
  const response = await fetch(config.endpoint);
  const payload = await responseJson<{ reports?: T[] }>(response);
  const remote = Array.isArray(payload.reports)
    ? payload.reports.filter(report => validLocalReport<T>(report, userId))
    : [];
  const merged = mergeEvidenceReports(local, remote, config.limit);
  writeLocalReports('assessment', userId, merged);
  const uploaded = await postAssessmentReports(config.endpoint, reportsToUpload(local, remote));
  return { local: merged.length, remote: remote.length, uploaded };
}

export async function syncAssessmentEvidence(userId = currentUserId()) {
  if (!userId) return { local: 0, remote: 0, uploaded: 0 };
  return syncAssessmentCollection<AssessmentReport>(userId);
}

export async function syncCheckpointEvidence(userId = currentUserId()) {
  if (!userId) return { local: 0, remote: 0, uploaded: 0, replayed: 0, receipts: 0, conflicts: 0 };

  const local = readLocalReports<CheckpointReport>('checkpoint', userId);
  const cloud = await fetchCheckpointCloud(userId);
  const remoteById = new Map(cloud.reports.map(report => [report.id, report]));
  const confirmed = local.filter(report => {
    const remote = remoteById.get(report.id);
    return remote ? sameImmutableCheckpointReport(report, remote) : false;
  }).length;
  const initial = reconcileCheckpointReportHistories(local, cloud.reports, COLLECTIONS.checkpoint.limit);
  for (const conflict of initial.conflicts) {
    quarantineCheckpointReportConflict(
      userId,
      conflict.localReport,
      conflict.remoteReport,
      'local-cloud-merge'
    );
  }
  writeLocalReports('checkpoint', userId, initial.reports);

  const uploadCandidates = checkpointReportsToUpload(local, cloud.reports);
  const posted = await postCheckpointReports(userId, uploadCandidates);
  let reports = initial.reports;
  let remoteCount = cloud.reports.length;
  let conflictCount = initial.conflicts.length;

  if (posted.conflicts.length > 0) {
    const refreshed = await fetchCheckpointCloud(userId);
    const afterRace = reconcileCheckpointReportHistories(local, refreshed.reports, COLLECTIONS.checkpoint.limit);
    const refreshedById = new Map(refreshed.reports.map(report => [report.id, report]));
    for (const localReport of posted.conflicts) {
      const remoteReport = refreshedById.get(localReport.id) || null;
      quarantineCheckpointReportConflict(userId, localReport, remoteReport, 'cloud-upload');
    }
    for (const conflict of afterRace.conflicts) {
      quarantineCheckpointReportConflict(
        userId,
        conflict.localReport,
        conflict.remoteReport,
        'cloud-upload'
      );
    }
    const unresolvedIds = new Set(posted.conflicts
      .filter(report => !refreshedById.has(report.id))
      .map(report => report.id));
    reports = afterRace.reports.filter(report => !unresolvedIds.has(report.id));
    writeLocalReports('checkpoint', userId, reports);
    remoteCount = refreshed.reports.length;
    conflictCount += posted.conflicts.length + afterRace.conflicts.length;
  }

  return {
    local: reports.length,
    remote: remoteCount,
    uploaded: posted.uploaded,
    replayed: confirmed + posted.replayed,
    receipts: loadCheckpointReportReceipts(userId).length,
    conflicts: conflictCount
  };
}

export async function reconcileEvidenceReports(): Promise<EvidenceSyncResult> {
  const userId = currentUserId();
  if (!userId) {
    return {
      assessment: { local: 0, remote: 0, uploaded: 0 },
      checkpoint: { local: 0, remote: 0, uploaded: 0, replayed: 0, receipts: 0, conflicts: 0 }
    };
  }

  const [assessment, checkpoint] = await Promise.allSettled([
    syncAssessmentEvidence(userId),
    syncCheckpointEvidence(userId)
  ]);

  const rejected = [assessment, checkpoint].find(result =>
    result.status === 'rejected' && (result.reason as SyncError)?.status === 401
  );
  if (rejected?.status === 'rejected') throw rejected.reason;

  if (checkpoint.status === 'rejected' && checkpoint.reason instanceof CheckpointReportConflictError) {
    throw checkpoint.reason;
  }

  return {
    assessment: assessment.status === 'fulfilled'
      ? assessment.value
      : { local: readLocalReports<AssessmentReport>('assessment', userId).length, remote: 0, uploaded: 0 },
    checkpoint: checkpoint.status === 'fulfilled'
      ? checkpoint.value
      : {
          local: readLocalReports<CheckpointReport>('checkpoint', userId).length,
          remote: 0,
          uploaded: 0,
          replayed: 0,
          receipts: loadCheckpointReportReceipts(userId).length,
          conflicts: 0
        }
  };
}
