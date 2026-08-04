import assert from 'node:assert/strict';
import {
  advancedAuthoredTaskEvidence,
  advancedAuthoredTaskIds,
  applyAdvancedAuthoredTaskOverrides
} from '../src/data/advanced-authored-content';
import { advancedModules, advancedTasks } from '../src/data/advanced-syllabus';
import { advancedLessonTaskModePattern } from '../src/data/advanced-task-progression';
import { applySyntaxFrontierTaskOverrides } from '../src/data/syntax-frontier-content';
import { curriculumCheckpoints, curriculumLessons } from '../src/data/complete-curriculum';
import { tasks, type SqlTask, type TaskMode } from '../src/data/course-catalog';
import { canonicalModuleIds, moduleOrderIndex, phaseDefinitions } from '../src/data/learning-structure';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress';
import {
  foundationTasksForModule,
  nextJourneyAction,
  transferTasksForModule
} from '../src/lib/learning-journey';
import type { Progress, TaskStats } from '../src/lib/progress';

const advancedModuleIds = advancedModules.map(([id]) => id);
const expectedModeCounts: Record<TaskMode, number> = {
  lesson: 2,
  practice: 4,
  interview: 2,
  puzzle: 2
};

function taskNumber(taskId: string) {
  return Number(taskId.replace(/^task-/, ''));
}

function invariantTaskContract(task: SqlTask) {
  return {
    id: task.id,
    module: task.module,
    topic: task.topic,
    difficulty: task.difficulty,
    xp: task.xp,
    solution: task.solution,
    guide: task.guide
  };
}

function normalizedSolutionFingerprint(solution: string) {
  return solution
    .toLowerCase()
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseTransferTitle(title: string) {
  return title.replace(/^(?:Interview|Puzzle)\s*[·:]\s*/i, '').trim();
}

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

function progressWithEvidence(independent: readonly SqlTask[], guided: readonly SqlTask[] = []): Progress {
  const taskStats: Record<string, TaskStats> = {};
  for (const task of independent) {
    taskStats[task.id] = {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      independentPasses: 1,
      completedAt: '2026-08-02T00:00:00.000Z',
      lastAttemptAt: '2026-08-02T00:00:00.000Z'
    };
  }
  for (const task of guided) {
    taskStats[task.id] = {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 1,
      independentPasses: 0,
      completedAt: '2026-08-02T00:00:00.000Z',
      lastAttemptAt: '2026-08-02T00:00:00.000Z'
    };
  }
  const completed = [...new Set([...independent, ...guided].map(task => task.id))];
  return {
    ...emptyProgress(),
    completed,
    taskStats,
    xp: [...independent, ...guided].reduce((sum, task) => sum + task.xp, 0)
  };
}

function checkpointForPhase(phaseId: string) {
  const phase = phaseDefinitions.find(item => item.id === phaseId);
  return phase
    ? curriculumCheckpoints.find(checkpoint =>
        checkpoint.moduleIds.some(moduleId => phase.moduleIds.some(id => id === moduleId))
      ) || null
    : null;
}

const expectedContent = new Map(
  applySyntaxFrontierTaskOverrides(
    applyAdvancedAuthoredTaskOverrides(advancedTasks)
  ).map(task => [task.id, task])
);
const totalModes: Record<TaskMode, number> = { lesson: 0, practice: 0, interview: 0, puzzle: 0 };

const expectedAuthoredDmlIds = Array.from({ length: 10 }, (_, index) => `task-${121 + index}`);
assert.deepEqual(
  [...advancedAuthoredTaskIds].sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedAuthoredDmlIds,
  'The first authored slice must preserve task-121 through task-130 exactly'
);
assert.deepEqual(
  Object.keys(advancedAuthoredTaskEvidence).sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedAuthoredDmlIds,
  'Every authored DML task needs an explicit evidence contract'
);

const authoredDmlTasks = tasks
  .filter(task => task.module === 'dml')
  .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
assert.deepEqual(authoredDmlTasks.map(task => task.id), expectedAuthoredDmlIds, 'DML persisted task identity drifted');
assert.equal(new Set(authoredDmlTasks.map(task => baseTransferTitle(task.title))).size, 10, 'DML titles must describe ten distinct decisions');
assert.ok(
  authoredDmlTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))),
  'Authored DML titles cannot use a numeric suffix as their primary distinction'
);
assert.equal(
  new Set(authoredDmlTasks.map(task => normalizedSolutionFingerprint(task.solution))).size,
  10,
  'Authored DML tasks collapsed to repeated query skeletons after literal normalization'
);

const dmlEvidence = new Set(Object.values(advancedAuthoredTaskEvidence).flat());
for (const required of [
  'target-set',
  'insert-select',
  'bounded-delete',
  'idempotency',
  'savepoint',
  'version-guard',
  'staging-sync',
  'deduplication',
  'audit-before-mutation',
  'cardinality-guard'
]) {
  assert.ok(dmlEvidence.has(required as never), `DML authored ladder lost competency evidence: ${required}`);
}
for (const task of authoredDmlTasks) {
  const evidence = advancedAuthoredTaskEvidence[task.id];
  assert.ok(evidence && evidence.length >= 3, `${task.id}: expected at least three authored evidence dimensions`);
  assert.ok(task.description.length >= 140, `${task.id}: description is too thin for an authored production contract`);
}
assert.deepEqual(
  authoredDmlTasks.map(task => task.mode),
  [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern],
  'Authored DML content must preserve two complete lesson/practice/transfer blocks'
);

for (const moduleId of advancedModuleIds) {
  const moduleTasks = tasks
    .filter(task => task.module === moduleId)
    .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
  assert.equal(moduleTasks.length, 10, `${moduleId}: expected ten advanced tasks`);

  const expectedModes = [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern];
  assert.deepEqual(moduleTasks.map(task => task.mode), expectedModes, `${moduleId}: stage pattern must repeat once per lesson`);

  const counts: Record<TaskMode, number> = { lesson: 0, practice: 0, interview: 0, puzzle: 0 };
  for (const task of moduleTasks) {
    counts[task.mode] += 1;
    totalModes[task.mode] += 1;
    const expected = expectedContent.get(task.id);
    assert.ok(expected, `${task.id}: missing original advanced contract`);
    assert.deepEqual(
      invariantTaskContract(task),
      invariantTaskContract(expected!),
      `${task.id}: progression or transfer framing changed SQL, XP, difficulty, guide or persisted identity`
    );
    if (task.mode === 'lesson' || task.mode === 'practice') {
      assert.deepEqual(
        task,
        { ...expected, mode: task.mode },
        `${task.id}: foundation task was rewritten outside the mode progression`
      );
    }
  }
  assert.deepEqual(counts, expectedModeCounts, `${moduleId}: expected 2 guided, 4 practice, 2 interview and 2 puzzle tasks`);

  const lessons = curriculumLessons.filter(lesson => lesson.module === moduleId);
  assert.equal(lessons.length, 2, `${moduleId}: expected foundation and applied lessons`);
  for (let lessonIndex = 0; lessonIndex < lessons.length; lessonIndex += 1) {
    const lesson = lessons[lessonIndex];
    const block = moduleTasks.slice(lessonIndex * 5, lessonIndex * 5 + 5);
    const exampleTask = block[0];
    assert.deepEqual(lesson.practiceTaskIds, block.map(task => task.id), `${lesson.id}: linked task block drifted`);
    assert.deepEqual(block.map(task => task.mode), advancedLessonTaskModePattern, `${lesson.id}: lesson block lost guided/practice/transfer progression`);
    assert.equal(lesson.example.sql, exampleTask.solution, `${lesson.id}: runnable example drifted from the canonical first task of its block`);
    assert.equal(lesson.example.description, exampleTask.description, `${lesson.id}: runnable example copy drifted from its linked authored task`);
  }

  const foundation = foundationTasksForModule(moduleId);
  const transfer = transferTasksForModule(moduleId);
  assert.equal(foundation.length, 6, `${moduleId}: foundation must include two guided and four independent tasks`);
  assert.equal(transfer.length, 4, `${moduleId}: transfer must include two interviews and two puzzles`);
  assert.equal(foundation.filter(task => task.mode === 'lesson').length, 2, `${moduleId}: guided count drifted`);
  assert.equal(foundation.filter(task => task.mode === 'practice').length, 4, `${moduleId}: independent practice count drifted`);
  assert.equal(transfer.filter(task => task.mode === 'interview').length, 2, `${moduleId}: interview count drifted`);
  assert.equal(transfer.filter(task => task.mode === 'puzzle').length, 2, `${moduleId}: puzzle count drifted`);

  const phaseIndex = phaseDefinitions.findIndex(phase => phase.moduleIds.some(id => id === moduleId));
  const phase = phaseDefinitions[phaseIndex];
  assert.ok(phase, `${moduleId}: missing canonical phase`);
  const targetCheckpoint = checkpointForPhase(phase.id);
  assert.ok(targetCheckpoint, `${moduleId}: missing phase checkpoint`);
  const priorCheckpointIds = phaseDefinitions
    .slice(0, phaseIndex)
    .flatMap(priorPhase => {
      const priorCheckpoint = checkpointForPhase(priorPhase.id);
      return priorCheckpoint ? [priorCheckpoint.id] : [];
    });
  const bypassedModuleIds = canonicalModuleIds.filter(id => moduleOrderIndex(id) < moduleOrderIndex(moduleId));
  const isLastModuleInPhase = phase.moduleIds.at(-1) === moduleId;
  const nextModuleId = canonicalModuleIds[moduleOrderIndex(moduleId) + 1] || null;

  const curriculum = {
    ...emptyCurriculumProgress(),
    completedLessons: lessons.map(lesson => lesson.id),
    completedSections: lessons.flatMap(lesson => lesson.sections.map(section => section.id)),
    answers: Object.fromEntries(lessons.map(lesson => [lesson.check.id, {
      optionIndex: lesson.check.correctIndex,
      correct: true,
      answeredAt: '2026-08-02T00:00:00.000Z'
    }]))
  };
  const guided = foundation.filter(task => task.mode === 'lesson');
  const practice = foundation.filter(task => task.mode === 'practice');

  const afterGuided = nextJourneyAction(progressWithEvidence([], guided), curriculum, {
    includeReview: false,
    goal: 'full',
    bypassedModuleIds,
    passedCheckpointIds: priorCheckpointIds
  });
  assert.equal(afterGuided.stage, 'practice', `${moduleId}: independent practice must follow guided evidence`);
  assert.ok(practice.some(task => task.id === afterGuided.task?.id), `${moduleId}: journey selected a non-practice task after guided evidence`);

  const afterFoundation = nextJourneyAction(progressWithEvidence(practice, guided), curriculum, {
    includeReview: false,
    goal: 'full',
    bypassedModuleIds,
    passedCheckpointIds: priorCheckpointIds
  });

  if (!isLastModuleInPhase) {
    assert.equal(afterFoundation.stage, 'lesson', `${moduleId}: an intermediate advanced module must continue to the next lesson`);
    assert.equal(afterFoundation.moduleId, nextModuleId, `${moduleId}: advanced route must continue to the next prerequisite-safe module`);
    assert.notEqual(afterFoundation.routeReasonCode, 'phase-checkpoint', `${moduleId}: checkpoint cannot open before all phase siblings are complete`);
    continue;
  }

  assert.equal(afterFoundation.stage, 'checkpoint', `${moduleId}: checkpoint must follow the complete advanced phase foundation`);
  assert.equal(afterFoundation.checkpointId, targetCheckpoint!.id, `${moduleId}: wrong phase checkpoint after foundation`);

  const afterCheckpoint = nextJourneyAction(progressWithEvidence(practice, guided), curriculum, {
    includeReview: false,
    goal: 'full',
    bypassedModuleIds,
    passedCheckpointIds: [...priorCheckpointIds, targetCheckpoint!.id]
  });
  assert.equal(afterCheckpoint.stage, 'interview', `${moduleId}: Interview must be the first post-checkpoint transfer stage`);
  assert.ok(transfer.some(task => task.id === afterCheckpoint.task?.id), `${moduleId}: Interview action is outside the module transfer set`);

  const interviews = transfer.filter(task => task.mode === 'interview');
  const afterInterviews = nextJourneyAction(progressWithEvidence([...practice, ...interviews], guided), curriculum, {
    includeReview: false,
    goal: 'full',
    bypassedModuleIds,
    passedCheckpointIds: [...priorCheckpointIds, targetCheckpoint!.id]
  });
  assert.equal(afterInterviews.stage, 'puzzle', `${moduleId}: Puzzle must follow Interview transfer evidence`);
  assert.ok(transfer.some(task => task.id === afterInterviews.task?.id), `${moduleId}: Puzzle action is outside the module transfer set`);
}

assert.deepEqual(totalModes, {
  lesson: advancedModuleIds.length * 2,
  practice: advancedModuleIds.length * 4,
  interview: advancedModuleIds.length * 2,
  puzzle: advancedModuleIds.length * 2
}, 'Advanced track aggregate stage distribution drifted');

console.log(`Advanced task progression validated: ${advancedModuleIds.length} modules, canonical lesson examples, first authored DML ladder, phase-wide checkpoints, ${totalModes.lesson} guided, ${totalModes.practice} practice, ${totalModes.interview} interview and ${totalModes.puzzle} puzzle tasks.`);