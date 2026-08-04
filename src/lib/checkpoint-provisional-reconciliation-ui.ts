import type { CheckpointReport } from './checkpoints';
import {
  isAdoptedCheckpointReport,
  isProvisionalCheckpointReport,
  type CheckpointProvisionalAdoptionReceipt
} from './checkpoint-provisional-reconciliation-contract';

export type CheckpointProvisionalReconciliationUiStatus = 'pending' | 'adopted' | 'blocked';

export type CheckpointProvisionalReconciliationBlock = {
  reportId: string;
  checkpointId: string;
  activeReservationId: string | null;
};

export type CheckpointProvisionalReconciliationUiState = {
  reportId: string;
  checkpointId: string;
  status: CheckpointProvisionalReconciliationUiStatus;
  title: string;
  detail: string;
  provisionalAttemptNumber: number;
  canonicalAttemptNumber: number | null;
  adoptedAt: string | null;
  activeReservationId: string | null;
};

function receiptForReport(
  reportId: string,
  receipts: CheckpointProvisionalAdoptionReceipt[]
) {
  return receipts.find(receipt => receipt.reportId === reportId) || null;
}

function blockForReport(
  reportId: string,
  blocks: CheckpointProvisionalReconciliationBlock[]
) {
  return blocks.find(block => block.reportId === reportId) || null;
}

export function checkpointProvisionalReconciliationUiState(
  report: CheckpointReport,
  receipts: CheckpointProvisionalAdoptionReceipt[],
  blocks: CheckpointProvisionalReconciliationBlock[] = []
): CheckpointProvisionalReconciliationUiState | null {
  if (isAdoptedCheckpointReport(report)) {
    const receipt = receiptForReport(report.id, receipts);
    const canonicalAttemptNumber = receipt?.canonicalAttemptNumber
      ?? report.canonicalAttemptNumber;
    const provisionalAttemptNumber = receipt?.provisionalAttemptNumber
      ?? report.provisionalAttemptNumber;
    return {
      reportId: report.id,
      checkpointId: report.checkpointId,
      status: 'adopted',
      title: `Согласовано как попытка #${canonicalAttemptNumber}`,
      detail: provisionalAttemptNumber === canonicalAttemptNumber
        ? 'Офлайн-результат принят в облачную историю без изменения learning evidence.'
        : `Локальный номер #${provisionalAttemptNumber} сохранён в receipt; канонический номер — #${canonicalAttemptNumber}.`,
      provisionalAttemptNumber,
      canonicalAttemptNumber,
      adoptedAt: receipt?.adoptedAt || null,
      activeReservationId: null
    };
  }

  if (!isProvisionalCheckpointReport(report)) return null;

  const receipt = receiptForReport(report.id, receipts);
  if (receipt) {
    return {
      reportId: report.id,
      checkpointId: report.checkpointId,
      status: 'adopted',
      title: `Согласовано как попытка #${receipt.canonicalAttemptNumber}`,
      detail: receipt.provisionalAttemptNumber === receipt.canonicalAttemptNumber
        ? 'Офлайн-результат принят в облачную историю без изменения learning evidence.'
        : `Локальный номер #${receipt.provisionalAttemptNumber} сохранён в receipt; канонический номер — #${receipt.canonicalAttemptNumber}.`,
      provisionalAttemptNumber: receipt.provisionalAttemptNumber,
      canonicalAttemptNumber: receipt.canonicalAttemptNumber,
      adoptedAt: receipt.adoptedAt,
      activeReservationId: null
    };
  }

  const block = blockForReport(report.id, blocks);
  if (block) {
    return {
      reportId: report.id,
      checkpointId: report.checkpointId,
      status: 'blocked',
      title: 'Согласование временно заблокировано',
      detail: 'Для этого checkpoint уже активна облачная попытка. Офлайн-результат сохранён локально и получит канонический номер после завершения активной попытки.',
      provisionalAttemptNumber: report.attemptNumber,
      canonicalAttemptNumber: null,
      adoptedAt: null,
      activeReservationId: block.activeReservationId
    };
  }

  return {
    reportId: report.id,
    checkpointId: report.checkpointId,
    status: 'pending',
    title: 'Ожидает согласования',
    detail: 'Офлайн-результат сохранён локально. После восстановления связи D1 назначит канонический номер попытки без изменения ответов, баллов и времени.',
    provisionalAttemptNumber: report.attemptNumber,
    canonicalAttemptNumber: null,
    adoptedAt: null,
    activeReservationId: null
  };
}

export function checkpointProvisionalReconciliationUiStates(
  reports: CheckpointReport[],
  receipts: CheckpointProvisionalAdoptionReceipt[],
  blocks: CheckpointProvisionalReconciliationBlock[] = []
) {
  return reports
    .map(report => checkpointProvisionalReconciliationUiState(report, receipts, blocks))
    .filter((state): state is CheckpointProvisionalReconciliationUiState => Boolean(state));
}
