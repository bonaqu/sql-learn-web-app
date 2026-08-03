export type CheckpointReportReceipt = {
  version: 1;
  reportId: string;
  checkpointId: string;
  persistedAt: string;
  payloadDigest: string;
};

export type CheckpointReportConflictLocation =
  | 'local-storage'
  | 'local-cloud-merge'
  | 'receipt-storage'
  | 'receipt-merge'
  | 'cloud';

export class CheckpointReportConflictError extends Error {
  readonly code = 'CHECKPOINT_REPORT_CONFLICT';

  constructor(
    readonly reportId: string,
    readonly location: CheckpointReportConflictLocation,
    message = 'Completed checkpoint report is immutable.'
  ) {
    super(message);
    this.name = 'CheckpointReportConflictError';
  }
}

function canonicalNumber(value: number) {
  if (!Number.isFinite(value)) throw new TypeError('Checkpoint evidence contains a non-finite number.');
  return Object.is(value, -0) ? 0 : value;
}

export function canonicalEvidenceJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(canonicalNumber(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalEvidenceJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .filter(key => object[key] !== undefined)
      .sort((left, right) => left.localeCompare(right))
      .map(key => `${JSON.stringify(key)}:${canonicalEvidenceJson(object[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new TypeError(`Checkpoint evidence contains unsupported ${typeof value}.`);
}

export function sameImmutableCheckpointReport(left: unknown, right: unknown) {
  return canonicalEvidenceJson(left) === canonicalEvidenceJson(right);
}

export function validCheckpointReportReceipt(value: unknown): value is CheckpointReportReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Partial<CheckpointReportReceipt>;
  return receipt.version === 1
    && typeof receipt.reportId === 'string'
    && receipt.reportId.length > 0
    && typeof receipt.checkpointId === 'string'
    && receipt.checkpointId.length > 0
    && typeof receipt.persistedAt === 'string'
    && Number.isFinite(Date.parse(receipt.persistedAt))
    && typeof receipt.payloadDigest === 'string'
    && /^[a-f0-9]{64}$/i.test(receipt.payloadDigest);
}

export function checkpointConflictMessage(error: unknown) {
  return error instanceof CheckpointReportConflictError
    ? `Конфликт immutable checkpoint report ${error.reportId}. Локальная история сохранена без перезаписи; обнови историю или обратись в поддержку.`
    : null;
}
