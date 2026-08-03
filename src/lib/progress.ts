import { modules, SqlTask, tasks } from '../data/course-catalog';
import type { AttemptDiagnostic, AttemptErrorKind } from './attempt-diagnostics';

export type ActivityPoint = { day: string; solved: number };
export type TaskStats = {
  attempts: number;
  incorrect: number;
  hintsUsed: number;
  solutionViews?: number;
  independentPasses?: number;
  lastIndependentAt?: string;
  errorKinds?: Partial<Record<AttemptErrorKind, number>>;
  lastDiagnostic?: AttemptDiagnostic;
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

export type AttemptEvidence = {
  diagnostic?: AttemptDiagnostic;
  independent?: boolean;
};

export const STORAGE_KEY = 'sql-academy-progress-v4';
export const PROGRESS_CHANGED_EVENT = 'sql-academy-progress-changed';
export const CLEAN_REVIEW_INTERVAL_DAYS = 3;
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

function normalizeStats(raw: unknown): Record<string, TaskStats> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, TaskStats> = {};
  for (const [taskId, candidate] of Object.entries(raw)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const value = candidate as Partial<TaskStats>;
    result[taskId] = {
      attempts: Math.max(0, Number(value.attempts) || 0),
      incorrect: Math.max(0, Number(value.incorrect) || 0),
      hintsUsed: Math.max(0, Number(value.hintsUsed) || 0),
      solutionViews: value.solutionViews === undefined ? undefined : Math.max(0, Number(value.solutionViews) || 0),
      independentPasses: value.independentPasses === undefined ? undefined : Math.max(0, Number(value.independentPasses) || 0),
      lastIndependentAt: typeof value.lastIndependentAt === 'string' ? value.lastIndependentAt : undefined,
      errorKinds: value.errorKinds && typeof value.errorKinds === 'object' ? value.errorKinds : undefined,
      lastDiagnostic: value.lastDiagnostic && typeof value.lastDiagnostic === 'object' ? value.lastDiagnostic : undefined,
      lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : undefined,
      completedAt: typeof value.completedAt === 'string' ? value.completedAt : undefined
    };
  }
  return result;
}

function migrate(raw: unknown): Progress {
  if (!raw || typeof raw !== 'object') return defaultProgress;
  const value = raw as Partial<Progress> & { attempts?: Record<string, number> };
  const completed = Array.isArray(value.completed) ? value.completed.filter(item => typeof item === 'string') : [];
  const taskStats = value.taskStats && typeof value.taskStats === 'object'
    ? normalizeStats(value.taskStats)
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

export function recordAttempt(
  progress: Progress,
  task: SqlTask,
  correct: boolean,
  evidence: AttemptEvidence = {}
): Progress {
  const now = new Date();
  const today = localDateKey(now);
  const previous = progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  const alreadyCompleted = progress.completed.includes(task.id);
  const newlyCompleted = correct && !alreadyCompleted;
  const independentPass = Boolean(correct && evidence.independent);
  const weekdayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const streak = newlyCompleted
    ? progress.lastStudyDate === today
      ? progress.streak
      : progress.lastStudyDate === previousDateKey()
        ? progress.streak + 1
        : 1
    : progress.streak;
  const errorKinds = { ...(previous.errorKinds || {}) };
  if (!correct && evidence.diagnostic) {
    errorKinds[evidence.diagnostic.kind] = (errorKinds[evidence.diagnostic.kind] || 0) + 1;
  }

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
        independentPasses: (previous.independentPasses || 0) + (independentPass ? 1 : 0),
        lastIndependentAt: independentPass ? now.toISOString() : previous.lastIndependentAt,
        errorKinds,
        lastDiagnostic: !correct && evidence.diagnostic ? evidence.diagnostic : previous.lastDiagnostic,
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

export function recordSolutionView(progress: Progress, taskId: string): Progress {
  const previous = progress.taskStats[taskId] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  return {
    ...progress,
    taskStats: {
      ...progress.taskStats,
      [taskId]: { ...previous, solutionViews: (previous.solutionViews || 0) + 1 }
    }
  };
}

export function hasIndependentTaskEvidence(progress: Progress, taskId: string) {
  const stats = progress.taskStats[taskId];
  if (!stats || !progress.completed.includes(taskId)) return false;
  if ((stats.independentPasses || 0) > 0) return true;
  return stats.independentPasses === undefined
    && stats.solutionViews === undefined
    && stats.attempts > 0
    && stats.attempts <= 2
    && stats.hintsUsed === 0;
}

export function moduleErrorSummary(progress: Progress, moduleId: string) {
  const totals = new Map<AttemptErrorKind, number>();
  for (const task of tasks.filter(item => item.module === moduleId)) {
    const kinds = progress.taskStats[task.id]?.errorKinds || {};
    for (const [kind, count] of Object.entries(kinds) as Array<[AttemptErrorKind, number | undefined]>) {
      totals.set(kind, (totals.get(kind) || 0) + (count || 0));
    }
  }
  return Array.from(totals, ([kind, count]) => ({ kind, count }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}

function timestamp(value: string | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function reviewQueue(progress: Progress, limit = 24): SqlTask[] {
  return tasks
    .map(task => {
      const stats = progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
      const completed = progress.completed.includes(task.id);
      const independent = hasIndependentTaskEvidence(progress, task.id);
      const lastAttemptAt = timestamp(stats.lastAttemptAt);
      const lastIndependentAt = timestamp(stats.lastIndependentAt);
      const latestAttemptWasIndependent = independent
        && lastIndependentAt !== null
        && (lastAttemptAt === null || lastIndependentAt >= lastAttemptAt);
      const ageAnchor = latestAttemptWasIndependent ? lastIndependentAt : lastAttemptAt;
      const ageDays = ageAnchor === null
        ? 0
        : Math.max(0, (Date.now() - ageAnchor) / 86_400_000);
      const diagnosed = Object.values(stats.errorKinds || {}).reduce((sum, count) => sum + (count || 0), 0);
      const independentGap = completed && !independent ? 4 : 0;
      const unresolvedRemediation = latestAttemptWasIndependent
        ? 0
        : stats.incorrect * 5 + stats.hintsUsed * 2 + diagnosed + independentGap;
      const unfinishedAttempt = !completed && stats.attempts
        ? 6 + Math.min(stats.attempts, 5)
        : 0;
      const spacedReview = completed
        && independent
        && ageDays >= CLEAN_REVIEW_INTERVAL_DAYS
        ? 1 + Math.min((ageDays - CLEAN_REVIEW_INTERVAL_DAYS) / CLEAN_REVIEW_INTERVAL_DAYS, 3)
        : 0;
      return { task, score: unresolvedRemediation + unfinishedAttempt + spacedReview };
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
      const independent = moduleTasks.filter(task => hasIndependentTaskEvidence(progress, task.id)).length;
      const incorrect = moduleTasks.reduce((sum, task) => sum + (progress.taskStats[task.id]?.incorrect || 0), 0);
      const hints = moduleTasks.reduce((sum, task) => sum + (progress.taskStats[task.id]?.hintsUsed || 0), 0);
      return {
        id,
        title,
        solved,
        independent,
        total: moduleTasks.length,
        score: incorrect * 3 + hints + (moduleTasks.length - solved) * 0.25 + (solved - independent) * 0.5
      };
    })
    .sort((a, b) => b.score - a.score || a.independent - b.independent || a.solved - b.solved)
    .slice(0, limit);
}