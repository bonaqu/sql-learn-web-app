import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  curriculumCheckpoints,
  curriculumLessons
} from '../src/data/complete-curriculum';
import { modules, tasks, type SqlTask } from '../src/data/course-catalog';
import {
  canonicalModuleIds,
  moduleOrderIndex,
  phaseDefinitions,
  taskDifficultyOrder,
  taskModeOrder
} from '../src/data/learning-structure';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress';
import { SHARED_FOUNDATION_MODULE_IDS } from '../src/lib/goal-aware-route';
import {
  buildJourneyFrontier,
  foundationTasksForModule,
  journeyStageForTask,
  nextJourneyAction
} from '../src/lib/learning-journey';
import type { LearnerGoal } from '../src/lib/learner-onboarding';
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

function progressWithEvidence(
  independentTasks: SqlTask[],
  guidedTasks: SqlTask[] = []
): Progress {
  const completed = [...new Set([...independentTasks, ...guidedTasks].map(task => task.id))];
  const taskStats: Record<string, TaskStats> = {};
  for (const task of independentTasks) {
    taskStats[task.id] = {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      independentPasses: 1,
      completedAt: '2026-08-01T00:00:00.000Z',
      lastAttemptAt: '2026-08-01T00:00:00.000Z'
    };
  }
  for (const task of guidedTasks) {
    taskStats[task.id] = {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 1,
      independentPasses: 0,
      completedAt: '2026-08-01T00:00:00.000Z',
      lastAttemptAt: '2026-08-01T00:00:00.000Z'
    };
  }
  return {
    ...emptyProgress(),
    completed,
    taskStats,
    xp: [...independentTasks, ...guidedTasks].reduce((sum, task) => sum + task.xp, 0)
  };
}

assert.equal(new Set(canonicalModuleIds).size, canonicalModuleIds.length,
  'Canonical module route must not contain duplicates.');
assert.deepEqual(modules.map(([id]) => id), canonicalModuleIds,
  'The public module catalog must follow the canonical phase route exactly.');
assert.deepEqual(phaseDefinitions.flatMap(phase => [...phase.moduleIds]), canonicalModuleIds,
  'Every phase slot must map to exactly one canonical module.');

for (let index = 1; index < tasks.length; index += 1) {
  const previous = tasks[index - 1];
  const current = tasks[index];
  const previousKey = [
    moduleOrderIndex(previous.module),
    taskModeOrder(previous.mode),
    taskDifficultyOrder(previous.difficulty)
  ];
  const currentKey = [
    moduleOrderIndex(current.module),
    taskModeOrder(current.mode),
    taskDifficultyOrder(current.difficulty)
  ];
  assert.ok(
    previousKey[0] < currentKey[0]
      || previousKey[0] === currentKey[0] && previousKey[1] < currentKey[1]
      || previousKey[0] === currentKey[0] && previousKey[1] === currentKey[1] && previousKey[2] <= currentKey[2],
    `Task catalog regressed at ${previous.id} -> ${current.id}. Physical catalog order remains deterministic even when the learner route is personalized.`
  );
}

for (let index = 1; index < curriculumLessons.length; index += 1) {
  assert.ok(
    moduleOrderIndex(curriculumLessons[index - 1].module) <= moduleOrderIndex(curriculumLessons[index].module),
    `Lesson catalog regressed at ${curriculumLessons[index - 1].id} -> ${curriculumLessons[index].id}.`
  );
}

for (const lesson of curriculumLessons) {
  for (const prerequisite of lesson.prerequisites) {
    assert.ok(
      moduleOrderIndex(prerequisite) < moduleOrderIndex(lesson.module),
      `${lesson.id}: prerequisite ${prerequisite} must precede ${lesson.module} in the source catalog.`
    );
  }
}

for (const moduleId of canonicalModuleIds) {
  assert.ok(curriculumLessons.some(lesson => lesson.module === moduleId),
    `${moduleId}: route requires at least one lesson.`);
  assert.ok(foundationTasksForModule(moduleId).length > 0,
    `${moduleId}: route requires guided or independent foundation tasks.`);
}

for (const task of tasks) {
  const stage = journeyStageForTask(task);
  if (task.mode === 'lesson') assert.equal(stage, 'guided');
  if (task.mode === 'practice') assert.equal(stage, 'practice');
  if (task.mode === 'interview') assert.equal(stage, 'interview');
  if (task.mode === 'puzzle') assert.equal(stage, 'puzzle');
}

const goals: LearnerGoal[] = ['support', 'analyst', 'backend', 'interview', 'full'];
const emptyCurriculum = emptyCurriculumProgress();
for (const goal of goals) {
  const frontier = buildJourneyFrontier(emptyProgress(), emptyCurriculum, {
    includeReview: false,
    goal
  });
  assert.equal(frontier.action.kind, 'lesson', `${goal}: a new learner must start with a lesson.`);
  assert.equal(frontier.action.lessonId, curriculumLessons[0].id,
    `${goal}: a zero-evidence learner must start with the first shared lesson.`);
  assert.equal(frontier.action.moduleId, canonicalModuleIds[0],
    `${goal}: a zero-evidence learner must start in the first shared module.`);
  assert.equal(frontier.action.routeReasonCode, 'shared-foundation');
  assert.deepEqual(frontier.safeBypassedModuleIds, []);
}

const firstLesson = curriculumLessons[0];
const firstLessonComplete = {
  ...emptyCurriculum,
  completedLessons: [firstLesson.id],
  completedSections: firstLesson.sections.map(section => section.id),
  answers: {
    [firstLesson.check.id]: {
      optionIndex: firstLesson.check.correctIndex,
      correct: true,
      answeredAt: '2026-08-01T00:00:00.000Z'
    }
  }
};
const afterLesson = nextJourneyAction(emptyProgress(), firstLessonComplete, { includeReview: false, goal: 'full' });
assert.equal(afterLesson.kind, 'task', 'A completed lesson must flow into its connected task evidence.');
assert.equal(afterLesson.moduleId, firstLesson.module,
  'A lesson must flow into practice from the same module.');
assert.ok(afterLesson.stage === 'guided' || afterLesson.stage === 'practice',
  'The first task after a lesson must be guided or independent practice.');

const foundationCheckpoint = curriculumCheckpoints.find(checkpoint =>
  SHARED_FOUNDATION_MODULE_IDS.every(moduleId => checkpoint.moduleIds.includes(moduleId))
) || curriculumCheckpoints[0];
assert.ok(foundationCheckpoint, 'Shared foundation requires a checkpoint.');
if (foundationCheckpoint) {
  const checkpointFrontier = buildJourneyFrontier(emptyProgress(), emptyCurriculumProgress(), {
    includeReview: false,
    goal: 'analyst',
    bypassedModuleIds: [...SHARED_FOUNDATION_MODULE_IDS]
  });
  assert.equal(checkpointFrontier.action.stage, 'checkpoint',
    'A ready shared-foundation checkpoint must outrank a goal-priority module.');
  assert.equal(checkpointFrontier.action.checkpointId, foundationCheckpoint.id);
  assert.equal(checkpointFrontier.action.routeReasonCode, 'phase-checkpoint');
}

const transferModule = SHARED_FOUNDATION_MODULE_IDS[SHARED_FOUNDATION_MODULE_IDS.length - 1];
const transferLessons = curriculumLessons.filter(lesson => lesson.module === transferModule);
const transferFoundation = foundationTasksForModule(transferModule);
const targetPractice = transferFoundation.find(task => task.mode === 'practice');
assert.ok(targetPractice, `${transferModule}: expected a practice task for journey validation.`);

if (targetPractice && foundationCheckpoint) {
  const bypassedPrefix = SHARED_FOUNDATION_MODULE_IDS.slice(0, -1);
  const transferCurriculum = {
    ...emptyCurriculumProgress(),
    completedLessons: transferLessons.map(lesson => lesson.id),
    completedSections: transferLessons.flatMap(lesson => lesson.sections.map(section => section.id)),
    answers: Object.fromEntries(transferLessons.map(lesson => [lesson.check.id, {
      optionIndex: lesson.check.correctIndex,
      correct: true,
      answeredAt: '2026-08-01T00:00:00.000Z'
    }]))
  };
  const independent = transferFoundation.filter(task => task.id !== targetPractice.id);
  const guidedProgress = progressWithEvidence(independent, [targetPractice]);
  const guidedAction = nextJourneyAction(guidedProgress, transferCurriculum, {
    includeReview: false,
    goal: 'support',
    bypassedModuleIds: bypassedPrefix,
    passedCheckpointIds: [foundationCheckpoint.id]
  });
  assert.equal(guidedAction.stage, 'practice',
    'Guided completion must keep the learner in independent practice instead of opening transfer.');
  assert.equal(guidedAction.moduleId, transferModule,
    'The remaining independent practice must stay inside the current foundation module.');
  assert.ok(guidedAction.task && transferFoundation.some(task => task.id === guidedAction.task?.id),
    'The selector must choose a real unfinished foundation task, not a transfer task.');
  assert.notEqual(guidedAction.routeReasonCode, 'checkpoint-transfer',
    'Guided evidence must never unlock Interview/Puzzle transfer.');

  const transferAction = nextJourneyAction(progressWithEvidence(transferFoundation), transferCurriculum, {
    includeReview: false,
    goal: 'support',
    bypassedModuleIds: bypassedPrefix,
    passedCheckpointIds: [foundationCheckpoint.id]
  });
  assert.equal(transferAction.stage, 'interview',
    'Interview transfer must follow foundation, checkpoint and independent practice evidence.');
  assert.equal(transferAction.routeReasonCode, 'checkpoint-transfer');
}

const brokenBypass = buildJourneyFrontier(emptyProgress(), emptyCurriculumProgress(), {
  includeReview: false,
  goal: 'backend',
  bypassedModuleIds: SHARED_FOUNDATION_MODULE_IDS.slice(1)
});
assert.deepEqual(brokenBypass.safeBypassedModuleIds, [],
  'A diagnostic bypass with a missing first prerequisite must be rejected completely.');
assert.equal(brokenBypass.action.moduleId, SHARED_FOUNDATION_MODULE_IDS[0]);

const guidedHomeSource = readFileSync(new URL('../src/components/GuidedHome.tsx', import.meta.url), 'utf8');
assert.match(guidedHomeSource, /buildJourneyFrontier/,
  'The Today page must consume the unified frontier snapshot.');
assert.match(guidedHomeSource, /goal: profile\.goal/,
  'The Today page must pass the selected onboarding goal explicitly.');
assert.match(guidedHomeSource, /data-route-reason/,
  'The Today action must expose why it is next for browser contracts.');
assert.doesNotMatch(guidedHomeSource, /tasks\.find\(/,
  'The Today page must not fall back to physical task-array order.');
assert.match(guidedHomeSource, /JOURNEY_EVIDENCE_EVENTS/,
  'The Today page must react to shared curriculum/checkpoint/assessment evidence events.');
for (const forbiddenCopy of [
  'prerequisite-safe шаг',
  'подтверждённый prefix',
  'Следуй frontier',
  'аналитика, backend',
  'independent evidence',
  'retrieval-повторение',
  'Новые independent-попытки',
  'retrieval review',
  'Синхронизация evidence-графа',
  'goal-aware frontier',
  'пропуска prerequisites',
  'Lesson → practice → checkpoint → transfer',
  '{item.kind}',
  '${nextStep.stage}'
]) {
  assert.ok(!guidedHomeSource.includes(forbiddenCopy), `Today UI retained internal learner copy: ${forbiddenCopy}`);
}
for (const requiredCopy of [
  "const journeyStageLabels: Record<JourneyFrontier['action']['stage'], string>",
  'journeyStageLabels[nextStep.stage]',
  'weekPlanKindLabels[item.kind]',
  'Следуй следующему шагу',
  'повторение по памяти',
  'Урок → практика → контроль → перенос навыка'
]) {
  assert.ok(guidedHomeSource.includes(requiredCopy), `Today UI is missing localized route copy: ${requiredCopy}`);
}
for (const forbiddenImport of [
  "import('../lib/assessment')",
  "import('../lib/checkpoints')",
  "import('../lib/curriculum-progress')"
]) {
  assert.ok(!guidedHomeSource.includes(forbiddenImport),
    `The Today page must not load the heavy runtime through ${forbiddenImport}.`);
}

const journeySource = readFileSync(new URL('../src/lib/learning-journey.ts', import.meta.url), 'utf8');
for (const marker of [
  'goalModuleFrontier',
  'safeDiagnosticBypass',
  'frontierCompletedModuleIds',
  'frontierEligibleModuleIds',
  'frontierRouteModuleIds',
  'frontierPassedPhaseIds',
  'phase-checkpoint',
  'checkpoint-transfer'
]) assert.ok(journeySource.includes(marker), `Unified journey frontier is missing ${marker}.`);
for (const forbiddenCopy of [
  'mental model',
  'runnable example',
  'knowledge check',
  'guided-задачу',
  'completion-галочка',
  'independent evidence',
  'Пройти checkpoint',
  'Перейти в Interview',
  'Puzzle не используется',
  'Assessment Center',
  'Project Lab',
  'expert SQL',
  'spaced review',
  'dialect labs',
  'production-навыков',
  'Spaced retrieval',
  'проваленный checkpoint',
  'foundation-модули',
  'mixed checkpoint',
  'без учебного scaffolding',
  'prerequisite-safe',
  'недостающий prerequisite',
  'checkpoints и transfer',
  'Assessment закрыт',
  'capstone собирает',
  'evidence-ступени'
]) assert.ok(!journeySource.includes(forbiddenCopy), `Canonical journey retained mixed learner copy: ${forbiddenCopy}`);

const workspaceSource = readFileSync(new URL('../src/lib/workspace-readiness.ts', import.meta.url), 'utf8');
for (const marker of [
  'frontierCompletedModuleIds',
  'frontierEligibleModuleIds',
  'frontierRouteModuleIds',
  'Предварительные темы пройдены · позже по цели',
  'Предварительные темы не пройдены · предпросмотр'
]) assert.ok(workspaceSource.includes(marker), `Workspace frontier integration is missing ${marker}.`);
for (const forbiddenCopy of [
  'Retrieval review',
  'Independent подтверждён',
  'Повтор guided-этапа',
  'lesson, checkpoint, goal и assessment evidence',
  'Свободная expert-практика',
  'Interview открыт',
  'Puzzle открыт',
  'Foundation этого модуля',
  'Foundation-модуль открыт',
  'Сначала mental model',
  'knowledge checks',
  'frontier-модуля',
  'Prerequisites готовы',
  'Prerequisites не закрыты'
]) assert.ok(!workspaceSource.includes(forbiddenCopy), `Workspace retained mixed learner copy: ${forbiddenCopy}`);
assert.doesNotMatch(workspaceSource, /phaseOrder|moduleOrderIndex|earlierPhase|laterPhase/,
  'Workspace must not reintroduce physical phase/module-index locking.');

const evidenceSource = readFileSync(new URL('../src/lib/journey-evidence.ts', import.meta.url), 'utf8');
for (const forbiddenDependency of [
  "from './assessment'",
  "from './checkpoints'",
  "from './learning-path'",
  "from './sqlite'"
]) {
  assert.ok(!evidenceSource.includes(forbiddenDependency),
    `Lightweight journey evidence must not import ${forbiddenDependency}.`);
}
for (const marker of [
  'MAX_EVIDENCE_BYTES',
  'MAX_ASSESSMENT_REPORTS',
  'lessonChecksComplete',
  'checkpointAttemptSnapshotFromReports',
  'attemptSnapshot.passedCheckpointIds',
  'checkpointRemediationsFromAttemptSnapshot'
]) {
  assert.ok(evidenceSource.includes(marker), `Journey evidence safety boundary is missing ${marker}.`);
}
assert.doesNotMatch(evidenceSource, /MAX_CHECKPOINT_REPORTS|latestByCheckpoint|report\.passed !== true|completedAt\.localeCompare|checkpointRemediationsFromReports/,
  'Journey evidence must delegate checkpoint normalization, owner/status filtering and latest-attempt selection to the canonical attempt policy.');

const attemptPolicySource = readFileSync(new URL('../src/lib/checkpoint-attempt-policy.ts', import.meta.url), 'utf8');
for (const marker of [
  "item.status !== 'completed'",
  'item.userId !== expectedUserId',
  'knownCheckpointIds.has',
  'compareCheckpointAttempts',
  'checkpointAttemptSnapshotFromReports',
  'currentAttempt',
  'historicalBestScore'
]) {
  assert.ok(attemptPolicySource.includes(marker),
    `Canonical checkpoint attempt safety boundary is missing ${marker}.`);
}

const checkpointSource = readFileSync(new URL('../src/lib/checkpoints.ts', import.meta.url), 'utf8');
const assessmentSource = readFileSync(new URL('../src/lib/assessment.ts', import.meta.url), 'utf8');
const curriculumProgressSource = readFileSync(new URL('../src/lib/curriculum-progress.ts', import.meta.url), 'utf8');
for (const eventName of [
  'sql-academy-checkpoint-reports-changed',
  'sql-academy-assessment-reports-changed',
  'sql-academy-curriculum-progress-changed'
]) assert.ok(evidenceSource.includes(eventName), `Lightweight evidence is missing event ${eventName}.`);
assert.ok(checkpointSource.includes('sql-academy-checkpoint-reports-changed'));
assert.ok(assessmentSource.includes('sql-academy-assessment-reports-changed'));
assert.ok(curriculumProgressSource.includes('sql-academy-curriculum-progress-changed'));

const journeyContract = readFileSync(new URL('../docs/learning-journey-contract.md', import.meta.url), 'utf8');
for (const marker of ['Lesson', 'Independent practice', 'Checkpoint', 'Interview', 'Puzzle']) {
  assert.ok(journeyContract.includes(marker), `Learning journey contract is missing ${marker}.`);
}

console.log(`Coherent goal-aware journey validated: ${goals.length} goals, ${canonicalModuleIds.length} modules, ${curriculumLessons.length} lessons, ${tasks.length} tasks, ${phaseDefinitions.length} checkpoint phases and Russian learner-facing route copy.`);
