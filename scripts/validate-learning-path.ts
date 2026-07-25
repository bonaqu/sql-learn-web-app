import { tasks } from '../src/data/course-catalog.ts';
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

if (mastery.length !== 20) failures.push(`Expected 20 mastery modules, received ${mastery.length}`);
if (phaseDefinitions.length !== 4 || phases.length !== 4) failures.push('Learning path must contain four phases');
if (new Set(phaseDefinitions.flatMap(phase => [...phase.moduleIds])).size !== 20) failures.push('Every course module must appear in exactly one phase');
if (mastery.some(item => item.mastery < 0 || item.mastery > 100)) failures.push('Mastery must stay inside 0..100');
if (phases.some(phase => !phase.checkpointTask || !tasks.some(task => task.id === phase.checkpointTask.id))) failures.push('Every phase needs a real checkpoint task');
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
