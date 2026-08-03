import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  capstoneProjects,
  curriculumCheckpoints,
  curriculumLessons
} from '../src/data/complete-curriculum';
import { tasks, type SqlTask } from '../src/data/course-catalog';
import { canonicalModuleIds, phaseDefinitions } from '../src/data/learning-structure';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress';
import {
  learningRouteForGoal,
  prioritizeRouteReviews
} from '../src/lib/goal-aware-learning-route';
import {
  foundationTasksForModule,
  nextJourneyAction,
  transferTasksForModule
} from '../src/lib/learning-journey';
import { buildDailySession } from '../src/lib/learning-path';
import { goalOptions, type LearnerGoal } from '../src/lib/learner-onboarding';
import type { Progress, TaskStats } from '../src/lib/progress';

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

function progressWithIndependentEvidence(selected: SqlTask[]): Progress {
  const taskStats: Record<string, TaskStats> = {};
  for (const task of selected) {
    taskStats[task.id] = {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      independentPasses: 1,
      completedAt: '2026-08-03T00:00:00.000Z',
      lastAttemptAt: '2026-08-03T00:00:00.000Z'
    };
  }
  return {
    ...emptyProgress(),
    completed: selected.map(task => task.id),
    taskStats,
    xp: selected.reduce((sum, task) => sum + task.xp, 0)
  };
}

const goals = goalOptions.map(option => option.id);
assert.deepEqual(goals, ['support', 'analyst', 'backend', 'interview', 'full']);
assert.equal(new Set(goals).size, 5);

const firstLesson = curriculumLessons[0];
const firstModule = canonicalModuleIds[0];
const newLearnerActions = new Map<LearnerGoal, ReturnType<typeof nextJourneyAction>>();
for (const goal of goals) {
  const route = learningRouteForGoal(goal, 'steady', 25);
  const action = nextJourneyAction(emptyProgress(), emptyCurriculumProgress(), {
    includeReview: false,
    route
  });
  newLearnerActions.set(goal, action);
  assert.equal(action.kind, 'lesson', `${goal}: preference must not skip the first lesson.`);
  assert.equal(action.lessonId, firstLesson.id, `${goal}: must start with canonical lesson 01.`);
  assert.equal(action.moduleId, firstModule, `${goal}: must start in SQL thinking.`);
  assert.equal(action.routeTitle, route.title);
  assert.ok(action.description.startsWith(route.stageFocus.lesson), `${goal}: lesson framing must be goal-aware.`);
}
assert.equal(new Set([...newLearnerActions.values()].map(action => action.lessonId)).size, 1,
  'Every onboarding goal must share the same prerequisite-safe zero-knowledge frontier.');
assert.equal(new Set([...newLearnerActions.values()].map(action => action.routeRationale)).size, 5,
  'Goals must change the learning rationale instead of being decorative profile metadata.');

const firstPhase = phaseDefinitions[0];
const firstPhaseLessons = curriculumLessons.filter(lesson => firstPhase.moduleIds.some(id => id === lesson.module));
const firstPhaseFoundation = firstPhase.moduleIds.flatMap(moduleId => foundationTasksForModule(moduleId));
const completedFirstPhaseCurriculum = {
  ...emptyCurriculumProgress(),
  completedLessons: firstPhaseLessons.map(lesson => lesson.id),
  completedSections: firstPhaseLessons.flatMap(lesson => lesson.sections.map(section => section.id)),
  answers: Object.fromEntries(firstPhaseLessons.map(lesson => [lesson.check.id, {
    optionIndex: lesson.check.correctIndex,
    correct: true,
    answeredAt: '2026-08-03T00:00:00.000Z'
  }]))
};
const firstCheckpoint = curriculumCheckpoints.find(checkpoint =>
  checkpoint.moduleIds.some(moduleId => firstPhase.moduleIds.some(id => id === moduleId))
);
assert.ok(firstCheckpoint, 'The first phase needs a checkpoint for transfer validation.');

const transferExpectations: Record<LearnerGoal, 'interview' | 'puzzle'> = {
  support: 'puzzle',
  analyst: 'puzzle',
  backend: 'interview',
  interview: 'interview',
  full: 'interview'
};
const firstTransferModule = firstPhase.moduleIds.find(moduleId => {
  const modes = new Set(transferTasksForModule(moduleId).map(task => task.mode));
  return modes.has('interview') && modes.has('puzzle');
});
assert.ok(firstTransferModule, 'The first phase needs both Interview and Puzzle transfer evidence.');

if (firstCheckpoint && firstTransferModule) {
  const progress = progressWithIndependentEvidence(firstPhaseFoundation);
  for (const goal of goals) {
    const route = learningRouteForGoal(goal);
    const action = nextJourneyAction(progress, completedFirstPhaseCurriculum, {
      includeReview: false,
      passedCheckpointIds: [firstCheckpoint.id],
      route
    });
    assert.equal(action.moduleId, firstTransferModule, `${goal}: transfer must begin in the first canonical module.`);
    assert.equal(action.stage, transferExpectations[goal], `${goal}: transfer order does not match the goal policy.`);
    assert.ok(action.task && transferTasksForModule(firstTransferModule).some(task => task.id === action.task?.id));
  }

  const supportRoute = learningRouteForGoal('support');
  const firstSupportTransfer = nextJourneyAction(progress, completedFirstPhaseCurriculum, {
    includeReview: false,
    passedCheckpointIds: [firstCheckpoint.id],
    route: supportRoute
  });
  assert.equal(firstSupportTransfer.stage, 'puzzle');
  const afterPuzzle = progressWithIndependentEvidence([
    ...firstPhaseFoundation,
    firstSupportTransfer.task as SqlTask
  ]);
  const secondSupportTransfer = nextJourneyAction(afterPuzzle, completedFirstPhaseCurriculum, {
    includeReview: false,
    passedCheckpointIds: [firstCheckpoint.id],
    route: supportRoute
  });
  assert.equal(secondSupportTransfer.stage, 'interview',
    'Preferred transfer order must not remove the other mandatory transfer task.');
}

const expectedFirstProject: Record<LearnerGoal, string> = {
  support: 'project-incident-command',
  analyst: 'project-executive-mart',
  backend: 'project-data-trust',
  interview: 'project-executive-mart',
  full: 'project-incident-command'
};
for (const goal of goals) {
  const action = nextJourneyAction(emptyProgress(), emptyCurriculumProgress(), {
    includeReview: false,
    passedCheckpointIds: curriculumCheckpoints.map(checkpoint => checkpoint.id),
    bypassedModuleIds: canonicalModuleIds,
    assessmentComplete: true,
    route: learningRouteForGoal(goal)
  });
  assert.equal(action.kind, 'project');
  assert.equal(action.projectId, expectedFirstProject[goal], `${goal}: wrong first capstone recommendation.`);
  assert.ok(capstoneProjects.some(project => project.id === action.projectId));
}

const boundedQueue = [
  { id: 'due-1', module: 'sorting' },
  { id: 'due-2', module: 'select' },
  { id: 'due-3', module: 'text' },
  { id: 'due-4', module: 'set-ops' },
  { id: 'due-5', module: 'support' },
  { id: 'outside-window', module: 'filtering' }
];
const supportReviews = prioritizeRouteReviews(boundedQueue, learningRouteForGoal('support'), 2, 5);
assert.equal(supportReviews[0].id, 'due-5', 'Goal priority should reorder relevant tasks inside the due window.');
assert.ok(!supportReviews.some(item => item.id === 'outside-window'),
  'Goal preference must not pull a less urgent task from outside the bounded due window.');

for (const goal of goals) {
  const route = learningRouteForGoal(goal, 'steady', 25);
  const session = buildDailySession(emptyProgress(), 25, {
    curriculum: emptyCurriculumProgress(),
    route
  });
  const primary = session.items.find(item => item.action);
  assert.equal(primary?.action?.lessonId, firstLesson.id, `${goal}: daily session skipped the zero-knowledge lesson.`);
  assert.ok(primary?.label.startsWith(`${route.title}:`), `${goal}: adaptive session label lost goal context.`);
}

const journeySource = readFileSync(new URL('../src/lib/learning-journey.ts', import.meta.url), 'utf8');
const sessionSource = readFileSync(new URL('../src/lib/learning-path.ts', import.meta.url), 'utf8');
const todaySource = readFileSync(new URL('../src/components/GuidedHome.tsx', import.meta.url), 'utf8');
const portalSource = readFileSync(new URL('../src/components/LearningPathPortal.tsx', import.meta.url), 'utf8');

for (const marker of ['route?: LearningRoutePolicy', 'preferredTransferMode', 'preferredProjectIds', 'routeRationale']) {
  assert.ok(journeySource.includes(marker), `Canonical journey is missing ${marker}.`);
}
for (const marker of ['learningRouteForProfile(loadOnboardingProfile())', 'prioritizeRouteReviews', 'route: evidence.route', 'route.dailyMinutes']) {
  assert.ok(sessionSource.includes(marker), `Adaptive session is missing ${marker}.`);
}
for (const marker of ['learningRouteForProfile(profile)', 'route', "includeReview", 'data-route-goal={route.goal}']) {
  assert.ok(todaySource.includes(marker), `Today surface is missing ${marker}.`);
}
assert.ok(portalSource.includes('buildDailySession(progress, targetMinutes, sessionEvidence)'),
  'Adaptive Path must use the shared session engine rather than duplicate goal policy.');
assert.ok(portalSource.includes('mentorPlanContext(progress, sessionEvidence)'),
  'Mentor context must use the same shared goal-aware session evidence.');

console.log('Goal-aware learning routes validated: 5 goals share the zero-knowledge prerequisite frontier while personalizing bounded review, transfer reasoning, session context and capstone order.');
