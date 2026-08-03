import assert from 'node:assert/strict';
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

console.log('Checkpoint report reconciliation validated: exact replay no-op, local-only upload, cloud-authoritative conflicts, bounded quarantine and fail-closed duplicate cloud IDs.');
