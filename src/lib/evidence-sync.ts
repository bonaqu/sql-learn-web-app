import {
  loadLocalAssessmentReports,
  saveLocalAssessmentReport,
  type AssessmentReport
} from './assessment';
import {
  loadLocalCheckpointReports,
  saveLocalCheckpointReport,
  type CheckpointReport
} from './checkpoints';

export type SyncableEvidenceReport = {
  id: string;
  completedAt: string;
};

export type EvidenceSyncResult = {
  assessment: { local: number; remote: number; uploaded: number };
  checkpoint: { local: number; remote: number; uploaded: number };
};

type SyncError = Error & { status?: number };

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

function persistAssessmentReports(merged: AssessmentReport[], previous: AssessmentReport[]) {
  const previousById = new Map(previous.map(report => [report.id, serialized(report)]));
  const changed = merged
    .filter(report => previousById.get(report.id) !== serialized(report))
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
  for (const report of changed) saveLocalAssessmentReport(report);
}

function persistCheckpointReports(merged: CheckpointReport[], previous: CheckpointReport[]) {
  const previousById = new Map(previous.map(report => [report.id, serialized(report)]));
  const changed = merged
    .filter(report => previousById.get(report.id) !== serialized(report))
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
  for (const report of changed) saveLocalCheckpointReport(report);
}

export async function syncAssessmentEvidence() {
  const local = loadLocalAssessmentReports();
  const response = await fetch('/api/assessment/reports');
  const payload = await responseJson<{ reports?: AssessmentReport[] }>(response);
  const remote = Array.isArray(payload.reports) ? payload.reports : [];
  const merged = mergeEvidenceReports(local, remote, 20);
  persistAssessmentReports(merged, local);
  const uploaded = await postReports('/api/assessment/reports', reportsToUpload(local, remote));
  return { local: merged.length, remote: remote.length, uploaded };
}

export async function syncCheckpointEvidence() {
  const local = loadLocalCheckpointReports();
  const response = await fetch('/api/checkpoints/reports');
  const payload = await responseJson<{ reports?: CheckpointReport[] }>(response);
  const remote = Array.isArray(payload.reports) ? payload.reports : [];
  const merged = mergeEvidenceReports(local, remote, 50);
  persistCheckpointReports(merged, local);
  const uploaded = await postReports('/api/checkpoints/reports', reportsToUpload(local, remote));
  return { local: merged.length, remote: remote.length, uploaded };
}

export async function reconcileEvidenceReports(): Promise<EvidenceSyncResult> {
  const [assessment, checkpoint] = await Promise.allSettled([
    syncAssessmentEvidence(),
    syncCheckpointEvidence()
  ]);

  const rejected = [assessment, checkpoint].find(result =>
    result.status === 'rejected' && (result.reason as SyncError)?.status === 401
  );
  if (rejected?.status === 'rejected') throw rejected.reason;

  return {
    assessment: assessment.status === 'fulfilled'
      ? assessment.value
      : { local: loadLocalAssessmentReports().length, remote: 0, uploaded: 0 },
    checkpoint: checkpoint.status === 'fulfilled'
      ? checkpoint.value
      : { local: loadLocalCheckpointReports().length, remote: 0, uploaded: 0 }
  };
}
