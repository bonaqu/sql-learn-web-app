import { advancedCurriculumLessons } from '../src/data/advanced-curriculum.ts';
import { curriculumLessons } from '../src/data/complete-curriculum.ts';
import { lessonChecks } from '../src/data/lesson-checks.ts';
import { tasks } from '../src/data/course-catalog.ts';
import type { AssessmentReport } from '../src/lib/assessment.ts';
import {
  DIAGNOSTIC_GLOBAL_BYPASS,
  DIAGNOSTIC_MODULE_BYPASS,
  lessonAccess,
  PREREQUISITE_MASTERY
} from '../src/lib/curriculum-access.ts';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress.ts';
import type { Progress } from '../src/lib/progress.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const answeredAt = '2026-07-25T09:30:00.000Z';
const emptyProgress: Progress = {
  version: 4,
  completed: [],
  taskStats: {},
  xp: 0,
  streak: 0,
  history: days.map(day => ({ day, solved: 0 }))
};
const emptyCurriculum = emptyCurriculumProgress();
const dmlLesson = advancedCurriculumLessons.find(lesson => lesson.module === 'dml');
const coreLesson = curriculumLessons.find(lesson => lesson.module === 'sql-thinking');

function diagnosticReport(score: number, module: string, moduleScore: number): AssessmentReport {
  return {
    version: 1,
    id: `diagnostic-${score}-${moduleScore}`,
    userId: 'validator',
    mode: 'diagnostic',
    status: 'completed',
    startedAt: '2026-07-25T09:00:00.000Z',
    completedAt: answeredAt,
    durationSeconds: 1800,
    score,
    grade: score >= 80 ? 'strong' : score >= 60 ? 'ready' : 'developing',
    accuracy: score,
    firstAttemptRate: score,
    independence: score,
    readinessDelta: 0,
    taskScores: [],
    moduleScores: [{ module, title: module, score: moduleScore, correct: moduleScore >= 70 ? 1 : 0, total: 1 }],
    strengths: [],
    weaknesses: [],
    localDebrief: 'Validation fixture for curriculum access.'
  };
}

assert(Boolean(dmlLesson), 'DML advanced lesson is missing');
assert(Boolean(coreLesson), 'Core SQL-thinking lesson is missing');
assert(PREREQUISITE_MASTERY >= 50 && PREREQUISITE_MASTERY <= 80, 'Prerequisite mastery threshold is unreasonable');
assert(DIAGNOSTIC_MODULE_BYPASS > PREREQUISITE_MASTERY, 'Module diagnostic bypass must be stricter than task readiness');
assert(DIAGNOSTIC_GLOBAL_BYPASS > DIAGNOSTIC_MODULE_BYPASS, 'Global diagnostic bypass must be the strictest path');
assert(advancedCurriculumLessons.every(lesson => lesson.prerequisites.length > 0), 'Every advanced lesson must declare prerequisites');

if (dmlLesson && coreLesson) {
  assert(lessonAccess(coreLesson, emptyProgress, emptyCurriculum, []).unlocked, 'Core lesson without prerequisites must stay unlocked');
  assert(!lessonAccess(dmlLesson, emptyProgress, emptyCurriculum, []).unlocked, 'Advanced DML must be locked without evidence');

  const transactionTasks = tasks.filter(task => task.module === 'transactions');
  const taskReady: Progress = {
    ...emptyProgress,
    completed: transactionTasks.map(task => task.id),
    taskStats: Object.fromEntries(transactionTasks.map(task => [task.id, {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      solutionViews: 0,
      independentPasses: 1,
      lastIndependentAt: answeredAt,
      lastAttemptAt: answeredAt,
      completedAt: answeredAt
    }]))
  };
  const taskAccess = lessonAccess(dmlLesson, taskReady, emptyCurriculum, []);
  assert(taskAccess.unlocked, 'Independent task mastery must unlock a prerequisite');
  assert(taskAccess.bypassed.length === 0, 'Task mastery is not a diagnostic bypass');

  const completionOnly: Progress = {
    ...emptyProgress,
    completed: transactionTasks.map(task => task.id)
  };
  assert(!lessonAccess(dmlLesson, completionOnly, emptyCurriculum, []).unlocked,
    'Completion flags without attempt or independence evidence must not masquerade as mastery');

  const transactionLessons = curriculumLessons.filter(lesson => lesson.module === 'transactions');
  const lessonReady = {
    ...emptyCurriculum,
    completedSections: transactionLessons.flatMap(lesson => lesson.sections.map(section => section.id)),
    completedLessons: transactionLessons.map(lesson => lesson.id),
    answers: Object.fromEntries(transactionLessons.flatMap(lesson => lessonChecks(lesson).map(check => [check.id, {
      optionIndex: check.correctIndex,
      correct: true,
      answeredAt
    }]))),
    updatedAt: answeredAt
  };
  assert(lessonAccess(dmlLesson, emptyProgress, lessonReady, []).unlocked, 'Completed prerequisite lessons with all concept checks must unlock DML');

  const weakDiagnostic = diagnosticReport(60, 'transactions', 60);
  assert(!lessonAccess(dmlLesson, emptyProgress, emptyCurriculum, [weakDiagnostic]).unlocked, 'Weak diagnostic must not unlock advanced content');

  const moduleDiagnostic = diagnosticReport(72, 'transactions', DIAGNOSTIC_MODULE_BYPASS);
  const moduleAccess = lessonAccess(dmlLesson, emptyProgress, emptyCurriculum, [moduleDiagnostic]);
  assert(moduleAccess.unlocked, 'Strong prerequisite module score must unlock DML');
  assert(moduleAccess.bypassed.some(item => item.source === 'diagnostic-module'), 'Module bypass evidence must be visible');

  const globalDiagnostic = diagnosticReport(DIAGNOSTIC_GLOBAL_BYPASS, 'select', 40);
  const globalAccess = lessonAccess(dmlLesson, emptyProgress, emptyCurriculum, [globalDiagnostic]);
  assert(globalAccess.unlocked, 'Exceptional global diagnostic must unlock DML');
  assert(globalAccess.bypassed.some(item => item.source === 'diagnostic-global'), 'Global bypass evidence must be visible');
}

if (failures.length) {
  console.error(`Curriculum access validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Curriculum access validated: ${advancedCurriculumLessons.length} advanced lessons, multi-check prerequisite evidence, mastery ${PREREQUISITE_MASTERY}%, module bypass ${DIAGNOSTIC_MODULE_BYPASS}%, global bypass ${DIAGNOSTIC_GLOBAL_BYPASS}%.`);
