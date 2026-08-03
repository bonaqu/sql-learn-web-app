import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CheckpointReport } from '../src/lib/checkpoints';
import {
  checkpointReportsToUpload,
  reconcileCheckpointReportHistories
} from '../src/lib/checkpoint-report-reconciliation';
import {
  latestCheckpointReportConflict,
  loadCheckpointReportConflicts,
  quarantineCheckpointReportConflict
} from '../src/lib/checkpoint-report-conflicts';

const storage = new Map<string, string>();
let writes = 0;
let events = 0;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key: string) { return storage.get(key) ?? null; },
    setItem(key: string, value: string) { writes += 1; storage.set(key, value); },
    removeItem(key: string) { storage.delete(key); },
    clear() { storage.clear(); }
  }
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { dispatchEvent() { events += 1; return true; } }
});
Object.defineProperty(globalThis, 'CustomEvent', {
  configurable: true,
  value: class<T> {
    constructor(readonly type: string, readonly init?: { detail?: T }) {}
  }
});

const userId = 'checkpoint-reconciliation-user';
function report(
  id: string,
  completedAt: string,
  attemptNumber: number,
  score: number,
  passed: boolean
): CheckpointReport {
  return {
    version: 1,
    id,
    userId,
    checkpointId: 'checkpoint-foundation',
    status: 'completed',
    startedAt: new Date(Date.parse(completedAt) - 300_000).toISOString(),
    completedAt,
    durationSeconds: 300,
    attemptNumber,
    score,
    bestScore: Math.max(91, score),
    passingScore: 70,
    passed,
    accuracy: score,
    firstAttemptRate: score,
    independence: score,
    taskScores: [{
      taskId: 'task-025',
      title: 'Checkpoint task',
      module: 'aggregates',
      correct: passed,
      skipped: false,
      attempts: 1,
      elapsedSeconds: 60,
      score: passed ? score : 0
    }],
    moduleScores: [{
      module: 'aggregates',
      title: 'Aggregates',
      score,
      correct: passed ? 1 : 0,
      total: 1
    }],
    remediationModules: passed ? [] : ['aggregates']
  };
}

const older = report('a0000000-0000-0000-0000-000000000001', '2026-08-03T20:00:00.000Z', 1, 91, true);
const localOnly = report('b0000000-0000-0000-0000-000000000002', '2026-08-03T21:00:00.000Z', 2, 82, true);
const remoteOriginal = report('c0000000-0000-0000-0000-000000000003', '2026-08-03T22:00:00.000Z', 3, 76, true);
const conflictingLocal = { ...remoteOriginal, score: 45, passed: false, remediationModules: ['aggregates'] };

const exact = reconcileCheckpointReportHistories([older], [{ ...older }]);
assert.deepEqual(exact.reports, [older]);
assert.deepEqual(exact.conflicts, []);
assert.deepEqual(checkpointReportsToUpload([older], [{ ...older }]), [],
  'Exact immutable replay must not upload again.');

const merged = reconcileCheckpointReportHistories(
  [localOnly, conflictingLocal],
  [remoteOriginal, older]
);
assert.deepEqual(merged.reports.map(item => item.id), [remoteOriginal.id, localOnly.id, older.id],
  'Cloud original must remain active while local-only evidence is preserved.');
assert.equal(merged.reports.find(item => item.id === remoteOriginal.id)?.score, 76,
  'Conflicting local payload must never replace accepted cloud evidence.');
assert.equal(merged.conflicts.length, 1);
assert.equal(merged.conflicts[0]?.localReport.score, 45);
assert.equal(merged.conflicts[0]?.remoteReport.score, 76);
assert.deepEqual(checkpointReportsToUpload([localOnly, conflictingLocal], [remoteOriginal]), [localOnly],
  'Conflicting same-ID local evidence must not be uploaded as a winner.');

const quarantined = quarantineCheckpointReportConflict(
  userId,
  merged.conflicts[0]!.localReport,
  merged.conflicts[0]!.remoteReport,
  'local-cloud-merge',
  '2026-08-03T22:10:00.000Z'
);
assert.equal(quarantined.length, 1);
assert.equal(quarantined[0]?.activeSource, 'cloud');
assert.equal(quarantined[0]?.local.score, 45);
assert.equal(quarantined[0]?.remote?.score, 76);
assert.equal('taskScores' in quarantined[0]!, false,
  'Conflict quarantine must store bounded evidence summaries, not raw report payloads.');
assert.equal(writes, 1);
assert.equal(events, 1);

const replayedQuarantine = quarantineCheckpointReportConflict(
  userId,
  merged.conflicts[0]!.localReport,
  merged.conflicts[0]!.remoteReport,
  'local-cloud-merge',
  '2026-08-03T22:11:00.000Z'
);
assert.equal(replayedQuarantine.length, 1);
assert.equal(writes, 1, 'Exact conflict replay must not rewrite quarantine storage.');
assert.equal(events, 1, 'Exact conflict replay must not dispatch duplicate UI events.');
assert.equal(loadCheckpointReportConflicts(userId).length, 1);
assert.equal(latestCheckpointReportConflict(userId)?.reportId, remoteOriginal.id);

assert.throws(
  () => reconcileCheckpointReportHistories([], [remoteOriginal, conflictingLocal]),
  /Cloud returned conflicting immutable checkpoint report/,
  'Two different cloud payloads for one immutable ID must fail closed.'
);

const syncSource = readFileSync(new URL('../src/lib/evidence-sync.ts', import.meta.url), 'utf8');
for (const marker of [
  'reconcileCheckpointReportHistories',
  'checkpointReportsToUpload',
  'quarantineCheckpointReportConflict',
  'saveCheckpointReportReceipt',
  'saveCheckpointReportReceipts',
  "payload.code === 'CHECKPOINT_REPORT_CONFLICT'",
  'unresolvedIds',
  'sameImmutableCheckpointReport'
]) {
  assert.ok(syncSource.includes(marker), `Checkpoint sync ownership is missing ${marker}.`);
}
assert.doesNotMatch(syncSource, /syncAssessmentCollection<CheckpointReport>|preferredReport\([^\n]*CheckpointReport/,
  'Checkpoint evidence must not re-enter the generic assessment last-write-wins path.');

const centerSource = readFileSync(new URL('../src/components/CheckpointCenterPortal.tsx', import.meta.url), 'utf8');
for (const marker of [
  'syncCheckpointEvidence',
  'checkpoint-report-conflict-banner',
  'checkpoint-report-receipt',
  'checkpoint-receipt-count',
  'checkpoint-sync-message',
  'loadCheckpointReportConflicts',
  'loadCheckpointReportReceipts'
]) {
  assert.ok(centerSource.includes(marker), `Checkpoint Center immutable evidence UI is missing ${marker}.`);
}
assert.doesNotMatch(centerSource, /\/api\/checkpoints\/reports|mergeCheckpointReports|saveLocalCheckpointReport/,
  'Checkpoint Center must consume the sync domain instead of implementing raw GET/merge/POST logic.');

const quarantineSource = readFileSync(new URL('../src/lib/checkpoint-report-conflicts.ts', import.meta.url), 'utf8');
assert.doesNotMatch(quarantineSource, /taskScores|moduleScores|remediationModules/,
  'Conflict quarantine must retain bounded summaries rather than raw report evidence arrays.');

const browserSource = readFileSync(new URL('../tests/e2e/checkpoint-report-integrity.spec.ts', import.meta.url), 'utf8');
for (const marker of [
  'desktop checkpoint immutable report race',
  'mobile checkpoint immutable conflict',
  'Promise.all',
  "expect([left.replayed, right.replayed].sort()).toEqual([false, true])",
  "code: 'CHECKPOINT_REPORT_CONFLICT'",
  'persisted).toEqual(original)',
  'secondContext',
  'seedConflictingLocalReport',
  'checkpoint-report-conflict-banner',
  'checkpoint-report-receipt',
  'checkpoint-receipt-count',
  'AxeBuilder',
  'expectNoOverflow'
]) {
  assert.ok(browserSource.includes(marker), `Checkpoint immutable browser contract is missing ${marker}.`);
}
const playwrightSource = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
assert.match(playwrightSource, /desktop checkpoint/,
  'Desktop immutable checkpoint contract must be selected by a Playwright project.');
assert.match(playwrightSource, /mobile checkpoint/,
  'Mobile immutable checkpoint contract must be selected by a Playwright project.');

console.log('Checkpoint report reconciliation validated: exact replay no-op, local-only upload, cloud-authoritative conflicts, bounded quarantine, fail-closed duplicate cloud IDs, raw-sync-free UI ownership and real desktop/mobile D1 contracts.');
