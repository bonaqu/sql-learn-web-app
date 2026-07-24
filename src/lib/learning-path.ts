import { modules, SqlTask, tasks } from '../data/course';
import { Progress, reviewQueue } from './progress';

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

export const phaseDefinitions = [
  {
    id: 'foundation',
    title: 'I. Надёжная база',
    subtitle: 'От формы результата до групповых отчётов',
    moduleIds: ['sql-thinking', 'select', 'filtering', 'sorting', 'aggregates', 'grouping']
  },
  {
    id: 'composition',
    title: 'II. Сложные запросы',
    subtitle: 'Связи, подзапросы, CTE, окна, даты и множества',
    moduleIds: ['joins', 'subqueries', 'cte', 'windows', 'dates', 'text', 'set-ops']
  },
  {
    id: 'production',
    title: 'III. Production SQL',
    subtitle: 'Качество, производительность, транзакции и схема',
    moduleIds: ['data-quality', 'indexes', 'explain', 'transactions', 'schema']
  },
  {
    id: 'support-track',
    title: 'IV. Support Analytics',
    subtitle: 'SLA, операционные метрики и финальный проект T-Bonk',
    moduleIds: ['support', 'final']
  }
] as const;

const difficultyMinutes: Record<SqlTask['difficulty'], number> = {
  'База': 4,
  'Рабочий': 6,
  'Продвинутый': 8,
  'Экспертный': 10
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function modulePhase(moduleId: string) {
  return phaseDefinitions.find(phase => phase.moduleIds.includes(moduleId as never))?.id || phaseDefinitions[0].id;
}

function taskPriority(task: SqlTask, progress: Progress) {
  const stats = progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  const completed = progress.completed.includes(task.id);
  const modeWeight = task.mode === 'lesson' ? 4 : task.mode === 'practice' ? 3 : task.mode === 'interview' ? 2 : 1;
  return (completed ? -100 : 0) + stats.incorrect * 8 + stats.hintsUsed * 3 + stats.attempts * 2 + modeWeight;
}

export function moduleMastery(progress: Progress): ModuleMastery[] {
  const completed = new Set(progress.completed);
  return modules.map(([id, title, description], index) => {
    const moduleTasks = tasks.filter(task => task.module === id);
    const solved = moduleTasks.filter(task => completed.has(task.id)).length;
    const stats = moduleTasks.map(task => progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 });
    const attempts = stats.reduce((sum, item) => sum + item.attempts, 0);
    const incorrect = stats.reduce((sum, item) => sum + item.incorrect, 0);
    const hints = stats.reduce((sum, item) => sum + item.hintsUsed, 0);
    const coverage = moduleTasks.length ? solved / moduleTasks.length : 0;
    const accuracy = attempts ? clamp((attempts - incorrect) / attempts * 100) : 0;
    const independence = attempts ? clamp(100 - hints / Math.max(attempts, 1) * 28) : 0;
    const mastery = Math.round(clamp(coverage * 65 + accuracy * 0.23 + independence * 0.12));
    const previousModule = index > 0 ? modules[index - 1][0] : null;
    const previousSolved = !previousModule || tasks
      .filter(task => task.module === previousModule)
      .some(task => completed.has(task.id));
    const level: MasteryLevel = !previousSolved && index > 1
      ? 'locked'
      : mastery >= 82 && solved >= Math.ceil(moduleTasks.length * 0.8)
        ? 'mastered'
        : mastery >= 55
          ? 'practice'
          : attempts > 0 || solved > 0
            ? 'learning'
            : 'new';
    const recommendedTask = [...moduleTasks]
      .sort((left, right) => taskPriority(right, progress) - taskPriority(left, progress) || left.id.localeCompare(right.id))
      .find(task => !completed.has(task.id)) || null;

    return {
      id,
      title,
      description,
      index,
      phaseId: modulePhase(id),
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
  const candidates = tasks.filter(task => moduleIds.includes(task.module));
  return [...candidates]
    .sort((left, right) => {
      const modeWeight = (task: SqlTask) => task.mode === 'interview' ? 3 : task.mode === 'puzzle' ? 2 : task.mode === 'practice' ? 1 : 0;
      return modeWeight(right) - modeWeight(left) || right.id.localeCompare(left.id);
    })[0];
}

export function learningPhases(progress: Progress, mastery = moduleMastery(progress)): LearningPhase[] {
  const completed = new Set(progress.completed);
  return phaseDefinitions.map((definition, index) => {
    const phaseModules = mastery.filter(item => definition.moduleIds.includes(item.id as never));
    const total = phaseModules.reduce((sum, item) => sum + item.total, 0);
    const solved = phaseModules.reduce((sum, item) => sum + item.solved, 0);
    const phaseMastery = Math.round(phaseModules.reduce((sum, item) => sum + item.mastery, 0) / Math.max(phaseModules.length, 1));
    const checkpointTask = checkpointFor(definition.moduleIds);
    const prior = index === 0 ? null : phaseDefinitions[index - 1];
    const priorModules = prior ? mastery.filter(item => prior.moduleIds.includes(item.id as never)) : [];
    const priorReady = !prior || priorModules.every(item => item.mastery >= 48) || priorModules.reduce((sum, item) => sum + item.solved, 0) >= Math.ceil(priorModules.reduce((sum, item) => sum + item.total, 0) * 0.55);
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

function uniquePush(items: SessionItem[], task: SqlTask | undefined, reason: SessionItem['reason'], label: string) {
  if (!task || items.some(item => item.task.id === task.id)) return;
  items.push({ task, reason, label, minutes: difficultyMinutes[task.difficulty] });
}

export function buildDailySession(progress: Progress, targetMinutes = 25): DailySession {
  const mastery = moduleMastery(progress);
  const phases = learningPhases(progress, mastery);
  const completed = new Set(progress.completed);
  const items: SessionItem[] = [];
  const review = reviewQueue(progress, 8);

  uniquePush(items, review[0], 'review', 'Вернуть в память');
  uniquePush(items, review[1], 'review', 'Исправить слабое место');

  const focusModule = [...mastery]
    .filter(item => item.level !== 'locked' && item.level !== 'mastered')
    .sort((left, right) => left.mastery - right.mastery || right.incorrect - left.incorrect || left.index - right.index)[0] || null;
  uniquePush(items, focusModule?.recommendedTask || undefined, 'weakness', focusModule ? `Фокус: ${focusModule.title}` : 'Рабочая практика');

  const firstNew = tasks.find(task => !completed.has(task.id) && mastery.find(item => item.id === task.module)?.level !== 'locked');
  uniquePush(items, firstNew, 'new', 'Следующий шаг маршрута');

  const checkpoint = phases.find(phase => phase.unlocked && !phase.checkpointPassed && phase.mastery >= 42)?.checkpointTask;
  uniquePush(items, checkpoint, 'checkpoint', 'Контрольная точка');

  const compact: SessionItem[] = [];
  let totalMinutes = 0;
  for (const item of items) {
    if (compact.length >= 6) break;
    if (compact.length >= 3 && totalMinutes + item.minutes > targetMinutes + 6) continue;
    compact.push(item);
    totalMinutes += item.minutes;
  }

  if (!compact.length) {
    uniquePush(compact, tasks.find(task => !completed.has(task.id)) || tasks[0], 'new', 'Следующий шаг маршрута');
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
  const interviewTasks = tasks.filter(task => task.mode === 'interview');
  const interviewSolved = interviewTasks.filter(task => progress.completed.includes(task.id)).length / Math.max(interviewTasks.length, 1) * 100;
  return Math.round(clamp(weighted * 0.66 + checkpoints * 0.18 + interviewSolved * 0.16));
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
    .sort((left, right) => left.mastery - right.mastery)
    .slice(0, 4);
  return {
    readiness: overallReadiness(progress),
    weakest: weakest.map(item => ({ title: item.title, mastery: item.mastery, errors: item.incorrect, hints: item.hints })),
    session: session.items.map(item => ({ title: item.task.title, reason: item.reason, topic: item.task.topic })),
    completed: progress.completed.length,
    total: tasks.length
  };
}
