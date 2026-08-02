import { advancedModules } from './advanced-syllabus';
import type { SqlTask, TaskMode } from './course';

export const advancedLessonTaskModePattern = [
  'lesson',
  'practice',
  'practice',
  'interview',
  'puzzle'
] as const satisfies readonly TaskMode[];

const advancedModuleIds = new Set<string>(advancedModules.map(([id]) => id));

function taskNumber(taskId: string) {
  const match = /^task-(\d+)$/.exec(taskId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function applyAdvancedTaskProgression(source: readonly SqlTask[]): SqlTask[] {
  const modeByTaskId = new Map<string, TaskMode>();

  for (const [moduleId] of advancedModules) {
    const moduleTasks = source
      .filter(task => task.module === moduleId)
      .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));

    for (let index = 0; index < moduleTasks.length; index += 1) {
      modeByTaskId.set(
        moduleTasks[index].id,
        advancedLessonTaskModePattern[index % advancedLessonTaskModePattern.length]
      );
    }
  }

  return source.map(task => {
    if (!advancedModuleIds.has(task.module)) return task;
    const mode = modeByTaskId.get(task.id);
    return mode && mode !== task.mode ? { ...task, mode } : task;
  });
}
