import { modules, SqlTask, tasks } from '../data/course-catalog';
import type { AttemptDiagnostic, AttemptErrorKind } from './attempt-diagnostics';
import {
  FOUNDATION_EVIDENCE_CONTRACT_VERSION,
  TASK_EVALUATION_CONTRACT_VERSION,
  type TaskEvaluationEvidence
} from './task-evaluation-types';
import {
  incrementTaskCounterStats,
  normalizeTaskCounterStats,
  type TaskCounterComponents
} from './progress-counters';

export type ActivityPoint = { day: string; solved: number };
export type TaskStats = {
  attempts: number;
  incorrect: number;
  hintsUsed: number;
  solutionViews?: number;
  solutionViewedAt?: string;
  assistedPasses?: number;
  lastAssistedAt?: string;
  retrievalDueAt?: string;
  retrievalEvidenceVersion?: string;
  retrievalSourceTaskId?: string;
  retrievalScheduledAt?: string;
  retrievalIntervalDays?: number;
  retrievalSuccesses?: number;
  retrievalLapses?: number;
  lastRetrievalAt?: string;
  lastRetrievalPassed?: boolean;
  durableEvidenceAt?: string;
  durableUntil?: string;
  independentPasses?: number;
  lastIndependentAt?: string;
  errorKinds?: Partial<Record<AttemptErrorKind, number>>;
  counterComponents?: TaskCounterComponents;
  lastDiagnostic?: AttemptDiagnostic;
  lastAttemptAt?: string;
  completedAt?: string;
  evidenceContractVersion?: string;
  evaluationContractId?: string;
  evaluationContractVersion?: string;
  validatedFixtureIds?: string[];
  hiddenFixtureIds?: string[];
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
  contractEvidence?: TaskEvaluationEvidence;
  at?: Date | string | number;
  replicaId?: string;
};

export const STORAGE_KEY = 'sql-academy-progress-v4';
export const PROGRESS_CHANGED_EVENT = 'sql-academy-progress-changed';
export const CLEAN_REVIEW_INTERVAL_DAYS = 3;
export const DURABLE_MASTERY_EVIDENCE_VERSION = 'durable-mastery-v1';
export const INITIAL_RETRIEVAL_DELAY_MINUTES = 10;
export const MAX_RETRIEVAL_INTERVAL_DAYS = 30;
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
    const normalized: TaskStats = {
      attempts: Math.max(0, Number(value.attempts) || 0),
      incorrect: Math.max(0, Number(value.incorrect) || 0),
      hintsUsed: Math.max(0, Number(value.hintsUsed) || 0),
      solutionViews: value.solutionViews === undefined ? undefined : Math.max(0, Number(value.solutionViews) || 0),
      solutionViewedAt: typeof value.solutionViewedAt === 'string' ? value.solutionViewedAt : undefined,
      assistedPasses: value.assistedPasses === undefined ? undefined : Math.max(0, Number(value.assistedPasses) || 0),
      lastAssistedAt: typeof value.lastAssistedAt === 'string' ? value.lastAssistedAt : undefined,
      retrievalDueAt: typeof value.retrievalDueAt === 'string' ? value.retrievalDueAt : undefined,
      retrievalEvidenceVersion: value.retrievalEvidenceVersion === DURABLE_MASTERY_EVIDENCE_VERSION
        ? value.retrievalEvidenceVersion
        : undefined,
      retrievalSourceTaskId: typeof value.retrievalSourceTaskId === 'string' ? value.retrievalSourceTaskId : undefined,
      retrievalScheduledAt: typeof value.retrievalScheduledAt === 'string' ? value.retrievalScheduledAt : undefined,
      retrievalIntervalDays: value.retrievalIntervalDays === undefined ? undefined : Math.max(0, Number(value.retrievalIntervalDays) || 0),
      retrievalSuccesses: value.retrievalSuccesses === undefined ? undefined : Math.max(0, Number(value.retrievalSuccesses) || 0),
      retrievalLapses: value.retrievalLapses === undefined ? undefined : Math.max(0, Number(value.retrievalLapses) || 0),
      lastRetrievalAt: typeof value.lastRetrievalAt === 'string' ? value.lastRetrievalAt : undefined,
      lastRetrievalPassed: typeof value.lastRetrievalPassed === 'boolean' ? value.lastRetrievalPassed : undefined,
      durableEvidenceAt: typeof value.durableEvidenceAt === 'string' ? value.durableEvidenceAt : undefined,
      durableUntil: typeof value.durableUntil === 'string' ? value.durableUntil : undefined,
      independentPasses: value.independentPasses === undefined ? undefined : Math.max(0, Number(value.independentPasses) || 0),
      lastIndependentAt: typeof value.lastIndependentAt === 'string' ? value.lastIndependentAt : undefined,
      errorKinds: value.errorKinds && typeof value.errorKinds === 'object' ? value.errorKinds : undefined,
      counterComponents: value.counterComponents && typeof value.counterComponents === 'object'
        ? value.counterComponents
        : undefined,
      lastDiagnostic: value.lastDiagnostic && typeof value.lastDiagnostic === 'object' ? value.lastDiagnostic : undefined,
      lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : undefined,
      completedAt: typeof value.completedAt === 'string' ? value.completedAt : undefined,
      evidenceContractVersion: typeof value.evidenceContractVersion === 'string' ? value.evidenceContractVersion : undefined,
      evaluationContractId: typeof value.evaluationContractId === 'string' ? value.evaluationContractId : undefined,
      evaluationContractVersion: typeof value.evaluationContractVersion === 'string' ? value.evaluationContractVersion : undefined,
      validatedFixtureIds: Array.isArray(value.validatedFixtureIds)
        ? Array.from(new Set(value.validatedFixtureIds.filter((item): item is string => typeof item === 'string'))).sort()
        : undefined,
      hiddenFixtureIds: Array.isArray(value.hiddenFixtureIds)
        ? Array.from(new Set(value.hiddenFixtureIds.filter((item): item is string => typeof item === 'string'))).sort()
        : undefined
    };
    result[taskId] = { ...normalized, ...normalizeTaskCounterStats(normalized) };
  }
  return result;
}

function evidenceDate(value: Date | string | number | undefined) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

function retrievalCandidates(source: SqlTask) {
  const sourceContext = source.learningContract?.contextId;
  const sourceFamily = source.learningContract?.solutionFamily;
  const modePriority = { practice: 0, lesson: 1, interview: 2, puzzle: 3 } as const;
  return tasks
    .filter(candidate => candidate.module === source.module && candidate.id !== source.id)
    .filter(candidate => !sourceContext || !sourceFamily
      || (candidate.learningContract?.contextId !== sourceContext
        && candidate.learningContract?.solutionFamily !== sourceFamily))
    .sort((left, right) => modePriority[left.mode] - modePriority[right.mode] || left.id.localeCompare(right.id));
}

export function relatedRetrievalTask(source: SqlTask, progress?: Progress) {
  const candidates = retrievalCandidates(source);
  if (!candidates.length) return null;
  const available = progress
    ? candidates.filter(candidate => {
        const stats = progress.taskStats[candidate.id];
        return !stats?.retrievalSourceTaskId || stats.retrievalSourceTaskId === source.id;
      })
    : candidates;
  return progress ? available[0] || null : candidates[0];
}

function nextIntervalDays(successes: number, previous: number) {
  if (successes <= 1) return 1;
  if (successes === 2) return 3;
  return Math.min(MAX_RETRIEVAL_INTERVAL_DAYS, Math.max(4, Math.round(Math.max(1, previous) * 2)));
}

function retryDelayMs(lapses: number) {
  const minutes = Math.min(24 * 60, INITIAL_RETRIEVAL_DELAY_MINUTES * (3 ** Math.max(0, lapses - 1)));
  return minutes * 60_000;
}

function scheduleRelatedRetrieval(
  progress: Progress,
  source: SqlTask,
  now: Date,
  resetExisting: boolean
) {
  const target = relatedRetrievalTask(source, progress);
  if (!target) return progress.taskStats;
  const previous = progress.taskStats[target.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  if (previous.retrievalSourceTaskId === source.id && previous.retrievalDueAt && !resetExisting) {
    return progress.taskStats;
  }
  return {
    ...progress.taskStats,
    [target.id]: {
      ...previous,
      retrievalEvidenceVersion: DURABLE_MASTERY_EVIDENCE_VERSION,
      retrievalSourceTaskId: source.id,
      retrievalScheduledAt: now.toISOString(),
      retrievalDueAt: new Date(now.getTime() + INITIAL_RETRIEVAL_DELAY_MINUTES * 60_000).toISOString(),
      retrievalIntervalDays: 0,
      lastRetrievalPassed: false,
      durableEvidenceAt: undefined,
      durableUntil: undefined
    }
  };
}

export function migrateProgress(raw: unknown): Progress {
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
    if (current) return migrateProgress(JSON.parse(current));
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) return migrateProgress(JSON.parse(legacy));
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
  const now = evidenceDate(evidence.at);
  const today = localDateKey(now);
  const previous = progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  const alreadyCompleted = progress.completed.includes(task.id);
  const newlyCompleted = correct && !alreadyCompleted;
  const retrievalDue = timestamp(previous.retrievalDueAt);
  const scheduledRetrieval = previous.retrievalEvidenceVersion === DURABLE_MASTERY_EVIDENCE_VERSION
    && Boolean(previous.retrievalSourceTaskId)
    && previous.retrievalSourceTaskId !== task.id
    && retrievalDue !== null
    && retrievalDue <= now.getTime();
  const independentPass = Boolean(correct && evidence.independent);
  const weekdayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const streak = newlyCompleted
    ? progress.lastStudyDate === today
      ? progress.streak
      : progress.lastStudyDate === previousDateKey()
        ? progress.streak + 1
        : 1
    : progress.streak;
  const counterStats = incrementTaskCounterStats(previous, {
    attempts: 1,
    incorrect: correct ? 0 : 1,
    assistedPasses: correct && !independentPass ? 1 : 0,
    independentPasses: independentPass ? 1 : 0,
    retrievalSuccesses: scheduledRetrieval && independentPass ? 1 : 0,
    retrievalLapses: scheduledRetrieval && !independentPass ? 1 : 0,
    errorKinds: !correct && evidence.diagnostic ? { [evidence.diagnostic.kind]: 1 } : undefined
  }, evidence.replicaId);
  const retrievalSuccesses = counterStats.retrievalSuccesses;
  const retrievalLapses = counterStats.retrievalLapses;
  const retrievalIntervalDays = scheduledRetrieval && independentPass
    ? nextIntervalDays(retrievalSuccesses || 1, previous.retrievalIntervalDays || 0)
    : scheduledRetrieval && !independentPass
      ? 0
      : previous.retrievalIntervalDays;
  const nextRetrievalDueAt = scheduledRetrieval
    ? independentPass
      ? new Date(now.getTime() + (retrievalIntervalDays || 1) * 86_400_000).toISOString()
      : new Date(now.getTime() + retryDelayMs(retrievalLapses || 1)).toISOString()
    : previous.retrievalDueAt;
  const nextCurrentStats: TaskStats = {
    ...previous,
    ...counterStats,
    lastAssistedAt: correct && !independentPass ? now.toISOString() : previous.lastAssistedAt,
    lastIndependentAt: independentPass ? now.toISOString() : previous.lastIndependentAt,
    retrievalDueAt: nextRetrievalDueAt,
    retrievalIntervalDays,
    retrievalSuccesses,
    retrievalLapses,
    lastRetrievalAt: scheduledRetrieval ? now.toISOString() : previous.lastRetrievalAt,
    lastRetrievalPassed: scheduledRetrieval ? independentPass : previous.lastRetrievalPassed,
    durableEvidenceAt: scheduledRetrieval && independentPass ? now.toISOString() : scheduledRetrieval ? undefined : previous.durableEvidenceAt,
    durableUntil: scheduledRetrieval && independentPass ? nextRetrievalDueAt : scheduledRetrieval ? undefined : previous.durableUntil,
    lastDiagnostic: !correct && evidence.diagnostic ? evidence.diagnostic : previous.lastDiagnostic,
    lastAttemptAt: now.toISOString(),
    completedAt: newlyCompleted ? now.toISOString() : previous.completedAt,
    evidenceContractVersion: independentPass && evidence.contractEvidence
      ? evidence.contractEvidence.evidenceContractVersion
      : previous.evidenceContractVersion,
    evaluationContractId: independentPass && evidence.contractEvidence
      ? evidence.contractEvidence.contractId
      : previous.evaluationContractId,
    evaluationContractVersion: independentPass && evidence.contractEvidence
      ? evidence.contractEvidence.contractVersion
      : previous.evaluationContractVersion,
    validatedFixtureIds: independentPass && evidence.contractEvidence
      ? [...evidence.contractEvidence.fixtureIds].sort()
      : previous.validatedFixtureIds,
    hiddenFixtureIds: independentPass && evidence.contractEvidence
      ? [...evidence.contractEvidence.hiddenFixtureIds].sort()
      : previous.hiddenFixtureIds
  };
  let taskStats = { ...progress.taskStats, [task.id]: nextCurrentStats };
  const nextProgress = { ...progress, taskStats };
  if (correct && !independentPass) {
    taskStats = scheduleRelatedRetrieval(nextProgress, task, now, true);
  } else if (independentPass) {
    taskStats = scheduleRelatedRetrieval(nextProgress, task, now, false);
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
    taskStats
  };
}

export function recordHint(progress: Progress, taskId: string, replicaId?: string): Progress {
  const previous = progress.taskStats[taskId] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  const counterStats = incrementTaskCounterStats(previous, { hintsUsed: 1 }, replicaId);
  return {
    ...progress,
    taskStats: {
      ...progress.taskStats,
      [taskId]: { ...previous, ...counterStats }
    }
  };
}

export function recordSolutionView(progress: Progress, taskId: string, at?: Date | string | number, replicaId?: string): Progress {
  const previous = progress.taskStats[taskId] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  const now = evidenceDate(at);
  const task = tasks.find(item => item.id === taskId);
  const counterStats = incrementTaskCounterStats(previous, { solutionViews: 1 }, replicaId);
  const next = {
    ...progress,
    taskStats: {
      ...progress.taskStats,
      [taskId]: {
        ...previous,
        ...counterStats,
        solutionViewedAt: now.toISOString(),
        retrievalDueAt: previous.retrievalSourceTaskId
          ? new Date(now.getTime() + INITIAL_RETRIEVAL_DELAY_MINUTES * 60_000).toISOString()
          : previous.retrievalDueAt,
        retrievalIntervalDays: previous.retrievalSourceTaskId ? 0 : previous.retrievalIntervalDays,
        lastRetrievalAt: previous.retrievalSourceTaskId ? now.toISOString() : previous.lastRetrievalAt,
        lastRetrievalPassed: previous.retrievalSourceTaskId ? false : previous.lastRetrievalPassed,
        durableEvidenceAt: previous.retrievalSourceTaskId ? undefined : previous.durableEvidenceAt,
        durableUntil: previous.retrievalSourceTaskId ? undefined : previous.durableUntil
      }
    }
  };
  return task ? { ...next, taskStats: scheduleRelatedRetrieval(next, task, now, true) } : next;
}

export function hasDurableTaskEvidence(progress: Progress, sourceTaskId: string, now = Date.now()) {
  const source = tasks.find(task => task.id === sourceTaskId);
  if (!source) return false;
  return Object.entries(progress.taskStats).some(([targetTaskId, stats]) => {
    if (targetTaskId === sourceTaskId
      || stats.retrievalEvidenceVersion !== DURABLE_MASTERY_EVIDENCE_VERSION
      || stats.retrievalSourceTaskId !== sourceTaskId
      || !stats.lastRetrievalPassed
      || !stats.durableEvidenceAt
      || !stats.durableUntil
      || Date.parse(stats.durableUntil) <= now) return false;
    const target = tasks.find(task => task.id === targetTaskId);
    if (!target || target.module !== source.module) return false;
    if (!hasDirectIndependentEvidence(progress, targetTaskId)) return false;
    return !source.learningContract || !target.learningContract
      || (source.learningContract.contextId !== target.learningContract.contextId
        && source.learningContract.solutionFamily !== target.learningContract.solutionFamily);
  });
}

function hasDirectIndependentEvidence(progress: Progress, taskId: string) {
  const stats = progress.taskStats[taskId];
  if (!stats || !progress.completed.includes(taskId)) return false;
  const solutionAfterIndependent = timestamp(stats.solutionViewedAt) !== null
    && (timestamp(stats.lastIndependentAt) === null || timestamp(stats.solutionViewedAt)! >= timestamp(stats.lastIndependentAt)!);
  if (solutionAfterIndependent) return false;
  const task = tasks.find(item => item.id === taskId);
  if (task?.evaluationContractId) {
    return (stats.independentPasses || 0) > 0
      && stats.evidenceContractVersion === FOUNDATION_EVIDENCE_CONTRACT_VERSION
      && stats.evaluationContractVersion === TASK_EVALUATION_CONTRACT_VERSION
      && stats.evaluationContractId === task.evaluationContractId
      && (stats.validatedFixtureIds?.length || 0) >= 3
      && (stats.hiddenFixtureIds?.length || 0) >= 2;
  }
  if ((stats.independentPasses || 0) > 0) return true;
  return stats.independentPasses === undefined
    && stats.solutionViews === undefined
    && stats.attempts > 0
    && stats.attempts <= 2
    && stats.hintsUsed === 0;
}

export function hasIndependentTaskEvidence(progress: Progress, taskId: string, now = Date.now()) {
  return hasDirectIndependentEvidence(progress, taskId) || hasDurableTaskEvidence(progress, taskId, now);
}

export function reviewReason(progress: Progress, taskId: string, now = Date.now()) {
  const stats = progress.taskStats[taskId];
  if (!stats) return null;
  const source = stats.retrievalSourceTaskId ? tasks.find(task => task.id === stats.retrievalSourceTaskId) : null;
  if (source && stats.retrievalDueAt && Date.parse(stats.retrievalDueAt) <= now) {
    if ((stats.retrievalLapses || 0) > 0 && !stats.lastRetrievalPassed) {
      return { code: 'failed-retrieval', title: 'Возврат после ошибки', detail: `Проверь ${source.topic} на другой задаче без подсказки. Предыдущая попытка не подтвердила воспроизведение.` } as const;
    }
    if ((stats.retrievalSuccesses || 0) > 0) {
      return { code: 'evidence-refresh', title: 'Срок доказательства подошёл', detail: `Снова примени ${source.topic} в другом контексте: прежнее подтверждение больше не считается свежим.` } as const;
    }
    return { code: 'delayed-transfer', title: 'Отложенная проверка', detail: `Ты уже работал с темой «${source.title}». Теперь реши связанную, но другую задачу без подсказки и эталона.` } as const;
  }
  if (stats.incorrect > 0) return { code: 'remediation', title: 'Разобрать недавнюю ошибку', detail: 'Очередь вернула задачу по сигналу ошибки. Исправь конкретную причину и затем повтори самостоятельно.' } as const;
  if ((stats.assistedPasses || 0) > 0) return { code: 'assisted-follow-up', title: 'После попытки с помощью', detail: 'Подсказка помогла завершить задачу, но доказательства самостоятельного решения пока нет.' } as const;
  if (progress.completed.includes(taskId)) return { code: 'spaced-retrieval', title: 'Пора освежить навык', detail: 'Предыдущее самостоятельное решение устарело; воспроизведи подход снова.' } as const;
  return { code: 'unfinished', title: 'Продолжить начатое', detail: 'Задача была начата, но исполняемое решение ещё не подтверждено.' } as const;
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

const CONFUSABLE_MODULES: Record<string, readonly string[]> = {
  filtering: ['data-quality'],
  'data-quality': ['filtering'],
  aggregates: ['grouping'],
  grouping: ['aggregates'],
  joins: ['subqueries'],
  subqueries: ['joins'],
  sorting: ['windows'],
  windows: ['sorting'],
  transactions: ['schema'],
  schema: ['transactions']
};

function interleaveReviewCandidates<T extends { task: SqlTask; score: number }>(ranked: T[]) {
  const remaining = [...ranked];
  const ordered: T[] = [];
  while (remaining.length) {
    if (!ordered.length) {
      ordered.push(remaining.shift()!);
      continue;
    }
    const previousModule = ordered[ordered.length - 1].task.module;
    const confusable = new Set(CONFUSABLE_MODULES[previousModule] || []);
    let index = remaining.findIndex(item => confusable.has(item.task.module));
    if (index < 0) index = remaining.findIndex(item => item.task.module !== previousModule);
    if (index < 0) index = 0;
    ordered.push(remaining.splice(index, 1)[0]);
  }
  return ordered;
}

export function reviewQueue(progress: Progress, limit = 24, now = Date.now()): SqlTask[] {
  const ranked = tasks
    .map(task => {
      const stats = progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
      const completed = progress.completed.includes(task.id);
      const independent = hasIndependentTaskEvidence(progress, task.id, now);
      const lastAttemptAt = timestamp(stats.lastAttemptAt);
      const lastIndependentAt = timestamp(stats.lastIndependentAt);
      const latestAttemptWasIndependent = independent
        && lastIndependentAt !== null
        && (lastAttemptAt === null || lastIndependentAt >= lastAttemptAt);
      const ageAnchor = latestAttemptWasIndependent ? lastIndependentAt : lastAttemptAt;
      const ageDays = ageAnchor === null
        ? 0
        : Math.max(0, (now - ageAnchor) / 86_400_000);
      const diagnosed = Object.values(stats.errorKinds || {}).reduce((sum, count) => sum + (count || 0), 0);
      const retrievalDue = timestamp(stats.retrievalDueAt);
      const retrievalWaiting = retrievalDue !== null && retrievalDue > now;
      const solutionRetrieval = retrievalDue !== null && retrievalDue <= now ? 12 : 0;
      const independentGap = completed && !independent && !retrievalWaiting ? 4 : 0;
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
      return { task, score: solutionRetrieval + unresolvedRemediation + unfinishedAttempt + spacedReview };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id));
  return interleaveReviewCandidates(ranked)
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
