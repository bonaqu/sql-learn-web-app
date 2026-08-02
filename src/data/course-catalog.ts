import {
  achievements as coreAchievements,
  modules as coreModules,
  tasks as coreTasks
} from './course';
import { advancedModules, advancedTasks } from './advanced-syllabus';
import { applyAdvancedTaskProgression } from './advanced-task-progression';
import { applyAdvancedTransferContracts } from './advanced-transfer-contracts';
import {
  moduleOrderIndex,
  taskDifficultyOrder,
  taskModeOrder
} from './learning-structure';
import { applySyntaxFrontierTaskOverrides } from './syntax-frontier-content';

export type {
  Difficulty,
  ModuleGuide,
  SqlTask,
  TaskMode
} from './course';

const sourceModules: readonly (readonly [string, string, string])[] = [
  ...coreModules,
  ...advancedModules
];
const sourceTasks = applyAdvancedTransferContracts(
  applyAdvancedTaskProgression(
    applySyntaxFrontierTaskOverrides([...coreTasks, ...advancedTasks])
  )
);
const sourceTaskOrder = new Map(sourceTasks.map((task, index) => [task.id, index]));

export const modules: readonly (readonly [string, string, string])[] = [...sourceModules]
  .sort((left, right) => moduleOrderIndex(left[0]) - moduleOrderIndex(right[0]));

export const tasks = [...sourceTasks].sort((left, right) =>
  moduleOrderIndex(left.module) - moduleOrderIndex(right.module)
  || taskModeOrder(left.mode) - taskModeOrder(right.mode)
  || taskDifficultyOrder(left.difficulty) - taskDifficultyOrder(right.difficulty)
  || (sourceTaskOrder.get(left.id) ?? 0) - (sourceTaskOrder.get(right.id) ?? 0)
  || left.id.localeCompare(right.id)
);

export const achievements = [
  ...coreAchievements.filter(item => item.threshold < 120),
  { id: 'core-academy', title: 'Core SQL завершён', description: 'Решить первые 120 задач фундаментального трека', threshold: 120 },
  { id: 'advanced-half', title: 'Production SQL', description: 'Решить 180 задач', threshold: 180 },
  { id: 'complete-academy', title: 'SQL Academy Complete', description: 'Решить все 240 задач', threshold: 240 }
];

export const CORE_TASK_COUNT = coreTasks.length;
export const TOTAL_TASK_COUNT = tasks.length;
