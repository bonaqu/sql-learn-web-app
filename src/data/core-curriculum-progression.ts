import { modules as coreModules } from './course';
import type { SqlTask } from './course';
import type { CurriculumCheckpoint, CurriculumLesson } from './curriculum';
import { checkpointTaskList, foundationCheckpointTaskIds } from './checkpoint-task-bank';

const coreModuleIds = new Set<string>(coreModules.map(([id]) => id));

function taskNumber(taskId: string) {
  const match = /^task-(\d+)$/.exec(taskId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function moduleTasks(tasks: readonly SqlTask[], moduleId: string) {
  return tasks
    .filter(task => task.module === moduleId)
    .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
}

export function applyCoreLessonTaskLinks(
  lessons: readonly CurriculumLesson[],
  tasks: readonly SqlTask[]
): CurriculumLesson[] {
  return lessons.map(lesson => {
    if (!coreModuleIds.has(lesson.module)) return lesson;
    return {
      ...lesson,
      practiceTaskIds: moduleTasks(tasks, lesson.module).map(task => task.id)
    };
  });
}

export function applyCoreCheckpointTaskLinks(
  checkpoints: readonly CurriculumCheckpoint[],
  tasks: readonly SqlTask[]
): CurriculumCheckpoint[] {
  return checkpoints.map(checkpoint => {
    if (checkpoint.id === 'checkpoint-foundation') {
      return { ...checkpoint, taskIds: [...foundationCheckpointTaskIds] };
    }
    return {
      ...checkpoint,
      taskIds: checkpoint.moduleIds.map(moduleId => {
        const checkpointTask = checkpointTaskList().find(task => task.module === moduleId);
        if (!checkpointTask) throw new Error(`${checkpoint.id}: ${moduleId} has no unseen checkpoint task`);
        return checkpointTask.id;
      })
    };
  });
}
