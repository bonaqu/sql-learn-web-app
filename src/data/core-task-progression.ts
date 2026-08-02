import { modules as coreModules } from './course';
import type { SqlTask, TaskMode } from './course';

export const coreModuleTaskModePattern = [
  'lesson',
  'practice',
  'practice',
  'practice',
  'interview',
  'puzzle'
] as const satisfies readonly TaskMode[];

const coreModuleIds = new Set<string>(coreModules.map(([id]) => id));

function taskNumber(taskId: string) {
  const match = /^task-(\d+)$/.exec(taskId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function applyCoreTaskProgression(source: readonly SqlTask[]): SqlTask[] {
  const modeByTaskId = new Map<string, TaskMode>();

  for (const [moduleId] of coreModules) {
    const moduleTasks = source
      .filter(task => task.module === moduleId)
      .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));

    for (let index = 0; index < moduleTasks.length; index += 1) {
      modeByTaskId.set(moduleTasks[index].id, coreModuleTaskModePattern[index]);
    }
  }

  return source.map(task => {
    if (!coreModuleIds.has(task.module)) return task;
    const mode = modeByTaskId.get(task.id);
    return mode && mode !== task.mode ? { ...task, mode } : task;
  });
}
