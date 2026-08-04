import { loadAuthSession } from './auth';
import {
  CHECKPOINT_PROVISIONAL_ADOPTION_CODES,
  CHECKPOINT_PROVISIONAL_ADOPTION_ENDPOINT,
  isProvisionalCheckpointReport,
  sameCheckpointEvidenceAcrossAdoption,
  validCheckpointProvisionalAdoptionReceipt,
  validCheckpointProvisionalAdoptionResponse,
  type AdoptedCheckpointReport,
  type CheckpointProvisionalAdoptionCode,
  type CheckpointProvisionalAdoptionReceipt,
  type ProvisionalCheckpointReport
} from './checkpoint-provisional-reconciliation-contract';

const STORAGE_PREFIX = 'sql-academy-checkpoint-provisional-adoptions-v1';
export const CHECKPOINT_PROVISIONAL_ADOPTIONS_CHANGED_EVENT = 'sql-academy-checkpoint-provisional-adoptions-changed';

export type CheckpointProvisionalAdoptionResult = {
  report: AdoptedCheckpointReport;
  receipt: CheckpointProvisionalAdoptionReceipt;
  replayed: boolean;
};

export class CheckpointProvisionalAdoptionError extends Error {
  constructor(
    readonly code: CheckpointProvisionalAdoptionCode,
    readonly status: number,
    readonly reportId: string | null,
    readonly checkpointId: string | null,
    readonly activeReservationId: string | null,
    message: string
  ) {
    super(message);
    this.name = 'CheckpointProvisionalAdoptionError';
  }
}

export class CheckpointProvisionalAdoptionUnavailableError extends Error {
  constructor(message = 'Cloud reconciliation checkpoint report недоступна.') {
    super(message);
    this.name = 'CheckpointProvisionalAdoptionUnavailableError';
  }
}

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function orderedReceipts(receipts: CheckpointProvisionalAdoptionReceipt[]) {
  const byReport = new Map<string, CheckpointProvisionalAdoptionReceipt>();
  for (const receipt of receipts) {
    if (!validCheckpointProvisionalAdoptionReceipt(receipt)) continue;
    const existing = byReport.get(receipt.reportId);
    if (!existing
      || receipt.adoptedAt > existing.adoptedAt
      || (receipt.adoptedAt === existing.adoptedAt
        && receipt.canonicalAttemptNumber < existing.canonicalAttemptNumber)) {
      byReport.set(receipt.reportId, receipt);
    }
  }
  return Array.from(byReport.values())
    .sort((left, right) => right.adoptedAt.localeCompare(left.adoptedAt)
      || left.reportId.localeCompare(right.reportId))
    .slice(0, 100);
}

export function loadCheckpointProvisionalAdoptionReceipts(userId: string | null | undefined) {
  if (!userId) return [];
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(userId)) || '[]') as unknown;
    return Array.isArray(value) ? orderedReceipts(value as CheckpointProvisionalAdoptionReceipt[]) : [];
  } catch {
    return [];
  }
}

export function saveCheckpointProvisionalAdoptionReceipts(
  userId: string,
  receipts: CheckpointProvisionalAdoptionReceipt[]
) {
  const next = orderedReceipts([
    ...loadCheckpointProvisionalAdoptionReceipts(userId),
    ...receipts
  ]);
  const key = storageKey(userId);
  const serialized = JSON.stringify(next);
  if (localStorage.getItem(key) === serialized) return next;
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new CustomEvent(CHECKPOINT_PROVISIONAL_ADOPTIONS_CHANGED_EVENT, {
    detail: next
  }));
  return next;
}

export function saveCheckpointProvisionalAdoptionReceipt(
  userId: string,
  receipt: CheckpointProvisionalAdoptionReceipt
) {
  if (!validCheckpointProvisionalAdoptionReceipt(receipt)) {
    throw new TypeError('Некорректная adoption receipt checkpoint report.');
  }
  return saveCheckpointProvisionalAdoptionReceipts(userId, [receipt]);
}

export function checkpointProvisionalAdoptionReceiptForReport(
  reportId: string,
  receipts: CheckpointProvisionalAdoptionReceipt[]
) {
  return receipts.find(receipt => receipt.reportId === reportId) || null;
}

async function parsePayload(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function errorCode(value: unknown): CheckpointProvisionalAdoptionCode {
  return value === CHECKPOINT_PROVISIONAL_ADOPTION_CODES.activeAttempt
    || value === CHECKPOINT_PROVISIONAL_ADOPTION_CODES.conflict
    || value === CHECKPOINT_PROVISIONAL_ADOPTION_CODES.invalid
    || value === CHECKPOINT_PROVISIONAL_ADOPTION_CODES.ownerMismatch
    || value === CHECKPOINT_PROVISIONAL_ADOPTION_CODES.storedInvalid
    ? value
    : CHECKPOINT_PROVISIONAL_ADOPTION_CODES.conflict;
}

async function request(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new CheckpointProvisionalAdoptionUnavailableError(
      error instanceof Error ? error.message : undefined
    );
  }
}

export async function adoptProvisionalCheckpointReport(
  report: ProvisionalCheckpointReport
): Promise<CheckpointProvisionalAdoptionResult> {
  const auth = loadAuthSession();
  if (!auth) throw new Error('Необходим вход в аккаунт');
  if (report.userId !== auth.userId || !isProvisionalCheckpointReport(report)) {
    throw new TypeError('Некорректный provisional checkpoint report для текущего аккаунта.');
  }

  const response = await request(CHECKPOINT_PROVISIONAL_ADOPTION_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report)
  });
  const payload = await parsePayload(response);
  if (!response.ok) {
    throw new CheckpointProvisionalAdoptionError(
      errorCode(payload.code),
      response.status,
      typeof payload.reportId === 'string' ? payload.reportId : null,
      typeof payload.checkpointId === 'string' ? payload.checkpointId : null,
      typeof payload.activeReservationId === 'string' ? payload.activeReservationId : null,
      typeof payload.error === 'string'
        ? payload.error
        : 'Не удалось согласовать provisional checkpoint report.'
    );
  }
  if (!validCheckpointProvisionalAdoptionResponse(payload)) {
    throw new TypeError('Сервер вернул некорректную adoption receipt checkpoint report.');
  }
  if (!sameCheckpointEvidenceAcrossAdoption(report, payload.report)) {
    throw new TypeError('Adopted checkpoint report изменил immutable learning evidence.');
  }
  saveCheckpointProvisionalAdoptionReceipt(auth.userId, payload.receipt);
  return {
    report: payload.report,
    receipt: payload.receipt,
    replayed: payload.replayed
  };
}
