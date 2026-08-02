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
import {
  foundationTasksForModule,
  journeyStageForTask,
  nextJourneyAction
} from '../src/lib/learning-journey';
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
    `Task route regressed at ${previous.id} -> ${current.id}.`
  );
}

for (let index = 1; index < curriculumLessons.length; index += 1) {
  assert.ok(
    moduleOrderIndex(curriculumLessons[index - 1].module) <= moduleOrderIndex(curriculumLessons[index].module),
    `Lesson route regressed at ${curriculumLessons[index - 1].id} -> ${curriculumLessons[index].id}.`
  );
}

for (const lesson of curriculumLessons) {
  for (const prerequisite of lesson.prerequisites) {
    assert.ok(
      moduleOrderIndex(prerequisite) < moduleOrderIndex(lesson.module),
      `${lesson.id}: prerequisite ${prerequisite} must precede ${lesson.module} in the canonical route.`
    );
  }
}

for (const moduleId of canonicalModuleIds) {
  assert.ok(curriculumLessons.some(lesson => lesson.module === moduleId),
    `${moduleId}: canonical route requires at least one lesson.`);
  assert.ok(foundationTasksForModule(moduleId).length > 0,
    `${moduleId}: canonical route requires guided or independent foundation tasks.`);
}

for (const task of tasks) {
  const stage = journeyStageForTask(task);
  if (task.mode === 'lesson') assert.equal(stage, 'guided');
  if (task.mode === 'practice') assert.equal(stage, 'practice');
  if (task.mode === 'interview') assert.equal(stage, 'interview');
  if (task.mode === 'puzzle') assert.equal(stage, 'puzzle');
}

const emptyCurriculum = emptyCurriculumProgress();
const firstAction = nextJourneyAction(emptyProgress(), emptyCurriculum, { includeReview: false });
assert.equal(firstAction.kind, 'lesson', 'A new learner must start with a lesson, not a random task.');
assert.equal(firstAction.lessonId, curriculumLessons[0].id,
  'A new learner must start with the first canonical lesson.');
assert.equal(firstAction.moduleId, canonicalModuleIds[0],
  'A new learner must start in the first canonical module.');

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
const afterLesson = nextJourneyAction(emptyProgress(), firstLessonComplete, { includeReview: false });
assert.equal(afterLesson.kind, 'task', 'A completed lesson must flow into its connected task evidence.');
assert.equal(afterLesson.moduleId, firstLesson.module,
  'A lesson must flow into practice from the same module.');
assert.ok(afterLesson.stage === 'guided' || afterLesson.stage === 'practice',
  'The first task after a lesson must be guided or independent practice.');

const transferModule = canonicalModuleIds.find(moduleId =>
  tasks.some(task => task.module === moduleId && task.mode === 'practice')
  && tasks.some(task => task.module === moduleId && task.mode === 'interview')
);
assert.ok(transferModule, 'The course needs at least one module with practice and interview transfer.');

if (transferModule) {
  const lessons = curriculumLessons.filter(lesson => lesson.module === transferModule);
  const foundation = foundationTasksForModule(transferModule);
  const targetPractice = foundation.find(task => task.mode === 'practice');
  assert.ok(targetPractice, `${transferModule}: expected a practice task for journey validation.`);

  if (targetPractice) {
    const targetPhaseIndex = phaseDefinitions.findIndex(phase =>
      phase.moduleIds.some(moduleId => moduleId === transferModule)
    );
    const targetPhase = phaseDefinitions[targetPhaseIndex];
    const targetPhaseLastModuleIndex = Math.max(...targetPhase.moduleIds.map(moduleOrderIndex));
    const bypassedToPhaseFrontier = canonicalModuleIds.filter(moduleId =>
      moduleId !== transferModule && moduleOrderIndex(moduleId) <= targetPhaseLastModuleIndex
    );
    const passedCheckpointIds = curriculumCheckpoints
      .slice(0, targetPhaseIndex + 1)
      .map(checkpoint => checkpoint.id);
    const curriculum = {
      ...emptyCurriculumProgress(),
      completedLessons: lessons.map(lesson => lesson.id),
      completedSections: lessons.flatMap(lesson => lesson.sections.map(section => section.id)),
      answers: Object.fromEntries(lessons.map(lesson => [lesson.check.id, {
        optionIndex: lesson.check.correctIndex,
        correct: true,
        answeredAt: '2026-08-01T00:00:00.000Z'
      }]))
    };

    const independent = foundation.filter(task => task.id !== targetPractice.id);
    const guidedProgress = progressWithEvidence(independent, [targetPractice]);
    const guidedAction = nextJourneyAction(guidedProgress, curriculum, {
      includeReview: false,
      bypassedModuleIds: bypassedToPhaseFrontier,
      passedCheckpointIds
    });
    assert.equal(guidedAction.task?.id, targetPractice.id,
      'Guided completion must not let the learner skip required independent practice.');
    assert.equal(guidedAction.stage, 'practice');

    const independentProgress = progressWithEvidence(foundation);
    const transferAction = nextJourneyAction(independentProgress, curriculum, {
      includeReview: false,
      bypassedModuleIds: bypassedToPhaseFrontier,
      passedCheckpointIds
    });
    assert.equal(transferAction.stage, 'interview',
      'Interview transfer must follow phase foundation, checkpoint and independent practice evidence.');
  }
}

const guidedHomeSource = readFileSync(new URL('../src/components/GuidedHome.tsx', import.meta.url), 'utf8');
assert.match(guidedHomeSource, /nextJourneyAction/,
  'The Today page must use the unified journey selector.');
assert.doesNotMatch(guidedHomeSource, /tasks\.find\(/,
  'The Today page must not fall back to physical task-array order.');
assert.match(guidedHomeSource, /JOURNEY_EVIDENCE_EVENTS/,
  'The Today page must react to the shared curriculum/checkpoint/assessment evidence events.');
for (const forbiddenImport of [
  "import('../lib/assessment')",
  "import('../lib/checkpoints')",
  "import('../lib/curriculum-progress')"
]) {
  assert.ok(!guidedHomeSource.includes(forbiddenImport),
    `The Today page must not load the heavy runtime through ${forbiddenImport}.`);
}

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
  'MAX_CHECKPOINT_REPORTS',
  'MAX_ASSESSMENT_REPORTS',
  'lessonChecksComplete',
  'report.userId !== userId',
  'report.passed !== true'
]) {
  assert.ok(evidenceSource.includes(marker), `Journey evidence safety boundary is missing ${marker}.`);
}

const checkpointSource = readFileSync(new URL('../src/lib/checkpoints.ts', import.meta.url), 'utf8');
const assessmentSource = readFileSync(new URL('../src/lib/assessment.ts', import.meta.url), 'utf8');
const curriculumProgressSource = readFileSync(new URL('../src/lib/curriculum-progress.ts', import.meta.url), 'utf8');
for (const eventName of [
  'sql-academy-checkpoint-reports-changed',
  'sql-academy-assessment-reports-changed',
  'sql-academy-curriculum-progress-changed'
]) {
  assert.ok(evidenceSource.includes(eventName), `Lightweight evidence is missing event ${eventName}.`);
}
assert.ok(checkpointSource.includes('sql-academy-checkpoint-reports-changed'));
assert.ok(assessmentSource.includes('sql-academy-assessment-reports-changed'));
assert.ok(curriculumProgressSource.includes('sql-academy-curriculum-progress-changed'));

const journeyContract = readFileSync(new URL('../docs/learning-journey-contract.md', import.meta.url), 'utf8');
for (const marker of ['Lesson', 'Independent practice', 'Checkpoint', 'Interview', 'Puzzle']) {
  assert.ok(journeyContract.includes(marker), `Learning journey contract is missing ${marker}.`);
}

console.log(`Coherent learning journey validated: ${canonicalModuleIds.length} modules, ${curriculumLessons.length} lessons, ${tasks.length} tasks and ${phaseDefinitions.length} phases.`);
