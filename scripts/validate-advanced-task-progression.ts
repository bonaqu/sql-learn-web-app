import assert from 'node:assert/strict';
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

const expectedContent = new Map(
  applySyntaxFrontierTaskOverrides(advancedTasks).map(task => [task.id, task])
);
const totalModes: Record<TaskMode, number> = { lesson: 0, practice: 0, interview: 0, puzzle: 0 };

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
    const block = moduleTasks.slice(lessonIndex * 5, lessonIndex * 5 + 5);
    assert.deepEqual(lessons[lessonIndex].practiceTaskIds, block.map(task => task.id), `${lessons[lessonIndex].id}: linked task block drifted`);
    assert.deepEqual(block.map(task => task.mode), advancedLessonTaskModePattern, `${lessons[lessonIndex].id}: lesson block lost guided/practice/transfer progression`);
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
  const phaseLastModuleIndex = Math.max(...phase.moduleIds.map(moduleOrderIndex));
  const bypassedModuleIds = canonicalModuleIds.filter(id => id !== moduleId && moduleOrderIndex(id) <= phaseLastModuleIndex);
  const priorCheckpointIds = curriculumCheckpoints.slice(0, phaseIndex).map(checkpoint => checkpoint.id);
  const targetCheckpoint = curriculumCheckpoints[phaseIndex];
  assert.ok(targetCheckpoint, `${moduleId}: missing phase checkpoint`);

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
  assert.equal(afterFoundation.stage, 'checkpoint', `${moduleId}: checkpoint must follow complete foundation`);
  assert.equal(afterFoundation.checkpointId, targetCheckpoint.id, `${moduleId}: wrong phase checkpoint after foundation`);

  const afterCheckpoint = nextJourneyAction(progressWithEvidence(practice, guided), curriculum, {
    includeReview: false,
    bypassedModuleIds,
    passedCheckpointIds: [...priorCheckpointIds, targetCheckpoint.id]
  });
  assert.equal(afterCheckpoint.stage, 'interview', `${moduleId}: Interview must be the first post-checkpoint transfer stage`);
  assert.ok(transfer.some(task => task.id === afterCheckpoint.task?.id), `${moduleId}: Interview action is outside the module transfer set`);

  const interviews = transfer.filter(task => task.mode === 'interview');
  const afterInterviews = nextJourneyAction(progressWithEvidence([...practice, ...interviews], guided), curriculum, {
    includeReview: false,
    bypassedModuleIds,
    passedCheckpointIds: [...priorCheckpointIds, targetCheckpoint.id]
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

console.log(`Advanced task progression validated: ${advancedModuleIds.length} modules, ${totalModes.lesson} guided, ${totalModes.practice} practice, ${totalModes.interview} interview and ${totalModes.puzzle} puzzle tasks.`);
