import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { curriculumLessons } from '../src/data/complete-curriculum';
import { tasks } from '../src/data/course-catalog';
import { lessonChecks } from '../src/data/lesson-checks';
import { phaseForModule } from '../src/data/learning-structure';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress';
import { nextJourneyAction } from '../src/lib/learning-journey';
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
const firstAction = nextJourneyAction(emptyProgress, emptyCurriculum, { includeReview: false });
const firstModuleTask = tasks.find(task => task.module === firstAction.moduleId);
const firstInterview = tasks.find(task => task.mode === 'interview');
assert.ok(firstModuleTask, 'The first canonical module needs a workspace task.');
assert.ok(firstInterview, 'The course needs an Interview task for readiness validation.');

if (firstModuleTask) {
  const readiness = workspaceTaskReadiness(firstModuleTask, emptyProgress, {
    action: firstAction,
    passedPhaseIds: []
  }, 'practice');
  assert.equal(firstAction.stage, 'lesson');
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
  assert.match(readiness.reason, /checkpoint/i);

  const phase = phaseForModule(firstInterview.module);
  assert.ok(phase, 'Interview task must belong to a canonical phase.');
  if (phase) {
    const opened = workspaceTaskReadiness(firstInterview, emptyProgress, {
      action: firstAction,
      passedPhaseIds: [phase.id]
    }, 'interview');
    assert.equal(opened.status, 'ready', 'A real phase checkpoint must open transfer tasks.');
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
const practiceAction = nextJourneyAction(emptyProgress, lessonComplete, { includeReview: false });
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

assert.equal(workspaceStageLabel(tasks.find(task => task.mode === 'lesson')!), 'Guided');
assert.equal(workspaceStageLabel(tasks.find(task => task.mode === 'practice')!), 'Practice');
assert.equal(workspaceStageLabel(tasks.find(task => task.mode === 'interview')!), 'Interview');
assert.equal(workspaceStageLabel(tasks.find(task => task.mode === 'puzzle')!), 'Puzzle');

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
for (const marker of [
  'workspaceTaskReadiness',
  'workspace-preview-gate',
  'Preview без mastery',
  'Preview: запуск закрыт',
  'workspace-next-step',
  'openCanonicalAction',
  'JOURNEY_EVIDENCE_EVENTS'
]) {
  assert.ok(appSource.includes(marker), `Workspace integration is missing ${marker}.`);
}
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

console.log('Workspace readiness validated: browseable previews, gated execution, checkpoint-opened transfer and canonical post-success navigation.');
