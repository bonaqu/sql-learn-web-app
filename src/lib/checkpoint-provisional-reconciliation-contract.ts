import { canonicalEvidenceJson } from './checkpoint-report-integrity';

export const CHECKPOINT_PROVISIONAL_ADOPTION_ENDPOINT = '/api/checkpoints/provisional-adoptions';

export const CHECKPOINT_PROVISIONAL_ADOPTION_CODES = {
  activeAttempt: 'CHECKPOINT_PROVISIONAL_ACTIVE_ATTEMPT',
  conflict: 'CHECKPOINT_PROVISIONAL_CONFLICT',
  invalid: 'CHECKPOINT_PROVISIONAL_INVALID',
  ownerMismatch: 'CHECKPOINT_PROVISIONAL_OWNER_MISMATCH',
  storedInvalid: 'CHECKPOINT_PROVISIONAL_STORED_INVALID'
} as const;

export type CheckpointProvisionalAdoptionCode =
  typeof CHECKPOINT_PROVISIONAL_ADOPTION_CODES[keyof typeof CHECKPOINT_PROVISIONAL_ADOPTION_CODES];

export type CheckpointProvisionalTaskScore = {
  taskId: string;
  title: string;
  module: string;
  correct: boolean;
  skipped: boolean;
  attempts: number;
  elapsedSeconds: number;
  score: number;
};

export type CheckpointProvisionalModuleScore = {
  module: string;
  title: string;
  score: number;
  correct: number;
  total: number;
};

export type ProvisionalCheckpointReport = {
  version: 1;
  id: string;
  userId: string;
  checkpointId: string;
  status: 'completed' | 'expired' | 'abandoned';
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  attemptNumber: number;
  score: number;
  bestScore: number;
  passingScore: number;
  passed: boolean;
  accuracy: number;
  firstAttemptRate: number;
  independence: number;
  taskScores: CheckpointProvisionalTaskScore[];
  moduleScores: CheckpointProvisionalModuleScore[];
  remediationModules: string[];
  coordination: 'provisional';
  reservationId?: never;
};

export type AdoptedCheckpointReport = Omit<ProvisionalCheckpointReport, 'coordination' | 'reservationId'> & {
  coordination: 'adopted';
  provisionalAttemptNumber: number;
  canonicalAttemptNumber: number;
};

export type CheckpointProvisionalAdoptionReceipt = {
  version: 1;
  reportId: string;
  checkpointId: string;
  provisionalAttemptNumber: number;
  canonicalAttemptNumber: number;
  adoptedAt: string;
  evidenceDigest: string;
};

export type CheckpointProvisionalAdoptionResponse = {
  ok: true;
  replayed: boolean;
  report: AdoptedCheckpointReport;
  receipt: CheckpointProvisionalAdoptionReceipt;
};

export type CheckpointProvisionalAdoptionConflict = {
  error: string;
  code: CheckpointProvisionalAdoptionCode;
  reportId?: string;
  checkpointId?: string;
  activeReservationId?: string;
};

type AllocationProjectedCheckpointReport = Omit<ProvisionalCheckpointReport, 'coordination' | 'reservationId'> & {
  coordination: 'provisional' | 'adopted';
  reservationId?: string;
  provisionalAttemptNumber?: number;
  canonicalAttemptNumber?: number;
};

const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const ID_PATTERN = /^[a-f0-9-]{16,80}$/i;

function boundedAttemptNumber(value: unknown) {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 1_000;
}

function validIsoDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isProvisionalCheckpointReport(value: unknown): value is ProvisionalCheckpointReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Partial<ProvisionalCheckpointReport>;
  return report.version === 1
    && report.coordination === 'provisional'
    && typeof report.id === 'string'
    && ID_PATTERN.test(report.id)
    && typeof report.userId === 'string'
    && ID_PATTERN.test(report.userId)
    && typeof report.checkpointId === 'string'
    && report.checkpointId.length > 0
    && (report.status === 'completed' || report.status === 'expired' || report.status === 'abandoned')
    && validIsoDate(report.startedAt)
    && validIsoDate(report.completedAt)
    && boundedAttemptNumber(report.attemptNumber)
    && typeof report.score === 'number'
    && Number.isInteger(report.score)
    && report.score >= 0
    && report.score <= 100
    && typeof report.passed === 'boolean'
    && Array.isArray(report.taskScores)
    && Array.isArray(report.moduleScores)
    && Array.isArray(report.remediationModules)
    && report.reservationId === undefined;
}

export function isAdoptedCheckpointReport(value: unknown): value is AdoptedCheckpointReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Partial<AdoptedCheckpointReport>;
  return report.version === 1
    && report.coordination === 'adopted'
    && typeof report.id === 'string'
    && ID_PATTERN.test(report.id)
    && typeof report.userId === 'string'
    && ID_PATTERN.test(report.userId)
    && typeof report.checkpointId === 'string'
    && report.checkpointId.length > 0
    && boundedAttemptNumber(report.attemptNumber)
    && boundedAttemptNumber(report.provisionalAttemptNumber)
    && boundedAttemptNumber(report.canonicalAttemptNumber)
    && report.attemptNumber === report.canonicalAttemptNumber
    && validIsoDate(report.startedAt)
    && validIsoDate(report.completedAt)
    && typeof report.score === 'number'
    && Number.isInteger(report.score)
    && report.score >= 0
    && report.score <= 100
    && typeof report.passed === 'boolean'
    && Array.isArray(report.taskScores)
    && Array.isArray(report.moduleScores)
    && Array.isArray(report.remediationModules);
}

export function validCheckpointProvisionalAdoptionReceipt(
  value: unknown
): value is CheckpointProvisionalAdoptionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Partial<CheckpointProvisionalAdoptionReceipt>;
  return receipt.version === 1
    && typeof receipt.reportId === 'string'
    && ID_PATTERN.test(receipt.reportId)
    && typeof receipt.checkpointId === 'string'
    && receipt.checkpointId.length > 0
    && boundedAttemptNumber(receipt.provisionalAttemptNumber)
    && boundedAttemptNumber(receipt.canonicalAttemptNumber)
    && validIsoDate(receipt.adoptedAt)
    && typeof receipt.evidenceDigest === 'string'
    && DIGEST_PATTERN.test(receipt.evidenceDigest);
}

export function validCheckpointProvisionalAdoptionResponse(
  value: unknown
): value is CheckpointProvisionalAdoptionResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Partial<CheckpointProvisionalAdoptionResponse>;
  return response.ok === true
    && typeof response.replayed === 'boolean'
    && isAdoptedCheckpointReport(response.report)
    && validCheckpointProvisionalAdoptionReceipt(response.receipt)
    && response.report.id === response.receipt.reportId
    && response.report.checkpointId === response.receipt.checkpointId
    && response.report.provisionalAttemptNumber === response.receipt.provisionalAttemptNumber
    && response.report.canonicalAttemptNumber === response.receipt.canonicalAttemptNumber;
}

export function provisionalCheckpointEvidenceValue(
  report: ProvisionalCheckpointReport | AdoptedCheckpointReport
) {
  const source = report as AllocationProjectedCheckpointReport;
  const {
    attemptNumber: _attemptNumber,
    bestScore: _bestScore,
    coordination: _coordination,
    reservationId: _reservationId,
    provisionalAttemptNumber: _provisionalAttemptNumber,
    canonicalAttemptNumber: _canonicalAttemptNumber,
    ...immutableEvidence
  } = source;
  return immutableEvidence;
}

export function canonicalProvisionalCheckpointEvidenceJson(
  report: ProvisionalCheckpointReport | AdoptedCheckpointReport
) {
  return canonicalEvidenceJson(provisionalCheckpointEvidenceValue(report));
}

export function sameCheckpointEvidenceAcrossAdoption(
  provisional: ProvisionalCheckpointReport,
  adopted: AdoptedCheckpointReport
) {
  return provisional.id === adopted.id
    && provisional.userId === adopted.userId
    && provisional.checkpointId === adopted.checkpointId
    && provisional.attemptNumber === adopted.provisionalAttemptNumber
    && canonicalProvisionalCheckpointEvidenceJson(provisional)
      === canonicalProvisionalCheckpointEvidenceJson(adopted);
}

export function projectAdoptedCheckpointReport(
  provisional: ProvisionalCheckpointReport,
  receipt: CheckpointProvisionalAdoptionReceipt
): AdoptedCheckpointReport {
  if (provisional.id !== receipt.reportId
    || provisional.checkpointId !== receipt.checkpointId
    || provisional.attemptNumber !== receipt.provisionalAttemptNumber) {
    throw new TypeError('Provisional checkpoint report does not match its adoption receipt.');
  }
  return {
    ...provisional,
    attemptNumber: receipt.canonicalAttemptNumber,
    coordination: 'adopted',
    provisionalAttemptNumber: receipt.provisionalAttemptNumber,
    canonicalAttemptNumber: receipt.canonicalAttemptNumber
  };
}
