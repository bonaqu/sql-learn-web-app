import {
  CheckpointReportConflictError,
  sameImmutableCheckpointReport,
  type CheckpointReportReceipt,
  validCheckpointReportReceipt
} from './checkpoint-report-integrity';

export const CHECKPOINT_RECEIPTS_CHANGED_EVENT = 'sql-academy-checkpoint-receipts-changed';
const RECEIPTS_PREFIX = 'sql-academy-checkpoint-receipts-v1';
const MAX_RECEIPTS = 100;

function receiptKey(userId: string) {
  return `${RECEIPTS_PREFIX}:${userId}`;
}

function ordered(receipts: CheckpointReportReceipt[]) {
  return [...receipts]
    .sort((left, right) =>
      right.persistedAt.localeCompare(left.persistedAt)
      || right.reportId.localeCompare(left.reportId)
    )
    .slice(0, MAX_RECEIPTS);
}

export function mergeCheckpointReportReceipts(
  local: unknown,
  remote: unknown
): CheckpointReportReceipt[] {
  const byId = new Map<string, CheckpointReportReceipt>();
  const values = [
    ...(Array.isArray(remote) ? remote : []),
    ...(Array.isArray(local) ? local : [])
  ];
  for (const value of values) {
    if (!validCheckpointReportReceipt(value)) continue;
    const existing = byId.get(value.reportId);
    if (!existing) {
      byId.set(value.reportId, value);
      continue;
    }
    if (!sameImmutableCheckpointReport(existing, value)) {
      throw new CheckpointReportConflictError(value.reportId, 'receipt-merge');
    }
  }
  return ordered([...byId.values()]);
}

export function loadCheckpointReportReceipts(userId: string | null | undefined) {
  if (!userId || typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(receiptKey(userId)) || '[]') as unknown;
    return mergeCheckpointReportReceipts([], parsed);
  } catch (error) {
    if (error instanceof CheckpointReportConflictError) throw error;
    return [];
  }
}

export function saveCheckpointReportReceipt(
  userId: string,
  receipt: CheckpointReportReceipt
) {
  if (!validCheckpointReportReceipt(receipt)) {
    throw new TypeError('Invalid checkpoint report receipt.');
  }
  const previous = loadCheckpointReportReceipts(userId);
  const existing = previous.find(item => item.reportId === receipt.reportId);
  if (existing) {
    if (!sameImmutableCheckpointReport(existing, receipt)) {
      throw new CheckpointReportConflictError(receipt.reportId, 'receipt-storage');
    }
    return previous;
  }
  const next = ordered([receipt, ...previous]);
  localStorage.setItem(receiptKey(userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHECKPOINT_RECEIPTS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function saveCheckpointReportReceipts(
  userId: string,
  receipts: unknown
) {
  const previous = loadCheckpointReportReceipts(userId);
  const next = mergeCheckpointReportReceipts(previous, receipts);
  if (sameImmutableCheckpointReport(previous, next)) return previous;
  localStorage.setItem(receiptKey(userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHECKPOINT_RECEIPTS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function checkpointReceiptForReport(
  reportId: string,
  receipts: readonly CheckpointReportReceipt[]
) {
  return receipts.find(receipt => receipt.reportId === reportId) || null;
}
