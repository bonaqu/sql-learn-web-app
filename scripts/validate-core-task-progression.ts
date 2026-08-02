import assert from 'node:assert/strict';
import { modules as coreModules, tasks as rawCoreTasks } from '../src/data/course';
import { coreModuleTaskModePattern } from '../src/data/core-task-progression';
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

const coreModuleIds = coreModules.map(([id]) => id);
const rawById = new Map(rawCoreTasks.map(task => [task.id, task]));
const expectedModeCounts: Record<TaskMode, number> = {
  lesson: 1,
  practice: 3,
  interview: 1,
  puzzle: 1
};

function taskNumber(taskId: string) {
  return Number(taskId.replace(/^task-/, ''));
}

function progressionInvariant(task: SqlTask) {
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

const totalModes: Record<TaskMode, number> = { lesson: 0, practice: 0, interview: 0, puzzle: 0 };

for (const moduleId of coreModuleIds) {
  const moduleTasks = tasks
    .filter(task => task.module === moduleId)
    .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
  assert.equal(moduleTasks.length, 6, `${moduleId}: expected six core tasks`);
  assert.deepEqual(moduleTasks.map(task => task.mode), coreModuleTaskModePattern, `${moduleId}: core stage pattern drifted`);

  const counts: Record<TaskMode, number> = { lesson: 0, practice: 0, interview: 0, puzzle: 0 };
  for (const task of moduleTasks) {
    counts[task.mode] += 1;
    totalModes[task.mode] += 1;
    const raw = rawById.get(task.id);
    assert.ok(raw, `${task.id}: missing raw core contract`);
    assert.deepEqual(
      progressionInvariant(task),
      progressionInvariant(raw!),
      `${task.id}: core progression changed SQL, XP, difficulty, guide or persisted identity`
    );
  }
  assert.deepEqual(counts, expectedModeCounts, `${moduleId}: expected 1 guided, 3 practice, 1 interview and 1 puzzle task`);

  const lesson = curriculumLessons.find(item => item.module === moduleId);
  assert.ok(lesson, `${moduleId}: missing core lesson`);
  assert.deepEqual(lesson?.practiceTaskIds, moduleTasks.map(task => task.id), `${moduleId}: lesson must link all six stage tasks`);

  const checkpoint = curriculumCheckpoints.find(item => item.moduleIds.some(id => id === moduleId));
  assert.ok(checkpoint, `${moduleId}: missing phase checkpoint`);
  const checkpointTaskIndex = checkpoint?.moduleIds.findIndex(id => id === moduleId) ?? -1;
  const checkpointTaskId = checkpointTaskIndex >= 0 ? checkpoint?.taskIds[checkpointTaskIndex] : undefined;
  const practices = moduleTasks.filter(task => task.mode === 'practice');
  assert.equal(checkpointTaskId, practices.at(-1)?.id, `${moduleId}: checkpoint must use the last independent practice, not guided or transfer evidence`);

  const foundation = foundationTasksForModule(moduleId);
  const transfer = transferTasksForModule(moduleId);
  assert.deepEqual(foundation.map(task => task.mode), ['lesson', 'practice', 'practice', 'practice'], `${moduleId}: foundation stages drifted`);
  assert.deepEqual(transfer.map(task => task.mode), ['interview', 'puzzle'], `${moduleId}: transfer stages drifted`);

  const phaseIndex = phaseDefinitions.findIndex(phase => phase.moduleIds.some(id => id === moduleId));
  const phase = phaseDefinitions[phaseIndex];
  assert.ok(phase, `${moduleId}: missing canonical phase`);
  const phaseLastModuleIndex = Math.max(...phase.moduleIds.map(moduleOrderIndex));
  const bypassedModuleIds = canonicalModuleIds.filter(id => id !== moduleId && moduleOrderIndex(id) <= phaseLastModuleIndex);
  const priorCheckpointIds = curriculumCheckpoints.slice(0, phaseIndex).map(item => item.id);
  const targetCheckpoint = curriculumCheckpoints[phaseIndex];
  assert.ok(targetCheckpoint, `${moduleId}: missing target checkpoint`);

  const curriculum = {
    ...emptyCurriculumProgress(),
    completedLessons: [lesson!.id],
    completedSections: lesson!.sections.map(section => section.id),
    answers: {
      [lesson!.check.id]: {
        optionIndex: lesson!.check.correctIndex,
        correct: true,
        answeredAt: '2026-08-02T00:00:00.000Z'
      }
    }
  };
  const guided = foundation.filter(task => task.mode === 'lesson');
  const practice = foundation.filter(task => task.mode === 'practice');

  const afterGuided = nextJourneyAction(progressWithEvidence([], guided), curriculum, {
    includeReview: false,
    bypassedModuleIds,
    passedCheckpointIds: priorCheckpointIds
  });
  assert.equal(afterGuided.stage, 'practice', `${moduleId}: independent practice must follow guided evidence`);
  assert.ok(practice.some(task => task.id === afterGuided.task?.id), `${moduleId}: journey selected a non-practice task after guided evidence`);

  const afterFoundation = nextJourneyAction(progressWithEvidence(practice, guided), curriculum, {
    includeReview: false,
    bypassedModuleIds,
    passedCheckpointIds: priorCheckpointIds
  });
  assert.equal(afterFoundation.stage, 'checkpoint', `${moduleId}: checkpoint must follow all three independent practices`);
  assert.equal(afterFoundation.checkpointId, targetCheckpoint.id, `${moduleId}: wrong checkpoint after foundation`);

  const afterCheckpoint = nextJourneyAction(progressWithEvidence(practice, guided), curriculum, {
    includeReview: false,
    bypassedModuleIds,
    passedCheckpointIds: [...priorCheckpointIds, targetCheckpoint.id]
  });
  assert.equal(afterCheckpoint.stage, 'interview', `${moduleId}: Interview must be the first post-checkpoint transfer`);
  assert.equal(afterCheckpoint.task?.id, transfer[0]?.id, `${moduleId}: wrong Interview task`);

  const afterInterview = nextJourneyAction(progressWithEvidence([...practice, transfer[0]], guided), curriculum, {
    includeReview: false,
    bypassedModuleIds,
    passedCheckpointIds: [...priorCheckpointIds, targetCheckpoint.id]
  });
  assert.equal(afterInterview.stage, 'puzzle', `${moduleId}: Puzzle must follow Interview evidence`);
  assert.equal(afterInterview.task?.id, transfer[1]?.id, `${moduleId}: wrong Puzzle task`);
}

assert.deepEqual(totalModes, {
  lesson: coreModuleIds.length,
  practice: coreModuleIds.length * 3,
  interview: coreModuleIds.length,
  puzzle: coreModuleIds.length
}, 'Core aggregate stage distribution drifted');

console.log(`Core task progression validated: ${coreModuleIds.length} modules, ${totalModes.lesson} guided, ${totalModes.practice} practice, ${totalModes.interview} interview and ${totalModes.puzzle} puzzle tasks with practice-backed checkpoints.`);