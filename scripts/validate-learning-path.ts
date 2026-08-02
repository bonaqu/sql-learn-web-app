import { curriculumCheckpoints, curriculumLessons } from '../src/data/complete-curriculum.ts';
import { modules, tasks } from '../src/data/course-catalog.ts';
import { lessonChecks } from '../src/data/lesson-checks.ts';
import {
  buildDailySession,
  learningPhases,
  moduleMastery,
  overallReadiness,
  phaseDefinitions,
  type LearningSessionEvidence
} from '../src/lib/learning-path.ts';
import { nextJourneyAction, type JourneyAction } from '../src/lib/learning-journey.ts';
import { emptyCurriculumProgress, type CurriculumProgressV1 } from '../src/lib/curriculum-progress.ts';
import type { Progress } from '../src/lib/progress.ts';

const timestamp = '2026-08-01T10:00:00.000Z';
const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const emptyProgress: Progress = {
  version: 4,
  completed: [],
  taskStats: {},
  xp: 0,
  streak: 0,
  history: days.map(day => ({ day, solved: 0 }))
};

const practicedProgress: Progress = {
  ...emptyProgress,
  completed: tasks.slice(0, 18).filter((_, index) => index % 2 === 0).map(task => task.id),
  taskStats: Object.fromEntries(tasks.slice(0, 25).map((task, index) => [task.id, {
    attempts: (index % 3) + 1,
    incorrect: index % 2,
    hintsUsed: index % 4 === 0 ? 1 : 0,
    independentPasses: index % 2 === 0 && index % 4 !== 0 ? 1 : 0,
    solutionViews: 0,
    lastIndependentAt: index % 2 === 0 && index % 4 !== 0 ? timestamp : undefined,
    lastAttemptAt: new Date(Date.parse(timestamp) - index * 86_400_000).toISOString(),
    completedAt: index % 2 === 0 ? new Date(Date.parse(timestamp) - index * 86_400_000).toISOString() : undefined
  }]))
};

const completedProgress: Progress = {
  ...emptyProgress,
  completed: tasks.map(task => task.id),
  xp: tasks.reduce((sum, task) => sum + task.xp, 0),
  taskStats: Object.fromEntries(tasks.map(task => [task.id, {
    attempts: 1,
    incorrect: 0,
    hintsUsed: 0,
    solutionViews: 0,
    independentPasses: 1,
    lastIndependentAt: timestamp,
    completedAt: timestamp,
    lastAttemptAt: timestamp
  }]))
};

const completedCurriculum: CurriculumProgressV1 = {
  ...emptyCurriculumProgress(),
  completedSections: curriculumLessons.flatMap(lesson => lesson.sections.map(section => section.id)),
  completedLessons: curriculumLessons.map(lesson => lesson.id),
  answers: Object.fromEntries(curriculumLessons.flatMap(lesson => lessonChecks(lesson).map(check => [check.id, {
    optionIndex: check.correctIndex,
    correct: true,
    answeredAt: timestamp
  }]))),
  updatedAt: timestamp
};

const failures: string[] = [];
const mastery = moduleMastery(practicedProgress);
const phases = learningPhases(practicedProgress, mastery);
const moduleIds = modules.map(([id]) => id);
const phaseModuleIds = phaseDefinitions.flatMap(phase => [...phase.moduleIds]);
const phaseModuleCounts = new Map<string, number>();

for (const moduleId of phaseModuleIds) {
  phaseModuleCounts.set(moduleId, (phaseModuleCounts.get(moduleId) ?? 0) + 1);
}

function actionIdentity(action: JourneyAction) {
  return [
    action.kind,
    action.stage,
    action.task?.id || '',
    action.lessonId || '',
    action.checkpointId || '',
    action.projectId || ''
  ].join(':');
}

function validateSession(
  name: string,
  progress: Progress,
  evidence: LearningSessionEvidence,
  targetMinutes = 25
) {
  const session = buildDailySession(progress, targetMinutes, evidence);
  const expected = nextJourneyAction(progress, evidence.curriculum, {
    includeReview: false,
    passedCheckpointIds: evidence.passedCheckpointIds,
    assessmentComplete: evidence.assessmentComplete,
    bypassedModuleIds: evidence.bypassedModuleIds
  });
  const primaryItems = session.items.filter(item => item.action);

  if (!session.items.length || session.items.length > 3) {
    failures.push(`${name}: session must contain 1..3 evidence-aware items, received ${session.items.length}`);
  }
  if (new Set(session.items.map(item => item.id)).size !== session.items.length) {
    failures.push(`${name}: session contains duplicate item IDs`);
  }
  if (session.items.some(item => !item.task && !item.action)) {
    failures.push(`${name}: every session item needs a task or journey action`);
  }
  if (primaryItems.length !== 1 || !primaryItems[0].action) {
    failures.push(`${name}: session must retain exactly one canonical JourneyAction`);
  } else if (actionIdentity(primaryItems[0].action) !== actionIdentity(expected)) {
    failures.push(`${name}: Adaptive Path diverged from canonical selector: ${actionIdentity(primaryItems[0].action)} != ${actionIdentity(expected)}`);
  }
  if (session.totalMinutes <= 0 || session.totalMinutes > Math.max(targetMinutes + 30, 55)) {
    failures.push(`${name}: unexpected session duration ${session.totalMinutes}`);
  }
  return session;
}

if (mastery.length !== modules.length) {
  failures.push(`Expected ${modules.length} mastery modules, received ${mastery.length}`);
}
if (phases.length !== phaseDefinitions.length) {
  failures.push(`Expected ${phaseDefinitions.length} learning phases, received ${phases.length}`);
}
if (new Set(phaseDefinitions.map(phase => phase.id)).size !== phaseDefinitions.length) {
  failures.push('Learning phase IDs must be unique');
}

const missingModules = moduleIds.filter(moduleId => !phaseModuleCounts.has(moduleId));
const duplicatedModules = moduleIds.filter(moduleId => (phaseModuleCounts.get(moduleId) ?? 0) > 1);
const unknownModules = [...phaseModuleCounts.keys()].filter(moduleId => !moduleIds.includes(moduleId as never));

if (missingModules.length) failures.push(`Modules missing from learning phases: ${missingModules.join(', ')}`);
if (duplicatedModules.length) failures.push(`Modules assigned to multiple phases: ${duplicatedModules.join(', ')}`);
if (unknownModules.length) failures.push(`Unknown modules referenced by learning phases: ${unknownModules.join(', ')}`);
if (phaseModuleIds.length !== moduleIds.length) {
  failures.push(`Learning phases reference ${phaseModuleIds.length} module slots for ${moduleIds.length} course modules`);
}
if (mastery.some(item => item.mastery < 0 || item.mastery > 100)) failures.push('Mastery must stay inside 0..100');
if (phases.some(phase => !phase.checkpointTask || !tasks.some(task => task.id === phase.checkpointTask.id))) failures.push('Every legacy phase card needs a real checkpoint preview task');
if (new Set(phases.map(phase => phase.checkpointTask.id)).size !== phases.length) failures.push('Each legacy phase card must use a distinct checkpoint preview task');
if (overallReadiness(emptyProgress) !== 0) failures.push('Empty progress readiness must be zero');
if (overallReadiness(practicedProgress) < 0 || overallReadiness(practicedProgress) > 100) failures.push('Readiness must stay inside 0..100');

const emptySession = validateSession('empty learner', emptyProgress, {
  curriculum: emptyCurriculumProgress()
});
const emptyPrimary = emptySession.items.find(item => item.action)?.action;
if (emptyPrimary?.stage !== 'lesson' || emptyPrimary.lessonId !== curriculumLessons[0].id) {
  failures.push('A new learner Adaptive Path must start with the first canonical lesson');
}

const firstLesson = curriculumLessons[0];
const afterFirstLessonCurriculum: CurriculumProgressV1 = {
  ...emptyCurriculumProgress(),
  completedSections: firstLesson.sections.map(section => section.id),
  completedLessons: [firstLesson.id],
  answers: Object.fromEntries(lessonChecks(firstLesson).map(check => [check.id, {
    optionIndex: check.correctIndex,
    correct: true,
    answeredAt: timestamp
  }])),
  updatedAt: timestamp
};
const afterLessonSession = validateSession('after first lesson', emptyProgress, {
  curriculum: afterFirstLessonCurriculum
});
const afterLessonPrimary = afterLessonSession.items.find(item => item.action)?.action;
if (afterLessonPrimary?.stage !== 'guided' && afterLessonPrimary?.stage !== 'practice') {
  failures.push('Adaptive Path must move from lesson to connected guided/independent task evidence');
}
if (afterLessonPrimary?.moduleId !== firstLesson.module) {
  failures.push('Adaptive Path must keep the first post-lesson task in the same module');
}

if (afterLessonPrimary?.task) {
  const overlappingProgress: Progress = {
    ...emptyProgress,
    taskStats: {
      [afterLessonPrimary.task.id]: {
        attempts: 1,
        incorrect: 1,
        hintsUsed: 0,
        lastAttemptAt: '2026-07-01T10:00:00.000Z'
      }
    }
  };
  const overlapSession = validateSession('review overlaps canonical task', overlappingProgress, {
    curriculum: afterFirstLessonCurriculum
  });
  const matchingItems = overlapSession.items.filter(item => item.task?.id === afterLessonPrimary.task?.id);
  if (matchingItems.length !== 1 || !matchingItems[0].action) {
    failures.push('A due review matching the canonical task must be replaced by one actionable journey item');
  }
}

validateSession('practiced learner', practicedProgress, {
  curriculum: emptyCurriculumProgress()
});

const assessmentSession = validateSession('course complete before assessment', completedProgress, {
  curriculum: completedCurriculum,
  passedCheckpointIds: curriculumCheckpoints.map(checkpoint => checkpoint.id),
  assessmentComplete: false
}, 40);
if (assessmentSession.items.find(item => item.action)?.action?.stage !== 'assessment') {
  failures.push('A learner with course/checkpoint evidence must receive assessment before projects');
}

const projectSession = validateSession('course complete after assessment', completedProgress, {
  curriculum: completedCurriculum,
  passedCheckpointIds: curriculumCheckpoints.map(checkpoint => checkpoint.id),
  assessmentComplete: true
}, 40);
if (projectSession.items.find(item => item.action)?.action?.stage !== 'project') {
  failures.push('A learner with final assessment evidence must advance to the first incomplete capstone');
}

if (overallReadiness(completedProgress) < 90) failures.push('Fully completed course should have high readiness');
if (!moduleMastery(completedProgress).every(item => item.level === 'mastered')) failures.push('Fully independently completed modules must be mastered');

if (failures.length) {
  console.error(`Learning path validation failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`Learning path validated: ${mastery.length} modules, ${phases.length} phases and evidence-aware lesson/task/checkpoint/assessment/project sessions.`);
