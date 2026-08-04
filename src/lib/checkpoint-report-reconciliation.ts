import { compareCheckpointAttempts } from './checkpoint-attempt-policy';
import type { CheckpointReport } from './checkpoints';
import {
  isAdoptedCheckpointReport,
  isProvisionalCheckpointReport,
  sameCheckpointEvidenceAcrossAdoption,
  type AdoptedCheckpointReport,
  type ProvisionalCheckpointReport
} from './checkpoint-provisional-reconciliation-contract';
import { sameImmutableCheckpointReport } from './checkpoint-report-integrity';

export type CheckpointReportPairConflict = {
  reportId: string;
  localReport: CheckpointReport;
  remoteReport: CheckpointReport;
};

export type CheckpointReportReconciliation = {
  reports: CheckpointReport[];
  conflicts: CheckpointReportPairConflict[];
};

function validIdentity(report: CheckpointReport) {
  return report.version === 1
    && typeof report.id === 'string'
    && report.id.length > 0
    && typeof report.userId === 'string'
    && report.userId.length > 0
    && typeof report.checkpointId === 'string'
    && report.checkpointId.length > 0
    && typeof report.completedAt === 'string'
    && Number.isFinite(Date.parse(report.completedAt));
}

function asProvisional(report: CheckpointReport) {
  return isProvisionalCheckpointReport(report)
    ? report as ProvisionalCheckpointReport
    : null;
}

function asAdopted(report: CheckpointReport) {
  return isAdoptedCheckpointReport(report)
    ? report as AdoptedCheckpointReport
    : null;
}

function sameReconciledCheckpointEvidence(local: CheckpointReport, remote: CheckpointReport) {
  const provisional = asProvisional(local);
  const adopted = asAdopted(remote);
  if (provisional && adopted) {
    return sameCheckpointEvidenceAcrossAdoption(provisional, adopted);
  }
  return sameImmutableCheckpointReport(local, remote);
}

function allocationManagedReport(report: CheckpointReport) {
  return Boolean(asProvisional(report) || asAdopted(report));
}

export function reconcileCheckpointReportHistories(
  local: CheckpointReport[],
  remote: CheckpointReport[],
  limit = 50
): CheckpointReportReconciliation {
  const byId = new Map<string, CheckpointReport>();
  const conflicts: CheckpointReportPairConflict[] = [];

  for (const report of remote) {
    if (!validIdentity(report)) continue;
    const existing = byId.get(report.id);
    if (!existing) {
      byId.set(report.id, report);
      continue;
    }
    if (!sameImmutableCheckpointReport(existing, report)) {
      throw new Error(`Cloud returned conflicting immutable checkpoint report ${report.id}.`);
    }
  }

  for (const report of local) {
    if (!validIdentity(report)) continue;
    const existing = byId.get(report.id);
    if (!existing) {
      byId.set(report.id, report);
      continue;
    }
    if (!sameReconciledCheckpointEvidence(report, existing)) {
      conflicts.push({ reportId: report.id, localReport: report, remoteReport: existing });
    }
  }

  return {
    reports: Array.from(byId.values())
      .sort(compareCheckpointAttempts)
      .slice(0, Math.max(0, limit)),
    conflicts
  };
}

export function checkpointReportsToUpload(
  local: CheckpointReport[],
  remote: CheckpointReport[]
) {
  const remoteById = new Map(remote.map(report => [report.id, report]));
  const upload: CheckpointReport[] = [];
  for (const report of local) {
    if (allocationManagedReport(report)) continue;
    const existing = remoteById.get(report.id);
    if (!existing) {
      upload.push(report);
      continue;
    }
    if (!sameImmutableCheckpointReport(report, existing)) {
      continue;
    }
  }
  return upload;
}

export function provisionalCheckpointReportsToAdopt(
  local: CheckpointReport[],
  remote: CheckpointReport[]
) {
  const remoteById = new Map(remote.map(report => [report.id, report]));
  const adoption: ProvisionalCheckpointReport[] = [];
  for (const report of local) {
    const provisional = asProvisional(report);
    if (!provisional) continue;
    const existing = remoteById.get(report.id);
    if (!existing) {
      adoption.push(provisional);
      continue;
    }
    const adopted = asAdopted(existing);
    if (adopted && sameCheckpointEvidenceAcrossAdoption(provisional, adopted)) continue;
  }
  return adoption;
}
