import assert from 'node:assert/strict';
import { curriculumCheckpoints } from '../src/data/complete-curriculum';
import { tasks } from '../src/data/course-catalog';
import {
  checkpointAttemptSnapshotFromReports,
  checkpointAttemptState,
  compareCheckpointAttempts,
  normalizeCheckpointAttempt
} from '../src/lib/checkpoint-attempt-policy';
import {
  bestCheckpointReport,
  checkpointEligibility,
  checkpointPassed,
  currentCheckpointReport,
  mergeCheckpointReports,
  type CheckpointReport
} from '../src/lib/checkpoints';
import type { Progress, TaskStats } from '../src/lib/progress';

const checkpoint = curriculumCheckpoints[0];
const nextCheckpoint = curriculumCheckpoints[1];
assert.ok(checkpoint, 'Checkpoint attempt policy requires one checkpoint.');
assert.ok(nextCheckpoint, 'Checkpoint eligibility validation requires a later checkpoint.');
const userId = 'checkpoint-attempt-policy-validator';

function report(overrides: Record<string, unknown> = {}): CheckpointReport {
  const score = Number(overrides.score ?? 72);
  return {
    version: 1,
    id: String(overrides.id || 'attempt-1'),
    userId: String(overrides.userId || userId),
    checkpointId: String(overrides.checkpointId || checkpoint.id),
    status: (overrides.status || 'completed') as CheckpointReport['status'],
    startedAt: '2026-08-03T17:50:00.000Z',
    completedAt: String(overrides.completedAt || '2026-08-03T18:00:00.000Z'),
    durationSeconds: 600,
    attemptNumber: Number(overrides.attemptNumber || 1),
    score,
    bestScore: Number(overrides.bestScore ?? score),
    passingScore: checkpoint.passingScore,
    passed: Boolean(overrides.passed ?? score >= checkpoint.passingScore),
    accuracy: score,
    firstAttemptRate: score,
    independence: score,
    taskScores: [],
    moduleScores: [],
    remediationModules: []
  };
}

function completeProgress(): Progress {
  const taskStats: Record<string, TaskStats> = {};
  for (const task of tasks) {
    taskStats[task.id] = {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      solutionViews: 0,
      independentPasses: 1,
      completedAt: '2026-08-03T17:00:00.000Z',
      lastAttemptAt: '2026-08-03T17:00:00.000Z',
      lastIndependentAt: '2026-08-03T17:00:00.000Z'
    };
  }
  return {
    version: 4,
    completed: tasks.map(task => task.id),
    taskStats,
    xp: tasks.reduce((sum, task) => sum + task.xp, 0),
    streak: 1,
    history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }))
  };
}

const olderPass = report({
  id: 'older-pass',
  completedAt: '2026-08-03T18:00:00.000Z',
  attemptNumber: 1,
  score: 91,
  bestScore: 91,
  passed: true
});
const newerFail = report({
  id: 'newer-fail',
  completedAt: '2026-08-03T19:00:00.000Z',
  attemptNumber: 2,
  score: 52,
  bestScore: 91,
  passed: false
});
const snapshot = checkpointAttemptSnapshotFromReports([olderPass, newerFail], userId);
assert.deepEqual(snapshot.attemptedCheckpointIds, [checkpoint.id]);
assert.deepEqual(snapshot.passedCheckpointIds, [],
  'A newer failed attempt must override an older pass for current state.');
assert.equal(snapshot.states[0].currentAttempt.id, 'newer-fail');
assert.equal(snapshot.states[0].currentAttempt.score, 52);
assert.equal(snapshot.states[0].historicalBestScore, 91,
  'Historical best must remain available without satisfying the current pass gate.');
assert.equal(currentCheckpointReport(checkpoint.id, [olderPass, newerFail])?.id, 'newer-fail');
assert.equal(bestCheckpointReport(checkpoint.id, [newerFail, olderPass])?.id, 'older-pass');
assert.equal(checkpointPassed(checkpoint.id, completeProgress(), [olderPass, newerFail]), false,
  'A completed failed current attempt must block legacy task-completion fallback.');
assert.equal(checkpointPassed(checkpoint.id, completeProgress(), []), true,
  'Legacy task-completion fallback remains available only when no completed report exists.');

const blockedEligibility = checkpointEligibility(nextCheckpoint.id, completeProgress(), [olderPass, newerFail]);
assert.equal(blockedEligibility.previousCheckpointId, checkpoint.id);
assert.equal(blockedEligibility.previousPassed, false,
  'A newer failed attempt must block the next checkpoint even after an older pass.');
assert.equal(blockedEligibility.eligible, false);
assert.ok(blockedEligibility.blockers.some(blocker => blocker.includes(checkpoint.title)));

const laterPass = report({
  id: 'later-pass',
  completedAt: '2026-08-03T20:00:00.000Z',
  attemptNumber: 3,
  score: 88,
  bestScore: 91,
  passed: true
});
const restored = checkpointAttemptSnapshotFromReports([newerFail, olderPass, laterPass], userId);
assert.deepEqual(restored.passedCheckpointIds, [checkpoint.id]);
assert.equal(restored.states[0].currentAttempt.id, 'later-pass');
assert.equal(restored.states[0].historicalBestScore, 91);
assert.equal(checkpointPassed(checkpoint.id, completeProgress(), [newerFail, olderPass, laterPass]), true);
const restoredEligibility = checkpointEligibility(
  nextCheckpoint.id,
  completeProgress(),
  [newerFail, olderPass, laterPass]
);
assert.equal(restoredEligibility.previousPassed, true);
assert.equal(restoredEligibility.eligible, true,
  'A later passing attempt must restore next-checkpoint eligibility.');

const sameTimeLowerAttempt = normalizeCheckpointAttempt(report({
  id: 'same-time-lower',
  completedAt: '2026-08-03T21:00:00.000Z',
  attemptNumber: 3,
  passed: true
}), userId)!;
const sameTimeHigherAttempt = normalizeCheckpointAttempt(report({
  id: 'same-time-higher',
  completedAt: '2026-08-03T21:00:00.000Z',
  attemptNumber: 4,
  passed: false
}), userId)!;
assert.equal(
  [sameTimeLowerAttempt, sameTimeHigherAttempt].sort(compareCheckpointAttempts)[0].id,
  'same-time-higher',
  'Attempt number must break equal completion timestamps.'
);
const sameTimeSameAttemptA = report({
  id: 'same-time-id-a',
  completedAt: '2026-08-03T22:00:00.000Z',
  attemptNumber: 5,
  passed: true
});
const sameTimeSameAttemptZ = report({
  id: 'same-time-id-z',
  completedAt: '2026-08-03T22:00:00.000Z',
  attemptNumber: 5,
  passed: false
});
const deterministicTie = checkpointAttemptSnapshotFromReports([
  sameTimeSameAttemptA,
  sameTimeSameAttemptZ
], userId);
assert.equal(deterministicTie.states[0].currentAttempt.id, 'same-time-id-z',
  'Report ID must deterministically break equal time and attempt number.');
assert.deepEqual(deterministicTie.passedCheckpointIds, []);

const invalid = [
  report({ id: 'wrong-user', userId: 'other-user' }),
  report({ id: 'expired', status: 'expired' }),
  report({ id: 'abandoned', status: 'abandoned' }),
  report({ id: 'unknown-checkpoint', checkpointId: 'checkpoint-does-not-exist' }),
  report({ id: 'bad-date', completedAt: 'not-a-date' }),
  null,
  'invalid'
];
assert.deepEqual(checkpointAttemptSnapshotFromReports(invalid, userId).states, [],
  'Malformed, cross-user, non-completed and unknown reports must be ignored.');

for (const permutation of [
  [olderPass, newerFail, laterPass],
  [laterPass, newerFail, olderPass],
  [newerFail, laterPass, olderPass]
]) {
  const value = checkpointAttemptSnapshotFromReports(permutation, userId);
  assert.equal(value.states[0].currentAttempt.id, 'later-pass');
  assert.equal(value.states[0].historicalBestScore, 91);
  assert.deepEqual(value.passedCheckpointIds, [checkpoint.id]);
}

const mergedForward = mergeCheckpointReports([olderPass], [newerFail, laterPass]);
const mergedReverse = mergeCheckpointReports([laterPass, newerFail], [olderPass]);
assert.deepEqual(
  mergedForward.map(item => item.id),
  mergedReverse.map(item => item.id),
  'Local/cloud partition and input order must not change deterministic report ordering.'
);
assert.equal(checkpointAttemptState(checkpoint.id, mergedForward, userId)?.currentAttempt.id, 'later-pass');
assert.equal(checkpointAttemptState('checkpoint-does-not-exist', [olderPass], userId), null);

console.log('Checkpoint attempt policy validated: latest state, historical best separation, eligibility, legacy fallback, deterministic ties and order-independent local/cloud snapshots.');
