import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CheckpointReport } from '../src/lib/checkpoints';
import {
  checkpointProvisionalReconciliationUiState,
  checkpointProvisionalReconciliationUiStates
} from '../src/lib/checkpoint-provisional-reconciliation-ui';
import type { CheckpointProvisionalAdoptionReceipt } from '../src/lib/checkpoint-provisional-reconciliation-contract';

const provisional = {
  version: 1,
  id: '10000000-0000-4000-8000-000000000001',
  userId: '20000000-0000-4000-8000-000000000001',
  checkpointId: 'checkpoint-foundation',
  status: 'completed',
  startedAt: '2026-08-04T08:00:00.000Z',
  completedAt: '2026-08-04T08:10:00.000Z',
  durationSeconds: 600,
  attemptNumber: 2,
  score: 82,
  bestScore: 82,
  passingScore: 70,
  passed: true,
  accuracy: 82,
  firstAttemptRate: 82,
  independence: 82,
  taskScores: [{
    taskId: 'task-001',
    title: 'SELECT',
    module: 'select',
    correct: true,
    skipped: false,
    attempts: 1,
    elapsedSeconds: 60,
    score: 82
  }],
  moduleScores: [{
    module: 'select',
    title: 'SELECT',
    score: 82,
    correct: 1,
    total: 1
  }],
  remediationModules: [],
  coordination: 'provisional'
} satisfies CheckpointReport;

const pending = checkpointProvisionalReconciliationUiState(provisional, []);
assert.equal(pending?.status, 'pending');
assert.equal(pending?.provisionalAttemptNumber, 2);
assert.equal(pending?.canonicalAttemptNumber, null);
assert.match(pending?.title || '', /Ожидает согласования/);
assert.match(pending?.detail || '', /D1 назначит канонический номер/);

const blocked = checkpointProvisionalReconciliationUiState(provisional, [], [{
  reportId: provisional.id,
  checkpointId: provisional.checkpointId,
  activeReservationId: '30000000-0000-4000-8000-000000000001'
}]);
assert.equal(blocked?.status, 'blocked');
assert.equal(blocked?.activeReservationId, '30000000-0000-4000-8000-000000000001');
assert.match(blocked?.title || '', /временно заблокировано/);
assert.doesNotMatch(JSON.stringify(blocked), /taskScores|moduleScores|payloadDigest/);

const receipt = {
  version: 1,
  reportId: provisional.id,
  checkpointId: provisional.checkpointId,
  provisionalAttemptNumber: 2,
  canonicalAttemptNumber: 4,
  adoptedAt: '2026-08-04T08:20:00.000Z',
  evidenceDigest: 'a'.repeat(64)
} satisfies CheckpointProvisionalAdoptionReceipt;

const adoptedFromReceipt = checkpointProvisionalReconciliationUiState(provisional, [receipt]);
assert.equal(adoptedFromReceipt?.status, 'adopted');
assert.equal(adoptedFromReceipt?.provisionalAttemptNumber, 2);
assert.equal(adoptedFromReceipt?.canonicalAttemptNumber, 4);
assert.match(adoptedFromReceipt?.title || '', /попытка #4/);
assert.match(adoptedFromReceipt?.detail || '', /Локальный номер #2 сохранён/);
assert.doesNotMatch(JSON.stringify(adoptedFromReceipt), /evidenceDigest/);

const adoptedReport = {
  ...provisional,
  coordination: 'adopted',
  attemptNumber: 4,
  provisionalAttemptNumber: 2,
  canonicalAttemptNumber: 4
} as CheckpointReport;
const adoptedWithoutReceipt = checkpointProvisionalReconciliationUiState(adoptedReport, []);
assert.equal(adoptedWithoutReceipt?.status, 'adopted');
assert.equal(adoptedWithoutReceipt?.canonicalAttemptNumber, 4);
assert.equal(adoptedWithoutReceipt?.adoptedAt, null);

const legacy = { ...provisional } as Record<string, unknown>;
delete legacy.coordination;
assert.equal(checkpointProvisionalReconciliationUiState(legacy as CheckpointReport, []), null);

const states = checkpointProvisionalReconciliationUiStates([
  provisional,
  adoptedReport,
  legacy as CheckpointReport
], [receipt]);
assert.equal(states.length, 2);
assert.ok(states.every(state => state.status === 'adopted'));

const source = readFileSync(new URL('../src/lib/checkpoint-provisional-reconciliation-ui.ts', import.meta.url), 'utf8');
for (const marker of [
  "'pending' | 'adopted' | 'blocked'",
  'isProvisionalCheckpointReport',
  'isAdoptedCheckpointReport',
  'CheckpointProvisionalAdoptionReceipt',
  'Ожидает согласования',
  'Согласование временно заблокировано',
  'Согласовано как попытка #'
]) {
  assert.ok(source.includes(marker), `Provisional reconciliation UI projection is missing ${marker}.`);
}
assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|taskScores|moduleScores/,
  'UI projection must stay pure and must not read transport/storage or expose complete evidence payloads.');

console.log('Checkpoint provisional reconciliation UI validated: pending, adopted and blocked projections preserve original/canonical numbering and expose no raw evidence payload.');
