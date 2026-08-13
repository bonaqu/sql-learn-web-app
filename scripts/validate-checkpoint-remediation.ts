import assert from 'node:assert/strict';
import { curriculumCheckpoints, curriculumLessons } from '../src/data/complete-curriculum';
import { tasks } from '../src/data/course-catalog';
import { lessonChecks } from '../src/data/lesson-checks';
import { phaseDefinitions } from '../src/data/learning-structure';
import {
  checkpointRemediationsFromReports,
  nextCheckpointRemediationTaskId,
  unresolvedCheckpointRemediationModules
} from '../src/lib/checkpoint-remediation';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress';
import {
  buildJourneyFrontier,
  foundationTasksForModule
} from '../src/lib/learning-journey';
import type { LearnerGoal } from '../src/lib/learner-onboarding';
import type { Progress, TaskStats } from '../src/lib/progress';
import { evaluationContractForTask } from '../src/data/foundation-evaluation-contracts';
import { FOUNDATION_EVIDENCE_CONTRACT_VERSION, TASK_EVALUATION_CONTRACT_VERSION } from '../src/lib/task-evaluation-contract';

const fixture = phaseDefinitions.flatMap(phase => {
  const phaseModules = new Set<string>(phase.moduleIds);
  const checkpoint = curriculumCheckpoints.find(item => {
    const checkpointModules = new Set<string>(item.moduleIds);
    return checkpointModules.size === phaseModules.size
      && phase.moduleIds.every(moduleId => checkpointModules.has(moduleId));
  });
  return checkpoint ? [{ phase, checkpoint }] : [];
})[0];
assert.ok(fixture, 'Checkpoint remediation validation requires a checkpoint covering one whole phase.');
const { checkpoint, phase: checkpointPhase } = fixture;
const checkpointModules = new Set<string>(checkpoint.moduleIds);
assert.ok(checkpointPhase.moduleIds.every(moduleId => checkpointModules.has(moduleId)),
  'Checkpoint fixture must cover every module in its canonical phase.');
const checkpointIndex = curriculumCheckpoints.findIndex(item => item.id === checkpoint.id);
const checkpointPhaseIndex = phaseDefinitions.findIndex(phase => phase.id === checkpointPhase.id);
assert.ok(checkpointIndex >= 0 && checkpointPhaseIndex >= 0,
  'Checkpoint remediation fixture must resolve canonical checkpoint and phase positions.');
const prerequisiteModuleIds = phaseDefinitions
  .slice(0, checkpointPhaseIndex + 1)
  .flatMap(phase => [...phase.moduleIds]);
const prerequisiteModuleSet = new Set<string>(prerequisiteModuleIds);
const priorCheckpointIds = curriculumCheckpoints
  .slice(0, checkpointIndex)
  .map(item => item.id);

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
assert.equal(state.phaseId, checkpointPhase.id);
assert.ok(state.modules.every(module => checkpointModules.has(module.moduleId)),
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

const failedAfterPass = checkpointRemediationsFromReports([
  report({
    id: 'passed-earlier',
    completedAt: '2026-08-03T17:30:00.000Z',
    attemptNumber: 1,
    score: 88,
    bestScore: 88,
    passed: true,
    remediationModules: []
  }),
  latest
], userId);
assert.equal(failedAfterPass[0]?.reportId, latest.id,
  'A later failed retake must reactivate remediation even after an older pass.');

const fallback = checkpointRemediationsFromReports([
  report({ remediationModules: [], moduleScores: [], taskScores: [] })
], userId)[0];
assert.equal(fallback.modules.length, 1,
  'A failed report without usable remediation fields must fall back to one checkpoint-owned module.');
assert.ok(checkpointModules.has(fallback.modules[0].moduleId));

function emptyProgress(): Progress {
  return {
    version: 4,
    completed: [],
    taskStats: {},
    xp: 0,
    streak: 0,
    history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }))
  };
}

function progressWithIndependentAt(when: string | null, taskIds = state.modules.flatMap(module => module.weakTaskIds)): Progress {
  const taskStats: Record<string, TaskStats> = {};
  for (const taskId of taskIds) {
    const task = tasks.find(item => item.id === taskId);
    const contract = evaluationContractForTask(taskId);
    taskStats[taskId] = {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      solutionViews: 0,
      independentPasses: 1,
      lastIndependentAt: when || undefined,
      lastAttemptAt: when || undefined,
      completedAt: when || undefined,
      ...(task?.evaluationContractId ? {
        evidenceContractVersion: FOUNDATION_EVIDENCE_CONTRACT_VERSION,
        evaluationContractId: task.evaluationContractId,
        evaluationContractVersion: TASK_EVALUATION_CONTRACT_VERSION,
        validatedFixtureIds: contract?.fixtures.map(fixture => fixture.id),
        hiddenFixtureIds: contract?.fixtures.filter(fixture => fixture.visibility !== 'public').map(fixture => fixture.id)
      } : {})
    };
  }
  return {
    ...emptyProgress(),
    completed: Object.keys(taskStats),
    taskStats
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

const goals: LearnerGoal[] = ['support', 'analyst', 'backend', 'data-engineering', 'interview', 'full'];
const remediationActions = goals.map(goal => buildJourneyFrontier(emptyProgress(), emptyCurriculumProgress(), {
  includeReview: false,
  goal,
  bypassedModuleIds: [...checkpoint.moduleIds],
  checkpointRemediations: [state]
}).action);
for (const action of remediationActions) {
  assert.equal(action.routeReasonCode, 'checkpoint-remediation',
    'Failed checkpoint remediation must outrank goal specialization.');
  assert.equal(action.moduleId, state.modules[0].moduleId,
    'All goals must repair the lowest-scoring checkpoint module first.');
  assert.equal(action.remediationCheckpointId, checkpoint.id);
  assert.equal(action.remediationReportId, state.reportId);
}
assert.equal(new Set(remediationActions.map(action => action.moduleId)).size, 1,
  'Identical evidence must produce identical active remediation for all goals.');

const attemptedTask = tasks.find(task => !new Set<string>(checkpoint.taskIds).has(task.id)) || tasks[0];
const reviewProgress: Progress = {
  ...emptyProgress(),
  taskStats: {
    [attemptedTask.id]: {
      attempts: 1,
      incorrect: 1,
      hintsUsed: 0,
      lastAttemptAt: '2026-08-03T18:30:00.000Z'
    }
  }
};
const reviewFirst = buildJourneyFrontier(reviewProgress, emptyCurriculumProgress(), {
  includeReview: true,
  goal: 'backend',
  bypassedModuleIds: [...checkpoint.moduleIds],
  checkpointRemediations: [state]
});
assert.equal(reviewFirst.action.routeReasonCode, 'retrieval-review',
  'Existing unresolved retrieval debt must remain above checkpoint remediation.');

const prerequisiteLessons = curriculumLessons.filter(lesson => prerequisiteModuleSet.has(lesson.module));
const repairedCurriculum = {
  ...emptyCurriculumProgress(),
  completedLessons: prerequisiteLessons.map(lesson => lesson.id),
  completedSections: prerequisiteLessons.flatMap(lesson => lesson.sections.map(section => section.id)),
  answers: Object.fromEntries(prerequisiteLessons.flatMap(lesson => lessonChecks(lesson).map(check => [check.id, {
    optionIndex: check.correctIndex,
    correct: true,
    answeredAt: '2026-08-03T18:30:00.000Z'
  }]))),
  updatedAt: '2026-08-03T18:30:00.000Z'
};
const prerequisiteFoundationTasks = prerequisiteModuleIds.flatMap(moduleId => foundationTasksForModule(moduleId));
const repairedTaskIds = Array.from(new Set([
  ...prerequisiteFoundationTasks.map(task => task.id),
  ...state.modules.flatMap(module => module.weakTaskIds)
]));
const repairedProgress = progressWithIndependentAt(
  '2026-08-03T18:30:00.000Z',
  repairedTaskIds
);
assert.deepEqual(unresolvedCheckpointRemediationModules(state, repairedProgress), [],
  'Retry fixture must repair every weak checkpoint task and the complete prerequisite prefix.');
const retry = buildJourneyFrontier(repairedProgress, repairedCurriculum, {
  includeReview: false,
  goal: 'analyst',
  passedCheckpointIds: priorCheckpointIds,
  checkpointRemediations: [state]
});
assert.equal(retry.action.stage, 'checkpoint',
  `Fresh targeted repair must retry ${checkpoint.id}; got ${retry.action.stage}:${retry.action.moduleId || retry.action.checkpointId}.`);
assert.equal(retry.action.checkpointId, checkpoint.id);
assert.equal(retry.action.routeReasonCode, 'checkpoint-remediation');
assert.equal(retry.action.remediationCheckpointId, checkpoint.id);
assert.ok(!retry.passedPhaseIds.includes(state.phaseId),
  'Remediation activity alone must never mark the checkpoint phase passed.');

const afterPass = buildJourneyFrontier(repairedProgress, repairedCurriculum, {
  includeReview: false,
  goal: 'analyst',
  passedCheckpointIds: [...priorCheckpointIds, checkpoint.id],
  checkpointRemediations: [state]
});
assert.notEqual(afterPass.action.routeReasonCode, 'checkpoint-remediation',
  'A real passed report must clear remediation priority.');
assert.ok(afterPass.passedPhaseIds.includes(state.phaseId));

console.log(`Checkpoint remediation validated: latest failed attempt, ownership/status filtering, ${state.modules.length} bounded weak modules, all-goal priority, complete prerequisite prefix, post-report repair, explicit retry and pass clearing.`);
