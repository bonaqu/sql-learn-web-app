import type { AssessmentReport } from './assessment';
import { loadAuthSession } from './auth';
import type { CheckpointReport } from './checkpoints';

export type SyncableEvidenceReport = {
  version?: number;
  id: string;
  userId?: string;
  completedAt: string;
};

export type EvidenceSyncResult = {
  assessment: { local: number; remote: number; uploaded: number };
  checkpoint: { local: number; remote: number; uploaded: number };
};

type SyncError = Error & { status?: number };
type EvidenceKind = 'assessment' | 'checkpoint';

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
  return loadAuthSession()?.userId || null;
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
  const next = serialized(reports);
  if (localStorage.getItem(key) === next) return false;
  localStorage.setItem(key, next);
  window.dispatchEvent(new CustomEvent(COLLECTIONS[kind].event, { detail: reports }));
  return true;
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = new Error(`Evidence sync failed with ${response.status}`) as SyncError;
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

async function postReports<T extends SyncableEvidenceReport>(endpoint: string, reports: T[]) {
  let uploaded = 0;
  for (const report of reports) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report)
    });
    if (response.status === 401) {
      const error = new Error('Evidence sync session expired') as SyncError;
      error.status = 401;
      throw error;
    }
    if (response.ok) uploaded += 1;
  }
  return uploaded;
}

async function syncCollection<T extends SyncableEvidenceReport>(kind: EvidenceKind, userId: string) {
  const config = COLLECTIONS[kind];
  const local = readLocalReports<T>(kind, userId);
  const response = await fetch(config.endpoint);
  const payload = await responseJson<{ reports?: T[] }>(response);
  const remote = Array.isArray(payload.reports)
    ? payload.reports.filter(report => validLocalReport<T>(report, userId))
    : [];
  const merged = mergeEvidenceReports(local, remote, config.limit);
  writeLocalReports(kind, userId, merged);
  const uploaded = await postReports(config.endpoint, reportsToUpload(local, remote));
  return { local: merged.length, remote: remote.length, uploaded };
}

export async function syncAssessmentEvidence(userId = currentUserId()) {
  if (!userId) return { local: 0, remote: 0, uploaded: 0 };
  return syncCollection<AssessmentReport>('assessment', userId);
}

export async function syncCheckpointEvidence(userId = currentUserId()) {
  if (!userId) return { local: 0, remote: 0, uploaded: 0 };
  return syncCollection<CheckpointReport>('checkpoint', userId);
}

export async function reconcileEvidenceReports(): Promise<EvidenceSyncResult> {
  const userId = currentUserId();
  if (!userId) {
    return {
      assessment: { local: 0, remote: 0, uploaded: 0 },
      checkpoint: { local: 0, remote: 0, uploaded: 0 }
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

  return {
    assessment: assessment.status === 'fulfilled'
      ? assessment.value
      : { local: readLocalReports<AssessmentReport>('assessment', userId).length, remote: 0, uploaded: 0 },
    checkpoint: checkpoint.status === 'fulfilled'
      ? checkpoint.value
      : { local: readLocalReports<CheckpointReport>('checkpoint', userId).length, remote: 0, uploaded: 0 }
  };
}
