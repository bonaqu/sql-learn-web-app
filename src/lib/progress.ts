import { modules, SqlTask, tasks } from '../data/course';

export type ActivityPoint = { day: string; solved: number };
export type TaskStats = {
  attempts: number;
  incorrect: number;
  hintsUsed: number;
  lastAttemptAt?: string;
  completedAt?: string;
};

export type Progress = {
  version: 4;
  completed: string[];
  taskStats: Record<string, TaskStats>;
  xp: number;
  streak: number;
  history: ActivityPoint[];
  lastTask?: string;
  lastStudyDate?: string;
};

export const STORAGE_KEY = 'sql-academy-progress-v4';
export const PROGRESS_CHANGED_EVENT = 'sql-academy-progress-changed';
const LEGACY_KEYS = ['sql-academy-progress-v3', 'sql-academy-progress-v2'];
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const defaultProgress: Progress = {
  version: 4,
  completed: [],
  taskStats: {},
  xp: 0,
  streak: 0,
  history: weekdays.map(day => ({ day, solved: 0 }))
};

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function previousDateKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function normalizeHistory(history: unknown): ActivityPoint[] {
  if (!Array.isArray(history) || !history.length) return defaultProgress.history;
  return weekdays.map(day => {
    const source = history.find(item => item && typeof item === 'object' && (item as ActivityPoint).day === day) as ActivityPoint | undefined;
    return { day, solved: Number.isFinite(source?.solved) ? Math.max(0, Number(source?.solved)) : 0 };
  });
}

function migrate(raw: unknown): Progress {
  if (!raw || typeof raw !== 'object') return defaultProgress;
  const value = raw as Partial<Progress> & { attempts?: Record<string, number> };
  const completed = Array.isArray(value.completed) ? value.completed.filter(item => typeof item === 'string') : [];
  const taskStats = value.taskStats && typeof value.taskStats === 'object'
    ? value.taskStats
    : Object.fromEntries(Object.entries(value.attempts || {}).map(([id, attempts]) => [id, {
      attempts: Math.max(0, Number(attempts) || 0),
      incorrect: Math.max(0, (Number(attempts) || 0) - (completed.includes(id) ? 1 : 0)),
      hintsUsed: 0
    }]));

  return {
    version: 4,
    completed,
    taskStats,
    xp: Math.max(0, Number(value.xp) || 0),
    streak: Math.max(0, Number(value.streak) || 0),
    history: normalizeHistory(value.history),
    lastTask: typeof value.lastTask === 'string' ? value.lastTask : undefined,
    lastStudyDate: typeof value.lastStudyDate === 'string' ? value.lastStudyDate : undefined
  };
}

export function loadProgress(): Progress {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return migrate(JSON.parse(current));
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) return migrate(JSON.parse(legacy));
    }
  } catch {
    return defaultProgress;
  }
  return defaultProgress;
}

export function saveProgress(progress: Progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  window.dispatchEvent(new CustomEvent(PROGRESS_CHANGED_EVENT, { detail: progress }));
}

export function recordAttempt(progress: Progress, task: SqlTask, correct: boolean): Progress {
  const now = new Date();
  const today = localDateKey(now);
  const previous = progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  const alreadyCompleted = progress.completed.includes(task.id);
  const newlyCompleted = correct && !alreadyCompleted;
  const weekdayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const streak = newlyCompleted
    ? progress.lastStudyDate === today
      ? progress.streak
      : progress.lastStudyDate === previousDateKey()
        ? progress.streak + 1
        : 1
    : progress.streak;

  return {
    ...progress,
    completed: newlyCompleted ? [...progress.completed, task.id] : progress.completed,
    xp: newlyCompleted ? progress.xp + task.xp : progress.xp,
    streak,
    lastStudyDate: newlyCompleted ? today : progress.lastStudyDate,
    lastTask: task.id,
    history: newlyCompleted
      ? progress.history.map((point, index) => index === weekdayIndex ? { ...point, solved: point.solved + 1 } : point)
      : progress.history,
    taskStats: {
      ...progress.taskStats,
      [task.id]: {
        ...previous,
        attempts: previous.attempts + 1,
        incorrect: previous.incorrect + (correct ? 0 : 1),
        lastAttemptAt: now.toISOString(),
        completedAt: newlyCompleted ? now.toISOString() : previous.completedAt
      }
    }
  };
}

export function recordHint(progress: Progress, taskId: string): Progress {
  const previous = progress.taskStats[taskId] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  return {
    ...progress,
    taskStats: {
      ...progress.taskStats,
      [taskId]: { ...previous, hintsUsed: previous.hintsUsed + 1 }
    }
  };
}

export function reviewQueue(progress: Progress, limit = 24): SqlTask[] {
  return tasks
    .map(task => {
      const stats = progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
      const completed = progress.completed.includes(task.id);
      const ageDays = stats.lastAttemptAt
        ? Math.max(0, (Date.now() - new Date(stats.lastAttemptAt).getTime()) / 86_400_000)
        : 0;
      const score = stats.incorrect * 5 + stats.hintsUsed * 2 + Math.min(stats.attempts, 5) + (completed ? Math.min(ageDays / 3, 4) : stats.attempts ? 6 : 0);
      return { task, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id))
    .slice(0, limit)
    .map(item => item.task);
}

export function weakTopics(progress: Progress, limit = 3) {
  const completed = new Set(progress.completed);
  return modules
    .map(([id, title]) => {
      const moduleTasks = tasks.filter(task => task.module === id);
      const solved = moduleTasks.filter(task => completed.has(task.id)).length;
      const incorrect = moduleTasks.reduce((sum, task) => sum + (progress.taskStats[task.id]?.incorrect || 0), 0);
      const hints = moduleTasks.reduce((sum, task) => sum + (progress.taskStats[task.id]?.hintsUsed || 0), 0);
      return { id, title, solved, total: moduleTasks.length, score: incorrect * 3 + hints + (moduleTasks.length - solved) * 0.25 };
    })
    .sort((a, b) => b.score - a.score || a.solved - b.solved)
    .slice(0, limit);
}
