import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { curriculumLessons } from '../src/data/complete-curriculum';
import { tasks } from '../src/data/course-catalog';
import { lessonChecks } from '../src/data/lesson-checks';
import { phaseForModule } from '../src/data/learning-structure';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress';
import { goalModuleFrontier, goalModuleRoute } from '../src/lib/goal-aware-route';
import { nextJourneyAction, type JourneyAction } from '../src/lib/learning-journey';
import type { Progress } from '../src/lib/progress';
import {
  workspaceStageLabel,
  workspaceTaskReadiness
} from '../src/lib/workspace-readiness';

const timestamp = '2026-08-01T10:00:00.000Z';
const emptyProgress: Progress = {
  version: 4,
  completed: [],
  taskStats: {},
  xp: 0,
  streak: 0,
  history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }))
};

const emptyCurriculum = emptyCurriculumProgress();
const firstAction = nextJourneyAction(emptyProgress, emptyCurriculum, { includeReview: false, goal: 'support' });
const firstModuleTask = tasks.find(task => task.module === firstAction.moduleId);
const firstInterview = tasks.find(task => task.mode === 'interview');
assert.ok(firstModuleTask, 'The first shared module needs a workspace task.');
assert.ok(firstInterview, 'The course needs an Interview task for readiness validation.');

if (firstModuleTask) {
  const readiness = workspaceTaskReadiness(firstModuleTask, emptyProgress, {
    action: firstAction,
    passedPhaseIds: []
  }, 'practice');
  assert.equal(firstAction.stage, 'lesson');
  assert.equal(firstAction.routeReasonCode, 'shared-foundation');
  assert.equal(readiness.status, 'preview', 'Tasks must stay preview-only before the module lesson.');
  assert.equal(readiness.canRun, false);
  assert.match(readiness.reason, /урок/i);
}

if (firstInterview) {
  const readiness = workspaceTaskReadiness(firstInterview, emptyProgress, {
    action: firstAction,
    passedPhaseIds: []
  }, 'interview');
  assert.equal(readiness.status, 'preview', 'Interview must not be a beginner entry point.');
  assert.equal(readiness.canRun, false);
  assert.match(readiness.reason, /контрольн(?:ая|ую) точк/i);

  const phase = phaseForModule(firstInterview.module);
  assert.ok(phase, 'Interview task must belong to a checkpoint phase.');
  if (phase) {
    const staleCheckpoint = workspaceTaskReadiness(firstInterview, emptyProgress, {
      action: firstAction,
      passedPhaseIds: [phase.id]
    }, 'interview');
    assert.equal(staleCheckpoint.status, 'preview',
      'A checkpoint report alone must not open transfer when the module foundation is incomplete.');
    assert.equal(staleCheckpoint.canRun, false);

    const opened = workspaceTaskReadiness(firstInterview, emptyProgress, {
      action: firstAction,
      passedPhaseIds: [phase.id],
      completedModuleIds: [firstInterview.module]
    }, 'interview');
    assert.equal(opened.status, 'ready',
      'Checkpoint plus completed module foundation must open transfer tasks.');
    assert.equal(opened.canRun, true);
  }
}

const firstLesson = curriculumLessons[0];
const lessonComplete = {
  ...emptyCurriculum,
  completedSections: firstLesson.sections.map(section => section.id),
  completedLessons: [firstLesson.id],
  answers: Object.fromEntries(lessonChecks(firstLesson).map(check => [check.id, {
    optionIndex: check.correctIndex,
    correct: true,
    answeredAt: timestamp
  }])),
  updatedAt: timestamp
};
const practiceAction = nextJourneyAction(emptyProgress, lessonComplete, { includeReview: false, goal: 'support' });
assert.ok(practiceAction.task, 'The first lesson must lead to a concrete task.');
if (practiceAction.task) {
  const current = workspaceTaskReadiness(practiceAction.task, emptyProgress, {
    action: practiceAction,
    passedPhaseIds: []
  }, 'practice');
  assert.equal(current.status, 'ready');
  assert.equal(current.canRun, true);

  const review = workspaceTaskReadiness(practiceAction.task, emptyProgress, null, 'review');
  assert.equal(review.status, 'ready', 'Explicit retrieval review must remain runnable.');

  const completedProgress: Progress = {
    ...emptyProgress,
    completed: [practiceAction.task.id]
  };
  const repeat = workspaceTaskReadiness(practiceAction.task, completedProgress, null, 'practice');
  assert.equal(repeat.status, 'ready', 'Previously completed work must remain repeatable.');
}

const analystRoute = goalModuleRoute('analyst');
let branchFrontier = goalModuleFrontier('analyst', analystRoute.slice(0, 12));
for (let prefix = 12; prefix < analystRoute.length && branchFrontier.eligibleModuleIds.length < 2; prefix += 1) {
  branchFrontier = goalModuleFrontier('analyst', analystRoute.slice(0, prefix));
}
assert.ok(branchFrontier.nextModuleId, 'Analyst route needs a next module.');
assert.ok(branchFrontier.eligibleModuleIds.length >= 2,
  'The route graph needs a real branch to validate goal-prioritized eligible modules.');

if (branchFrontier.nextModuleId && branchFrontier.eligibleModuleIds.length >= 2) {
  const currentModule = branchFrontier.nextModuleId;
  const deferredEligibleModule = branchFrontier.eligibleModuleIds.find(moduleId => moduleId !== currentModule)!;
  const lockedModule = branchFrontier.routeModuleIds.find(moduleId =>
    !branchFrontier.completedModuleIds.includes(moduleId)
    && !branchFrontier.eligibleModuleIds.includes(moduleId)
  );
  const currentTask = tasks.find(task => task.module === currentModule && (task.mode === 'lesson' || task.mode === 'practice'));
  const eligibleTask = tasks.find(task => task.module === deferredEligibleModule && (task.mode === 'lesson' || task.mode === 'practice'));
  const lockedTask = lockedModule
    ? tasks.find(task => task.module === lockedModule && (task.mode === 'lesson' || task.mode === 'practice'))
    : null;
  const completedTask = tasks.find(task =>
    task.module === branchFrontier.completedModuleIds[branchFrontier.completedModuleIds.length - 1]
    && (task.mode === 'lesson' || task.mode === 'practice')
  );
  assert.ok(currentTask && eligibleTask && lockedTask && completedTask,
    'Frontier readiness fixture requires current, deferred eligible, locked and completed tasks.');

  if (currentTask && eligibleTask && lockedTask && completedTask) {
    const action: JourneyAction = {
      ...firstAction,
      moduleId: currentModule,
      moduleTitle: currentModule,
      phaseId: phaseForModule(currentModule)?.id || null,
      phaseTitle: phaseForModule(currentModule)?.title || null,
      title: `Урок ${currentModule}`,
      stage: 'lesson',
      routeReasonCode: 'goal-priority',
      routeReason: 'Цель «SQL для аналитики» выбрала этот модуль после прохождения всех обязательных предыдущих тем.',
      frontierCompletedModuleIds: branchFrontier.completedModuleIds,
      frontierEligibleModuleIds: branchFrontier.eligibleModuleIds,
      frontierRouteModuleIds: branchFrontier.routeModuleIds,
      frontierPassedPhaseIds: []
    };
    const state = { action, passedPhaseIds: [] };

    const current = workspaceTaskReadiness(currentTask, emptyProgress, state, 'practice');
    assert.equal(current.status, 'preview');
    assert.match(current.label, /разберись в модели/i);

    const deferredEligible = workspaceTaskReadiness(eligibleTask, emptyProgress, state, 'practice');
    assert.equal(deferredEligible.status, 'preview');
    assert.match(deferredEligible.label, /Предварительные темы пройдены/i,
      'An eligible module deferred by the goal must be visible but not runnable before the chosen frontier.');

    const locked = workspaceTaskReadiness(lockedTask, emptyProgress, state, 'practice');
    assert.equal(locked.status, 'preview');
    assert.match(locked.label, /Предварительные темы не пройдены/i,
      'A module with missing prerequisites must remain locked regardless of goal preference.');

    const completed = workspaceTaskReadiness(completedTask, emptyProgress, state, 'practice');
    assert.equal(completed.status, 'ready');
    assert.match(completed.label, /Базовый модуль открыт/i);
  }
}

assert.equal(workspaceStageLabel(tasks.find(task => task.mode === 'lesson')!), 'С поддержкой');
assert.equal(workspaceStageLabel(tasks.find(task => task.mode === 'practice')!), 'Практика');
assert.equal(workspaceStageLabel(tasks.find(task => task.mode === 'interview')!), 'Интервью');
assert.equal(workspaceStageLabel(tasks.find(task => task.mode === 'puzzle')!), 'Головоломка');

const readinessSource = readFileSync(new URL('../src/lib/workspace-readiness.ts', import.meta.url), 'utf8');
for (const marker of [
  'frontierCompletedModuleIds',
  'frontierEligibleModuleIds',
  'frontierRouteModuleIds',
  'passedPhaseIds.includes(taskPhase.id)',
  'completedModuleIds.includes(task.module)',
  'Предварительные темы пройдены · позже по цели',
  'Предварительные темы не пройдены · предпросмотр'
]) assert.ok(readinessSource.includes(marker), `Workspace frontier logic is missing ${marker}.`);
assert.doesNotMatch(readinessSource, /phaseOrder|moduleOrderIndex|earlierPhase|laterPhase/,
  'Workspace readiness must not rebuild a physical phase/module-index route.');

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
for (const marker of [
  'workspaceTaskReadiness',
  'workspace-preview-gate',
  'Предпросмотр без зачёта',
  'Запуск пока закрыт',
  'workspace-next-step',
  'openCanonicalAction',
  'JOURNEY_EVIDENCE_EVENTS'
]) assert.ok(appSource.includes(marker), `Workspace integration is missing ${marker}.`);
assert.match(appSource, /disabled=\{!engine \|\| !selectedReadiness\.canRun\}/,
  'SQL execution must be disabled while a task is preview-only.');
assert.match(appSource, /disabled=\{!selectedReadiness\.canRun \|\| visibleHints/,
  'Hints must stay disabled while a task is preview-only.');
assert.match(appSource, /disabled=\{!selectedReadiness\.canRun\}/,
  'Reference solution must stay disabled while a task is preview-only.');

const cssSource = readFileSync(new URL('../src/workspace-readiness.css', import.meta.url), 'utf8');
for (const marker of ['.task-row.preview', '.workspace-readiness-gate', '.workspace-next-step']) {
  assert.ok(cssSource.includes(marker), `Workspace readiness styling is missing ${marker}.`);
}

console.log('Workspace readiness validated: one goal-aware frontier, browseable eligible previews, prerequisite locks, module-plus-checkpoint transfer and canonical post-success navigation.');
