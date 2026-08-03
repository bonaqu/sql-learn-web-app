import assert from 'node:assert/strict';
import { curriculumCheckpoints } from '../src/data/complete-curriculum';
import {
  checkpointAttemptSnapshotFromReports,
  checkpointAttemptState,
  compareCheckpointAttempts,
  normalizeCheckpointAttempt
} from '../src/lib/checkpoint-attempt-policy';

const checkpoint = curriculumCheckpoints[0];
assert.ok(checkpoint, 'Checkpoint attempt policy requires one checkpoint.');
const userId = 'checkpoint-attempt-policy-validator';

function report(overrides: Record<string, unknown> = {}) {
  const score = Number(overrides.score ?? 72);
  return {
    version: 1,
    id: String(overrides.id || 'attempt-1'),
    userId: overrides.userId || userId,
    checkpointId: overrides.checkpointId || checkpoint.id,
    status: overrides.status || 'completed',
    startedAt: '2026-08-03T17:50:00.000Z',
    completedAt: overrides.completedAt || '2026-08-03T18:00:00.000Z',
    durationSeconds: 600,
    attemptNumber: overrides.attemptNumber || 1,
    score,
    bestScore: overrides.bestScore ?? score,
    passingScore: checkpoint.passingScore,
    passed: overrides.passed ?? score >= checkpoint.passingScore,
    accuracy: score,
    firstAttemptRate: score,
    independence: score,
    taskScores: [],
    moduleScores: [],
    remediationModules: []
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

assert.equal(checkpointAttemptState(checkpoint.id, [olderPass, newerFail], userId)?.currentAttempt.id, 'newer-fail');
assert.equal(checkpointAttemptState('checkpoint-does-not-exist', [olderPass], userId), null);

console.log('Checkpoint attempt policy validated: latest state, historical best separation, deterministic ties, invalid filtering and order-independent snapshots.');
