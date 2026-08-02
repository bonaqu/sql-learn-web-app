import { modules, type SqlTask, tasks } from '../data/course-catalog';
import { phaseDefinitions, phaseForModule } from '../data/learning-structure';
import {
  foundationTasksForModule,
  transferTasksForModule
} from './learning-journey';
import {
  hasIndependentTaskEvidence,
  type Progress,
  reviewQueue
} from './progress';

export { phaseDefinitions } from '../data/learning-structure';

export type MasteryLevel = 'locked' | 'new' | 'learning' | 'practice' | 'mastered';

export type ModuleMastery = {
  id: string;
  title: string;
  description: string;
  index: number;
  phaseId: string;
  solved: number;
  total: number;
  attempts: number;
  incorrect: number;
  hints: number;
  accuracy: number;
  independence: number;
  mastery: number;
  level: MasteryLevel;
  recommendedTask: SqlTask | null;
};

export type LearningPhase = {
  id: string;
  title: string;
  subtitle: string;
  moduleIds: string[];
  mastery: number;
  solved: number;
  total: number;
  checkpointTask: SqlTask;
  checkpointPassed: boolean;
  unlocked: boolean;
};

export type SessionItem = {
  task: SqlTask;
  reason: 'review' | 'weakness' | 'new' | 'checkpoint';
  label: string;
  minutes: number;
};

export type DailySession = {
  items: SessionItem[];
  totalMinutes: number;
  reviewCount: number;
  newCount: number;
  focusModule: ModuleMastery | null;
};

const difficultyMinutes: Record<SqlTask['difficulty'], number> = {
  'База': 4,
  'Рабочий': 6,
  'Продвинутый': 8,
  'Экспертный': 10
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function taskSatisfied(task: SqlTask, progress: Progress) {
  if (task.mode === 'lesson') return progress.completed.includes(task.id);
  return hasIndependentTaskEvidence(progress, task.id);
}

function foundationReady(moduleId: string, progress: Progress) {
  const foundationTasks = foundationTasksForModule(moduleId);
  if (!foundationTasks.length) return false;
  const satisfied = foundationTasks.filter(task => taskSatisfied(task, progress)).length;
  const lessonTasks = foundationTasks.filter(task => task.mode === 'lesson');
  const guidedReady = !lessonTasks.length || lessonTasks.some(task => progress.completed.includes(task.id));
  return guidedReady && satisfied >= Math.ceil(foundationTasks.length * 0.6);
}

function recommendedTaskForModule(moduleId: string, progress: Progress) {
  return foundationTasksForModule(moduleId).find(task => !taskSatisfied(task, progress))
    || transferTasksForModule(moduleId).find(task => !taskSatisfied(task, progress))
    || null;
}

export function moduleMastery(progress: Progress): ModuleMastery[] {
  const completed = new Set(progress.completed);
  return modules.map(([id, title, description], index) => {
    const moduleTasks = tasks.filter(task => task.module === id);
    const solved = moduleTasks.filter(task => completed.has(task.id)).length;
    const independent = moduleTasks.filter(task => hasIndependentTaskEvidence(progress, task.id)).length;
    const stats = moduleTasks.map(task => progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 });
    const attempts = stats.reduce((sum, item) => sum + item.attempts, 0);
    const incorrect = stats.reduce((sum, item) => sum + item.incorrect, 0);
    const hints = stats.reduce((sum, item) => sum + item.hintsUsed, 0);
    const coverage = moduleTasks.length ? solved / moduleTasks.length : 0;
    const independentCoverage = moduleTasks.length ? independent / moduleTasks.length : 0;
    const accuracy = attempts ? clamp((attempts - incorrect) / attempts * 100) : 0;
    const independence = attempts ? clamp(100 - hints / Math.max(attempts, 1) * 28) : 0;
    const mastery = Math.round(clamp(
      coverage * 45
      + independentCoverage * 25
      + accuracy * 0.2
      + independence * 0.1
    ));
    const previousModule = index > 0 ? modules[index - 1][0] : null;
    const previousReady = !previousModule || foundationReady(previousModule, progress);
    const level: MasteryLevel = !previousReady
      ? 'locked'
      : mastery >= 82 && independent >= Math.ceil(moduleTasks.length * 0.7)
        ? 'mastered'
        : mastery >= 55
          ? 'practice'
          : attempts > 0 || solved > 0
            ? 'learning'
            : 'new';
    const recommendedTask = recommendedTaskForModule(id, progress);

    return {
      id,
      title,
      description,
      index,
      phaseId: phaseForModule(id)?.id || phaseDefinitions[0].id,
      solved,
      total: moduleTasks.length,
      attempts,
      incorrect,
      hints,
      accuracy: Math.round(accuracy),
      independence: Math.round(independence),
      mastery,
      level,
      recommendedTask
    };
  });
}

function checkpointFor(moduleIds: readonly string[]) {
  const candidates = tasks.filter(task => moduleIds.some(moduleId => moduleId === task.module));
  return [...candidates]
    .sort((left, right) => {
      const modeWeight = (task: SqlTask) => task.mode === 'interview' ? 3 : task.mode === 'puzzle' ? 2 : task.mode === 'practice' ? 1 : 0;
      return modeWeight(right) - modeWeight(left) || right.id.localeCompare(left.id);
    })[0];
}

export function learningPhases(progress: Progress, mastery = moduleMastery(progress)): LearningPhase[] {
  const completed = new Set(progress.completed);
  return phaseDefinitions.map((definition, index) => {
    const phaseModules = mastery.filter(item => definition.moduleIds.some(id => id === item.id));
    const total = phaseModules.reduce((sum, item) => sum + item.total, 0);
    const solved = phaseModules.reduce((sum, item) => sum + item.solved, 0);
    const phaseMastery = Math.round(phaseModules.reduce((sum, item) => sum + item.mastery, 0) / Math.max(phaseModules.length, 1));
    const checkpointTask = checkpointFor(definition.moduleIds);
    const prior = index === 0 ? null : phaseDefinitions[index - 1];
    const priorModules = prior ? mastery.filter(item => prior.moduleIds.some(id => id === item.id)) : [];
    const priorReady = !prior || priorModules.every(item => foundationReady(item.id, progress));
    return {
      ...definition,
      moduleIds: [...definition.moduleIds],
      mastery: phaseMastery,
      solved,
      total,
      checkpointTask,
      checkpointPassed: completed.has(checkpointTask.id),
      unlocked: priorReady
    };
  });
}

function uniquePush(items: SessionItem[], task: SqlTask | undefined | null, reason: SessionItem['reason'], label: string) {
  if (!task || items.some(item => item.task.id === task.id)) return;
  items.push({ task, reason, label, minutes: difficultyMinutes[task.difficulty] });
}

export function buildDailySession(progress: Progress, targetMinutes = 25): DailySession {
  const mastery = moduleMastery(progress);
  const phases = learningPhases(progress, mastery);
  const items: SessionItem[] = [];
  const review = reviewQueue(progress, 8);

  uniquePush(items, review[0], 'review', 'Вернуть в память');
  uniquePush(items, review[1], 'review', 'Исправить слабое место');

  const focusModule = mastery
    .filter(item => item.level !== 'locked' && item.level !== 'mastered' && item.recommendedTask)
    .sort((left, right) => left.index - right.index || left.mastery - right.mastery)[0] || null;

  uniquePush(
    items,
    focusModule?.recommendedTask,
    focusModule?.attempts ? 'weakness' : 'new',
    focusModule ? `Канонический шаг: ${focusModule.title}` : 'Следующий шаг маршрута'
  );

  if (focusModule) {
    const moduleTasks = [
      ...foundationTasksForModule(focusModule.id),
      ...transferTasksForModule(focusModule.id)
    ];
    for (const task of moduleTasks) {
      if (items.length >= 8) break;
      if (!taskSatisfied(task, progress)) {
        uniquePush(items, task, 'new', `Продолжить: ${focusModule.title}`);
      }
    }
  }

  const checkpoint = phases.find(phase =>
    phase.unlocked
    && !phase.checkpointPassed
    && phase.moduleIds.every(moduleId => foundationReady(moduleId, progress))
  )?.checkpointTask;
  uniquePush(items, checkpoint, 'checkpoint', 'Контрольная точка фазы');

  for (const module of mastery.filter(item =>
    item.level !== 'locked' && item.level !== 'mastered' && item.id !== focusModule?.id
  )) {
    if (items.length >= 10) break;
    uniquePush(items, module.recommendedTask, 'new', `После текущего модуля: ${module.title}`);
  }

  const compact: SessionItem[] = [];
  let totalMinutes = 0;
  for (const item of items) {
    if (compact.length >= 6) break;
    if (compact.length >= 2 && totalMinutes >= targetMinutes - 4) break;
    if (compact.length >= 3 && totalMinutes + item.minutes > targetMinutes + 6) continue;
    compact.push(item);
    totalMinutes += item.minutes;
  }

  if (!compact.length) {
    const fallback = mastery.find(item => item.level !== 'locked' && item.recommendedTask)?.recommendedTask
      || tasks.find(task => !taskSatisfied(task, progress))
      || tasks[0];
    uniquePush(compact, fallback, 'new', 'Следующий шаг маршрута');
    totalMinutes = compact.reduce((sum, item) => sum + item.minutes, 0);
  }

  return {
    items: compact,
    totalMinutes,
    reviewCount: compact.filter(item => item.reason === 'review' || item.reason === 'weakness').length,
    newCount: compact.filter(item => item.reason === 'new').length,
    focusModule
  };
}

export function overallReadiness(progress: Progress) {
  const mastery = moduleMastery(progress);
  const phases = learningPhases(progress, mastery);
  const weighted = mastery.reduce((sum, item) => sum + item.mastery, 0) / Math.max(mastery.length, 1);
  const checkpoints = phases.filter(phase => phase.checkpointPassed).length / phases.length * 100;
  const transferTasks = tasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
  const transferSolved = transferTasks.filter(task => hasIndependentTaskEvidence(progress, task.id)).length
    / Math.max(transferTasks.length, 1) * 100;
  return Math.round(clamp(weighted * 0.66 + checkpoints * 0.18 + transferSolved * 0.16));
}

export function readinessLabel(score: number) {
  if (score >= 85) return 'Готов к сложным собеседованиям';
  if (score >= 68) return 'Уверенный рабочий уровень';
  if (score >= 45) return 'База собрана, нужна практика';
  if (score >= 18) return 'Формируется фундамент';
  return 'Маршрут только начинается';
}

export function mentorPlanContext(progress: Progress) {
  const mastery = moduleMastery(progress);
  const session = buildDailySession(progress);
  const weakest = [...mastery]
    .filter(item => item.level !== 'locked')
    .sort((left, right) => left.index - right.index || left.mastery - right.mastery)
    .slice(0, 4);
  return {
    readiness: overallReadiness(progress),
    weakest: weakest.map(item => ({ title: item.title, mastery: item.mastery, errors: item.incorrect, hints: item.hints })),
    session: session.items.map(item => ({ title: item.task.title, reason: item.reason, topic: item.task.topic })),
    completed: progress.completed.length,
    total: tasks.length
  };
}
