import assert from 'node:assert/strict';
import { curriculumCheckpoints } from '../src/data/complete-curriculum';
import { tasks } from '../src/data/course-catalog';
import {
  checkpointRemediationsFromReports,
  nextCheckpointRemediationTaskId,
  unresolvedCheckpointRemediationModules
} from '../src/lib/checkpoint-remediation';
import type { Progress, TaskStats } from '../src/lib/progress';

const checkpoint = curriculumCheckpoints.find(item => item.moduleIds.length >= 2) || curriculumCheckpoints[0];
assert.ok(checkpoint, 'Checkpoint remediation validation requires a checkpoint.');
const userId = 'checkpoint-remediation-validator';
const weakModules = checkpoint.moduleIds.slice(0, 2);
const weakTasks = checkpoint.taskIds.flatMap(taskId => {
  const task = tasks.find(item => item.id === taskId);
  return task && weakModules.includes(task.module) ? [task] : [];
});
assert.ok(weakModules.length >= 1 && weakTasks.length >= 1,
  'Checkpoint remediation fixture requires checkpoint-owned modules and tasks.');

function report(overrides: Record<string, unknown> = {}) {
  const completedAt = String(overrides.completedAt || '2026-08-03T18:00:00.000Z');
  return {
    version: 1,
    id: String(overrides.id || 'failed-latest'),
    userId: overrides.userId || userId,
    checkpointId: overrides.checkpointId || checkpoint.id,
    status: overrides.status || 'completed',
    startedAt: '2026-08-03T17:50:00.000Z',
    completedAt,
    durationSeconds: 600,
    attemptNumber: overrides.attemptNumber || 2,
    score: overrides.score ?? 54,
    bestScore: overrides.bestScore ?? 61,
    passingScore: overrides.passingScore ?? checkpoint.passingScore,
    passed: overrides.passed ?? false,
    accuracy: 50,
    firstAttemptRate: 40,
    independence: 60,
    taskScores: overrides.taskScores || weakTasks.map((task, index) => ({
      taskId: task.id,
      title: task.title,
      module: task.module,
      correct: false,
      skipped: index === 0,
      attempts: 2,
      elapsedSeconds: 120,
      score: 20 + index * 10
    })),
    moduleScores: overrides.moduleScores || weakModules.map((module, index) => ({
      module,
      title: module,
      score: 30 + index * 20,
      correct: 0,
      total: 1
    })),
    remediationModules: overrides.remediationModules || [...weakModules]
  };
}

const older = report({
  id: 'failed-older',
  completedAt: '2026-08-03T17:00:00.000Z',
  attemptNumber: 1,
  score: 40,
  remediationModules: [weakModules.at(-1)]
});
const latest = report();
const invalid = [
  report({ id: 'cross-user', userId: 'someone-else' }),
  report({ id: 'expired', status: 'expired' }),
  report({ id: 'unknown-checkpoint', checkpointId: 'checkpoint-does-not-exist' })
];
const states = checkpointRemediationsFromReports([older, ...invalid, latest], userId);
assert.equal(states.length, 1, 'Only the latest valid failed checkpoint should create remediation.');
const state = states[0];
assert.equal(state.reportId, 'failed-latest');
assert.equal(state.attemptNumber, 2);
assert.equal(state.checkpointId, checkpoint.id);
assert.ok(state.modules.every(module => checkpoint.moduleIds.includes(module.moduleId)),
  'Remediation modules must stay inside checkpoint membership.');
assert.deepEqual(
  state.modules.map(module => module.moduleId),
  [...state.modules].sort((left, right) => left.score - right.score).map(module => module.moduleId),
  'Remediation modules must be ordered by lowest module score.'
);
assert.equal(new Set(state.modules.map(module => module.moduleId)).size, state.modules.length,
  'Remediation modules must be deduplicated.');

const polluted = checkpointRemediationsFromReports([
  report({ remediationModules: [weakModules[0], 'foreign-module', weakModules[0]] })
], userId)[0];
assert.deepEqual(polluted.modules.map(module => module.moduleId), [weakModules[0]],
  'Unknown, foreign and duplicate remediation modules must be removed.');

const passed = checkpointRemediationsFromReports([
  latest,
  report({
    id: 'passed-later',
    completedAt: '2026-08-03T19:00:00.000Z',
    attemptNumber: 3,
    score: 88,
    bestScore: 88,
    passed: true,
    remediationModules: []
  })
], userId);
assert.deepEqual(passed, [], 'A passed checkpoint must clear active remediation.');

const fallback = checkpointRemediationsFromReports([
  report({ remediationModules: [], moduleScores: [], taskScores: [] })
], userId)[0];
assert.equal(fallback.modules.length, 1,
  'A failed report without usable remediation fields must fall back to one checkpoint-owned module.');
assert.ok(checkpoint.moduleIds.includes(fallback.modules[0].moduleId));

function progressWithIndependentAt(when: string | null): Progress {
  const taskStats: Record<string, TaskStats> = {};
  for (const taskId of state.modules.flatMap(module => module.weakTaskIds)) {
    taskStats[taskId] = {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      solutionViews: 0,
      independentPasses: 1,
      lastIndependentAt: when || undefined,
      lastAttemptAt: when || undefined,
      completedAt: when || undefined
    };
  }
  return {
    version: 4,
    completed: Object.keys(taskStats),
    taskStats,
    xp: 0,
    streak: 0,
    history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }))
  };
}

const beforeFailure = progressWithIndependentAt('2026-08-03T17:59:00.000Z');
assert.ok(unresolvedCheckpointRemediationModules(state, beforeFailure).length > 0,
  'Independent evidence before the failed report must not count as repair.');
assert.ok(nextCheckpointRemediationTaskId(state, state.modules[0].moduleId, beforeFailure),
  'An unresolved module must expose a concrete repair task.');

const afterFailure = progressWithIndependentAt('2026-08-03T18:30:00.000Z');
assert.deepEqual(unresolvedCheckpointRemediationModules(state, afterFailure), [],
  'Fresh independent evidence after the report must repair targeted tasks.');

console.log(`Checkpoint remediation evidence validated: latest failed attempt, pass clearing, ownership/status filtering, ${state.modules.length} bounded weak modules and post-report independent repair.`);