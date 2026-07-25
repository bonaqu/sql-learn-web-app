import { modules, tasks } from '../src/data/course-catalog.ts';
import {
  buildDailySession,
  learningPhases,
  moduleMastery,
  overallReadiness,
  phaseDefinitions
} from '../src/lib/learning-path.ts';
import type { Progress } from '../src/lib/progress.ts';

const emptyProgress: Progress = {
  version: 4,
  completed: [],
  taskStats: {},
  xp: 0,
  streak: 0,
  history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }))
};

const practicedProgress: Progress = {
  ...emptyProgress,
  completed: tasks.slice(0, 18).filter((_, index) => index % 2 === 0).map(task => task.id),
  taskStats: Object.fromEntries(tasks.slice(0, 25).map((task, index) => [task.id, {
    attempts: (index % 3) + 1,
    incorrect: index % 2,
    hintsUsed: index % 4 === 0 ? 1 : 0,
    lastAttemptAt: new Date(Date.now() - index * 86_400_000).toISOString(),
    completedAt: index % 2 === 0 ? new Date(Date.now() - index * 86_400_000).toISOString() : undefined
  }]))
};

const failures: string[] = [];
const mastery = moduleMastery(practicedProgress);
const phases = learningPhases(practicedProgress, mastery);
const session = buildDailySession(practicedProgress, 25);
const moduleIds = modules.map(([id]) => id);
const phaseModuleIds = phaseDefinitions.flatMap(phase => [...phase.moduleIds]);
const phaseModuleCounts = new Map<string, number>();

for (const moduleId of phaseModuleIds) {
  phaseModuleCounts.set(moduleId, (phaseModuleCounts.get(moduleId) ?? 0) + 1);
}

if (mastery.length !== modules.length) {
  failures.push(`Expected ${modules.length} mastery modules, received ${mastery.length}`);
}
if (phases.length !== phaseDefinitions.length) {
  failures.push(`Expected ${phaseDefinitions.length} learning phases, received ${phases.length}`);
}
if (new Set(phaseDefinitions.map(phase => phase.id)).size !== phaseDefinitions.length) {
  failures.push('Learning phase IDs must be unique');
}

const missingModules = moduleIds.filter(moduleId => !phaseModuleCounts.has(moduleId));
const duplicatedModules = moduleIds.filter(moduleId => (phaseModuleCounts.get(moduleId) ?? 0) > 1);
const unknownModules = [...phaseModuleCounts.keys()].filter(moduleId => !moduleIds.includes(moduleId as never));

if (missingModules.length) failures.push(`Modules missing from learning phases: ${missingModules.join(', ')}`);
if (duplicatedModules.length) failures.push(`Modules assigned to multiple phases: ${duplicatedModules.join(', ')}`);
if (unknownModules.length) failures.push(`Unknown modules referenced by learning phases: ${unknownModules.join(', ')}`);
if (phaseModuleIds.length !== moduleIds.length) {
  failures.push(`Learning phases reference ${phaseModuleIds.length} module slots for ${moduleIds.length} course modules`);
}
if (mastery.some(item => item.mastery < 0 || item.mastery > 100)) failures.push('Mastery must stay inside 0..100');
if (phases.some(phase => !phase.checkpointTask || !tasks.some(task => task.id === phase.checkpointTask.id))) failures.push('Every phase needs a real checkpoint task');
if (new Set(phases.map(phase => phase.checkpointTask.id)).size !== phases.length) failures.push('Each phase must use a distinct checkpoint task');
if (!session.items.length || session.items.length > 6) failures.push('Daily session must contain 1..6 tasks');
if (new Set(session.items.map(item => item.task.id)).size !== session.items.length) failures.push('Daily session contains duplicate tasks');
if (session.totalMinutes <= 0 || session.totalMinutes > 46) failures.push(`Unexpected session duration: ${session.totalMinutes}`);
if (overallReadiness(emptyProgress) !== 0) failures.push('Empty progress readiness must be zero');
if (overallReadiness(practicedProgress) < 0 || overallReadiness(practicedProgress) > 100) failures.push('Readiness must stay inside 0..100');

const completedProgress: Progress = {
  ...emptyProgress,
  completed: tasks.map(task => task.id),
  xp: tasks.reduce((sum, task) => sum + task.xp, 0),
  taskStats: Object.fromEntries(tasks.map(task => [task.id, {
    attempts: 1,
    incorrect: 0,
    hintsUsed: 0,
    completedAt: new Date().toISOString(),
    lastAttemptAt: new Date().toISOString()
  }]))
};

if (overallReadiness(completedProgress) < 90) failures.push('Fully completed course should have high readiness');
if (!moduleMastery(completedProgress).every(item => item.level === 'mastered')) failures.push('Fully completed modules must be mastered');

if (failures.length) {
  console.error(`Learning path validation failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`Learning path validated: ${mastery.length} modules, ${phases.length} phases, ${session.items.length} session tasks.`);
