import { readFileSync } from 'node:fs';
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
import { journeyStageLabels } from '../src/lib/journey-display.ts';
import { nextJourneyAction, type JourneyAction } from '../src/lib/learning-journey.ts';
import { emptyCurriculumProgress, type CurriculumProgressV1 } from '../src/lib/curriculum-progress.ts';
import type { LearnerGoal } from '../src/lib/learner-onboarding.ts';
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
if (Object.keys(journeyStageLabels).length !== 10) failures.push('Every journey stage needs a learner-facing label');
if (new Set(Object.values(journeyStageLabels)).size !== 10) failures.push('Journey stage labels must remain distinct');
const baseEvidence: LearningSessionEvidence = {
  curriculum: emptyCurriculumProgress(),
  goal: 'full'
};
const mastery = moduleMastery(practicedProgress, baseEvidence);
const phases = learningPhases(practicedProgress, mastery, baseEvidence);
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
    action.projectId || '',
    action.routeReasonCode || ''
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
    goal: evidence.goal,
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
  if (actionIdentity(session.frontier.action) !== actionIdentity(expected)) {
    failures.push(`${name}: returned frontier does not own the same primary action`);
  }
  if (session.frontier.goal !== (evidence.goal || 'full')) {
    failures.push(`${name}: frontier goal ${session.frontier.goal} differs from requested ${evidence.goal || 'full'}`);
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
if (mastery.filter(item => item.routeState === 'current').length > 1) failures.push('Mastery graph may expose only one current frontier module');
if (mastery.some(item => item.level !== 'locked' && item.routeState === 'locked')) failures.push('Locked route modules must not be shown as learnable mastery nodes');
if (phases.some(phase => !phase.checkpointTask || !tasks.some(task => task.id === phase.checkpointTask.id))) failures.push('Every phase card needs a real checkpoint preview task');
if (new Set(phases.map(phase => phase.checkpointTask.id)).size !== phases.length) failures.push('Each phase card must use a distinct checkpoint preview task');
if (overallReadiness(emptyProgress, baseEvidence) !== 0) failures.push('Empty progress readiness must be zero');
if (overallReadiness(practicedProgress, baseEvidence) < 0 || overallReadiness(practicedProgress, baseEvidence) > 100) failures.push('Readiness must stay inside 0..100');

const goals: LearnerGoal[] = ['support', 'analyst', 'backend', 'interview', 'full'];
for (const goal of goals) {
  const emptySession = validateSession(`empty ${goal} learner`, emptyProgress, {
    curriculum: emptyCurriculumProgress(),
    goal
  });
  const emptyPrimary = emptySession.items.find(item => item.action)?.action;
  if (emptyPrimary?.stage !== 'lesson' || emptyPrimary.lessonId !== curriculumLessons[0].id) {
    failures.push(`${goal}: new learner Adaptive Path must start with the first shared lesson`);
  }
  if (emptyPrimary?.routeReasonCode !== 'shared-foundation') {
    failures.push(`${goal}: zero-evidence route must explain the shared foundation`);
  }
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
  curriculum: afterFirstLessonCurriculum,
  goal: 'support'
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
    curriculum: afterFirstLessonCurriculum,
    goal: 'support'
  });
  const matchingItems = overlapSession.items.filter(item => item.task?.id === afterLessonPrimary.task?.id);
  if (matchingItems.length !== 1 || !matchingItems[0].action) {
    failures.push('A due review matching the canonical task must be replaced by one actionable journey item');
  }
}

validateSession('practiced learner', practicedProgress, {
  curriculum: emptyCurriculumProgress(),
  goal: 'analyst'
});

const completedEvidence: LearningSessionEvidence = {
  curriculum: completedCurriculum,
  goal: 'backend',
  passedCheckpointIds: curriculumCheckpoints.map(checkpoint => checkpoint.id),
  assessmentComplete: false
};
const assessmentSession = validateSession('course complete before assessment', completedProgress, completedEvidence, 40);
if (assessmentSession.items.find(item => item.action)?.action?.stage !== 'assessment') {
  failures.push('A learner with course/checkpoint evidence must receive assessment before projects');
}

const projectEvidence: LearningSessionEvidence = {
  ...completedEvidence,
  assessmentComplete: true
};
const projectSession = validateSession('course complete after assessment', completedProgress, projectEvidence, 40);
if (projectSession.items.find(item => item.action)?.action?.stage !== 'project') {
  failures.push('A learner with final assessment evidence must advance to the first incomplete capstone');
}

if (overallReadiness(completedProgress, projectEvidence) < 90) failures.push('Fully completed course should have high readiness');
if (!moduleMastery(completedProgress, projectEvidence).every(item => item.level === 'mastered')) {
  failures.push('Fully independently completed modules with complete curriculum/checkpoint evidence must be mastered');
}

const learningPathSource = await import('node:fs').then(({ readFileSync }) =>
  readFileSync(new URL('../src/lib/learning-path.ts', import.meta.url), 'utf8'));
for (const marker of [
  'frontierFor(progress, evidence)',
  'routeState',
  'frontier: JourneyFrontier',
  'goal: evidence.goal',
  'session.frontier.goal'
]) {
  if (!learningPathSource.includes(marker)) failures.push(`Adaptive Path is missing unified frontier marker ${marker}`);
}
if (/previousModule|previousReady/.test(learningPathSource)) {
  failures.push('Adaptive Path must not lock mastery by previous physical module position');
}
for (const forbidden of [
  'Повтор checkpoint после targeted remediation',
  'Targeted remediation после failed checkpoint',
  'Mental model и knowledge checks',
  'Guided application после урока',
  'Independent practice без подсказок',
  'Обязательный checkpoint фазы',
  'Transfer: объяснение и решение',
  'Transfer: непривычная формулировка',
  'Capstone на рабочем сценарии',
  'Поддержание expert-уровня'
]) {
  if (learningPathSource.includes(forbidden)) failures.push(`Learning session retained internal learner copy: ${forbidden}`);
}
for (const required of [
  'Мысленная модель и проверка понимания',
  'Практика с подсказками после урока',
  'Самостоятельная практика без подсказок',
  'Обязательный контрольный этап',
  'Перенос навыка: объяснение и решение',
  'Итоговый проект на рабочем сценарии'
]) {
  if (!learningPathSource.includes(required)) failures.push(`Learning session is missing localized copy: ${required}`);
}

const learningPathPortalSource = readFileSync(new URL('../src/components/LearningPathPortal.tsx', import.meta.url), 'utf8');
for (const forbidden of [
  'Текущий goal-priority',
  'Prerequisites готовы',
  'Prerequisites не закрыты',
  'Foundation закрыт',
  'Adaptive Learning Path',
  'Единый evidence graph',
  'lesson + practice + checkpoint + assessment + project',
  'evidence readiness',
  'Текущий streak',
  '<small>Checkpoints</small>',
  'Failed checkpoint',
  'Targeted remediation',
  'AI Coach',
  'пяти видах evidence',
  'Анализирую evidence graph',
  'Skill graph',
  'Карта доказательств и goal-route',
  'completed evidence',
  'locked prerequisite',
  '% evidence',
  'next:',
  'Исполняемая контрольная этапа',
  "topic: 'Adaptive Learning Path'",
  'Evidence readiness',
  'JSON.stringify({ context, evidenceContext })'
]) {
  if (learningPathPortalSource.includes(forbidden)) failures.push(`Learning Path retained internal learner copy: ${forbidden}`);
}
for (const required of [
  "from '../lib/journey-display'",
  'journeyStageLabels[session.frontier.action.stage]',
  'Адаптивный учебный маршрут',
  'готовность по результатам',
  'Контрольные этапы',
  'AI-наставник',
  'Карта навыков и результатов',
  'дальше:',
  'Контрольный этап с практическими задачами',
  'const mentorContext = {',
  'sessionReasonLabels[item.reason]',
  'JSON.stringify({ контекст: mentorContext, ограничения: evidenceContext })'
]) {
  if (!learningPathPortalSource.includes(required)) failures.push(`Learning Path is missing localized route copy: ${required}`);
}

const skillEvidenceSource = readFileSync(new URL('../src/lib/skill-evidence.ts', import.meta.url), 'utf8');
for (const forbidden of [
  'lesson mastery loop',
  'passed checkpoint evidence',
  'completed assessment evidence',
  'предыдущий checkpoint',
  'practice mastery',
  'Checkpoint score',
  'completed checkpoint attempt',
  'migrated legacy task evidence',
  'historical best',
  'current gate',
  'Checkpoint evidence',
  'executable report'
]) {
  if (skillEvidenceSource.includes(forbidden)) failures.push(`Skill evidence retained internal learner copy: ${forbidden}`);
}
for (const required of [
  'цикл освоения урока',
  'подтверждённого результата контрольного этапа',
  'результата итоговой проверки',
  'самостоятельной практикой',
  'Результат контрольного этапа',
  'исторический максимум',
  'Новый исполняемый отчёт отсутствует'
]) {
  if (!skillEvidenceSource.includes(required)) failures.push(`Skill evidence is missing localized explanation: ${required}`);
}

const readinessExplainerSource = readFileSync(new URL('../src/components/ReadinessExplainer.tsx', import.meta.url), 'utf8');
for (const forbidden of [
  'Как считается readiness?',
  'completed evidence',
  'Неприменимый capstone',
  'N/A',
  'Integrity rule',
  'Expired и abandoned attempts',
  'Project evidence',
  'immutable passed capstone report',
  'legacy checkbox'
]) {
  if (readinessExplainerSource.includes(forbidden)) failures.push(`Readiness explainer retained internal learner copy: ${forbidden}`);
}
for (const required of [
  'Как считается готовность?',
  'подтверждённые результаты',
  'Неприменимый итоговый проект',
  'Не применяется',
  'Правило целостности',
  'Просроченные и прерванные попытки'
]) {
  if (!readinessExplainerSource.includes(required)) failures.push(`Readiness explainer is missing localized copy: ${required}`);
}

if (failures.length) {
  console.error(`Learning path validation failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

process.stdout.write(`Learning path validated: ${goals.length} goals, ${mastery.length} modules, ${phases.length} phases, complete Russian stage labels and one canonical lesson/task/checkpoint/assessment/project frontier.\n`);
