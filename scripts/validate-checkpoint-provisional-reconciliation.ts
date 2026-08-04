import assert from 'node:assert/strict';
import {
  canonicalProvisionalCheckpointEvidenceJson,
  isAdoptedCheckpointReport,
  isProvisionalCheckpointReport,
  projectAdoptedCheckpointReport,
  sameCheckpointEvidenceAcrossAdoption,
  validCheckpointProvisionalAdoptionReceipt,
  validCheckpointProvisionalAdoptionResponse,
  type CheckpointProvisionalAdoptionReceipt,
  type ProvisionalCheckpointReport
} from '../src/lib/checkpoint-provisional-reconciliation-contract';

const provisional: ProvisionalCheckpointReport = {
  version: 1,
  id: '10000000-0000-4000-8000-000000000001',
  userId: '20000000-0000-4000-8000-000000000001',
  checkpointId: 'checkpoint-foundation',
  status: 'completed',
  startedAt: '2026-08-04T08:00:00.000Z',
  completedAt: '2026-08-04T08:20:00.000Z',
  durationSeconds: 1_200,
  attemptNumber: 1,
  score: 82,
  bestScore: 82,
  passingScore: 70,
  passed: true,
  accuracy: 88,
  firstAttemptRate: 75,
  independence: 94,
  taskScores: [{
    taskId: 'task-001',
    title: 'Выбрать активные заявки',
    module: 'select',
    correct: true,
    skipped: false,
    attempts: 1,
    elapsedSeconds: 240,
    score: 100
  }],
  moduleScores: [{
    module: 'select',
    title: 'SELECT и выражения',
    score: 100,
    correct: 1,
    total: 1
  }],
  remediationModules: [],
  coordination: 'provisional'
};

const receipt: CheckpointProvisionalAdoptionReceipt = {
  version: 1,
  reportId: provisional.id,
  checkpointId: provisional.checkpointId,
  provisionalAttemptNumber: 1,
  canonicalAttemptNumber: 7,
  adoptedAt: '2026-08-04T09:00:00.000Z',
  evidenceDigest: 'a'.repeat(64)
};

assert.equal(isProvisionalCheckpointReport(provisional), true);
assert.equal(validCheckpointProvisionalAdoptionReceipt(receipt), true);

const adopted = projectAdoptedCheckpointReport(provisional, receipt);
assert.equal(isAdoptedCheckpointReport(adopted), true);
assert.equal(adopted.attemptNumber, 7);
assert.equal(adopted.provisionalAttemptNumber, 1);
assert.equal(adopted.canonicalAttemptNumber, 7);
assert.equal(sameCheckpointEvidenceAcrossAdoption(provisional, adopted), true);
assert.equal(
  canonicalProvisionalCheckpointEvidenceJson(provisional),
  canonicalProvisionalCheckpointEvidenceJson(adopted),
  'D1-owned allocation metadata must not change the immutable learning-evidence digest.'
);

const changedHistoryMetadata = {
  ...adopted,
  bestScore: 99,
  canonicalAttemptNumber: 11,
  attemptNumber: 11
};
assert.equal(
  canonicalProvisionalCheckpointEvidenceJson(adopted),
  canonicalProvisionalCheckpointEvidenceJson(changedHistoryMetadata),
  'Derived historical best and canonical allocation are metadata, not current-attempt evidence.'
);

for (const mutated of [
  { ...adopted, score: 81 },
  { ...adopted, completedAt: '2026-08-04T08:21:00.000Z' },
  { ...adopted, taskScores: [{ ...adopted.taskScores[0], elapsedSeconds: 241 }] },
  { ...adopted, moduleScores: [{ ...adopted.moduleScores[0], score: 99 }] }
]) {
  assert.notEqual(
    canonicalProvisionalCheckpointEvidenceJson(adopted),
    canonicalProvisionalCheckpointEvidenceJson(mutated),
    'Score, timestamps and task/module evidence must remain immutable through adoption.'
  );
}

assert.equal(validCheckpointProvisionalAdoptionResponse({
  ok: true,
  replayed: false,
  report: adopted,
  receipt
}), true);
assert.equal(validCheckpointProvisionalAdoptionResponse({
  ok: true,
  replayed: false,
  report: { ...adopted, canonicalAttemptNumber: 8 },
  receipt
}), false);
assert.equal(isProvisionalCheckpointReport({ ...provisional, reservationId: 'reservation-not-allowed' }), false);
assert.throws(
  () => projectAdoptedCheckpointReport(provisional, { ...receipt, provisionalAttemptNumber: 2 }),
  /does not match its adoption receipt/
);

console.log('Provisional checkpoint adoption contract validated: allocation/history metadata stays separate, learning evidence remains immutable, and receipt projection is strict.');
