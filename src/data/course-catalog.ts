import {
  achievements as coreAchievements,
  modules as coreModules,
  tasks as coreTasks
} from './course';
import { advancedModules, advancedTasks } from './advanced-syllabus';

export type {
  Difficulty,
  ModuleGuide,
  SqlTask,
  TaskMode
} from './course';

export const modules: readonly (readonly [string, string, string])[] = [
  ...coreModules,
  ...advancedModules
];
export const tasks = [...coreTasks, ...advancedTasks];

export const achievements = [
  ...coreAchievements.filter(item => item.threshold < 120),
  { id: 'core-academy', title: 'Core SQL завершён', description: 'Решить первые 120 задач фундаментального трека', threshold: 120 },
  { id: 'advanced-half', title: 'Production SQL', description: 'Решить 180 задач', threshold: 180 },
  { id: 'complete-academy', title: 'SQL Academy Complete', description: 'Решить все 240 задач', threshold: 240 }
];

export const CORE_TASK_COUNT = coreTasks.length;
export const TOTAL_TASK_COUNT = tasks.length;
