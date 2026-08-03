import assert from 'node:assert/strict';
import { curriculumCheckpoints } from '../src/data/complete-curriculum';
import { tasks } from '../src/data/course-catalog';
import {
  mergeCheckpointReports,
  saveLocalCheckpointReport,
  type CheckpointReport
} from '../src/lib/checkpoints';
import { CheckpointReportConflictError } from '../src/lib/checkpoint-report-integrity';

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
  value: {
    dispatchEvent() { events += 1; return true; }
  }
});
Object.defineProperty(globalThis, 'CustomEvent', {
  configurable: true,
  value: class<T> {
    constructor(readonly type: string, readonly init?: { detail?: T }) {}
  }
});

const checkpoint = curriculumCheckpoints[0];
assert.ok(checkpoint, 'Local report integrity requires one checkpoint.');
const userId = 'checkpoint-local-integrity-user';

function report(overrides: Partial<CheckpointReport> = {}): CheckpointReport {
  const score = overrides.score ?? 88;
  const passed = overrides.passed ?? score >= checkpoint.passingScore;
  return {
    version: 1,
    id: overrides.id || 'a0000000-0000-0000-0000-000000000001',
    userId: overrides.userId || userId,
    checkpointId: overrides.checkpointId || checkpoint.id,
    status: overrides.status || 'completed',
    startedAt: overrides.startedAt || '2026-08-03T20:00:00.000Z',
    completedAt: overrides.completedAt || '2026-08-03T20:10:00.000Z',
    durationSeconds: overrides.durationSeconds ?? 600,
    attemptNumber: overrides.attemptNumber ?? 1,
    score,
    bestScore: overrides.bestScore ?? score,
    passingScore: overrides.passingScore ?? checkpoint.passingScore,
    passed,
    accuracy: overrides.accuracy ?? score,
    firstAttemptRate: overrides.firstAttemptRate ?? score,
    independence: overrides.independence ?? score,
    taskScores: overrides.taskScores || checkpoint.taskIds.map(taskId => {
      const task = tasks.find(item => item.id === taskId);
      return {
        taskId,
        title: task?.title || taskId,
        module: task?.module || checkpoint.moduleIds[0],
        correct: passed,
        skipped: false,
        attempts: 1,
        elapsedSeconds: 60,
        score: passed ? score : 0
      };
    }),
    moduleScores: overrides.moduleScores || checkpoint.moduleIds.map(module => ({
      module,
      title: module,
      score,
      correct: passed ? 1 : 0,
      total: 1
    })),
    remediationModules: overrides.remediationModules || (passed ? [] : [...checkpoint.moduleIds])
  };
}

const original = report();
const firstSave = saveLocalCheckpointReport(original);
assert.equal(firstSave.length, 1);
assert.equal(writes, 1);
assert.equal(events, 1);
const rawAfterFirstSave = storage.get(`sql-academy-checkpoint-reports-v1:${userId}`);
assert.ok(rawAfterFirstSave);

const reordered = {
  remediationModules: [...original.remediationModules],
  moduleScores: original.moduleScores.map(item => ({ ...item })),
  taskScores: original.taskScores.map(item => ({ ...item })),
  independence: original.independence,
  firstAttemptRate: original.firstAttemptRate,
  accuracy: original.accuracy,
  passed: original.passed,
  passingScore: original.passingScore,
  bestScore: original.bestScore,
  score: original.score,
  attemptNumber: original.attemptNumber,
  durationSeconds: original.durationSeconds,
  completedAt: original.completedAt,
  startedAt: original.startedAt,
  status: original.status,
  checkpointId: original.checkpointId,
  userId: original.userId,
  id: original.id,
  version: original.version
} satisfies CheckpointReport;
const replay = saveLocalCheckpointReport(reordered);
assert.equal(replay.length, 1);
assert.equal(writes, 1, 'Exact local replay must not write storage again.');
assert.equal(events, 1, 'Exact local replay must not dispatch a duplicate evidence event.');
assert.equal(storage.get(`sql-academy-checkpoint-reports-v1:${userId}`), rawAfterFirstSave);

const conflicting = report({ score: 45, bestScore: 88, passed: false });
assert.throws(
  () => saveLocalCheckpointReport(conflicting),
  (error: unknown) => error instanceof CheckpointReportConflictError
    && error.location === 'local-storage'
    && error.reportId === original.id
);
assert.equal(writes, 1);
assert.equal(events, 1);
assert.equal(storage.get(`sql-academy-checkpoint-reports-v1:${userId}`), rawAfterFirstSave,
  'A local conflict must leave the first accepted payload unchanged.');

const second = report({
  id: 'b0000000-0000-0000-0000-000000000002',
  completedAt: '2026-08-03T20:20:00.000Z',
  attemptNumber: 2,
  score: 91,
  bestScore: 91,
  passed: true
});
const merged = mergeCheckpointReports([original], [second, reordered]);
assert.deepEqual(merged.map(item => item.id), [second.id, original.id]);
assert.throws(
  () => mergeCheckpointReports([original], [conflicting]),
  (error: unknown) => error instanceof CheckpointReportConflictError
    && error.location === 'local-cloud-merge'
    && error.reportId === original.id
);

console.log('Local checkpoint report integrity validated: first-write append, exact replay no-op, typed storage conflict, immutable local/cloud merge and unchanged first payload.');
