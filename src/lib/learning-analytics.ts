import { modules, tasks } from '../data/course-catalog';
import type { AttemptErrorKind } from './attempt-diagnostics';
import { loadAuthSession } from './auth';
import type { Progress } from './progress';
import { hasIndependentTaskEvidence, reviewQueue } from './progress';

export const LEARNING_ANALYTICS_SCHEMA_VERSION = 1 as const;
export const LEARNING_ANALYTICS_CHANGED_EVENT = 'sql-academy-learning-analytics-changed';
const STORAGE_PREFIX = 'sql-academy-learning-analytics-v1:';
const ACTIVE_SESSION_PREFIX = 'sql-academy-learning-analytics-session-v1:';
const MAX_EVENTS = 5_000;
const MAX_EVENT_AGE_MS = 180 * 86_400_000;
const MAX_COUNTER = 10_000;

export type LearningAnalyticsEventType =
  | 'session_started'
  | 'task_opened'
  | 'attempted'
  | 'understood'
  | 'diagnostic_observed'
  | 'independent_pass'
  | 'retention_checked'
  | 'lapse_detected'
  | 'remediation_started'
  | 'remediation_completed'
  | 'session_ended';

export type LearningAnalyticsEvent = {
  version: 1;
  id: string;
  sessionId: string;
  occurredAt: string;
  type: LearningAnalyticsEventType;
  moduleId?: string;
  taskId?: string;
  diagnosticKind?: AttemptErrorKind;
  correct?: boolean;
  independent?: boolean;
  remediation?: 'hint' | 'solution' | 'retry' | 'review';
  durationBucket?: 'under-5m' | '5-15m' | '15-30m' | '30-60m' | '60m-plus';
};

export type LearningAnalyticsSharing = 'off' | 'coarse-opt-in';

export type LearningAnalyticsState = {
  version: 1;
  userId: string;
  sharing: LearningAnalyticsSharing;
  events: LearningAnalyticsEvent[];
  experimentVariants: Record<string, 'control' | 'variant-a' | 'variant-b'>;
  updatedAt: string;
};

export type LearningFunnel = {
  opened: number;
  attempted: number;
  understood: number;
  independent: number;
  retained: number;
};

export type LearningIntervention = {
  id: 'overload' | 'repeated-misconception' | 'stalled-module' | 'review-debt';
  severity: 'notice' | 'important';
  title: string;
  reason: string;
  action: string;
  moduleId?: string;
  diagnosticKind?: AttemptErrorKind;
};

export type LocalLearningAnalyticsReport = {
  funnel: LearningFunnel;
  sessions: number;
  attempts: number;
  independentPasses: number;
  retainedPasses: number;
  lapses: number;
  remediationStarts: number;
  remediationSuccesses: number;
  misconceptionCounts: Partial<Record<AttemptErrorKind, number>>;
  timeToMastery: Record<'same-session' | 'same-day' | '2-7-days' | '8-30-days' | 'over-30-days', number>;
  interventions: LearningIntervention[];
};

export type LearningAnalyticsSnapshotRow = {
  moduleId: string;
  opened: number;
  attempted: number;
  understood: number;
  independent: number;
  retained: number;
  lapses: number;
  remediations: number;
  remediationSuccesses: number;
  studyMinutesBucket: 0 | 5 | 15 | 30 | 60;
  overload: 0 | 1;
  stalled: 0 | 1;
  reviewDebt: 0 | 1;
  topDiagnosticKind: AttemptErrorKind | null;
};

export type LearningAnalyticsSnapshot = {
  version: 1;
  periodStart: string;
  courseVersion: 3;
  rows: LearningAnalyticsSnapshotRow[];
  experiments: Record<string, 'control' | 'variant-a' | 'variant-b'>;
};

export type CohortAnalyticsRow = LearningAnalyticsSnapshotRow & {
  periodStart: string;
  contributors: number;
  suppressed: false;
};

export type CohortAnalyticsReport = {
  version: 1;
  minimumCohort: number;
  generatedAt: string;
  rows: CohortAnalyticsRow[];
  suppressedRows: number;
};

const validTypes = new Set<LearningAnalyticsEventType>([
  'session_started', 'task_opened', 'attempted', 'understood', 'diagnostic_observed',
  'independent_pass', 'retention_checked', 'lapse_detected', 'remediation_started',
  'remediation_completed', 'session_ended'
]);
const validDiagnostics = new Set<AttemptErrorKind>([
  'syntax', 'schema', 'runtime', 'result-shape', 'row-set', 'ordering', 'values',
  'null-filter', 'aggregation', 'join-cardinality'
]);
const moduleIds = new Set(modules.map(([id]) => id));
const taskById = new Map(tasks.map(task => [task.id, task]));
const taskByTitle = new Map(tasks.map(task => [task.title, task]));

function nowIso() {
  return new Date().toISOString();
}

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function activeSessionKey(userId: string) {
  return `${ACTIVE_SESSION_PREFIX}${userId}`;
}

function boundedCounter(value: unknown) {
  return Math.max(0, Math.min(MAX_COUNTER, Math.trunc(Number(value) || 0)));
}

function validIso(value: unknown) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(new Date(value).getTime());
}

function sanitizeEvent(value: unknown): LearningAnalyticsEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<LearningAnalyticsEvent>;
  if (item.version !== 1
    || typeof item.id !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(item.id)
    || typeof item.sessionId !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(item.sessionId)
    || !validIso(item.occurredAt)
    || !validTypes.has(item.type as LearningAnalyticsEventType)) return null;
  const task = typeof item.taskId === 'string' ? taskById.get(item.taskId) : undefined;
  const moduleId = typeof item.moduleId === 'string' && moduleIds.has(item.moduleId)
    ? item.moduleId
    : task?.module;
  const diagnosticKind = item.diagnosticKind && validDiagnostics.has(item.diagnosticKind)
    ? item.diagnosticKind
    : undefined;
  const remediation = item.remediation && ['hint', 'solution', 'retry', 'review'].includes(item.remediation)
    ? item.remediation
    : undefined;
  const durationBucket = item.durationBucket && ['under-5m', '5-15m', '15-30m', '30-60m', '60m-plus'].includes(item.durationBucket)
    ? item.durationBucket
    : undefined;
  return {
    version: 1,
    id: item.id,
    sessionId: item.sessionId,
    occurredAt: item.occurredAt as string,
    type: item.type as LearningAnalyticsEventType,
    ...(moduleId ? { moduleId } : {}),
    ...(task ? { taskId: task.id } : {}),
    ...(diagnosticKind ? { diagnosticKind } : {}),
    ...(typeof item.correct === 'boolean' ? { correct: item.correct } : {}),
    ...(typeof item.independent === 'boolean' ? { independent: item.independent } : {}),
    ...(remediation ? { remediation } : {}),
    ...(durationBucket ? { durationBucket } : {})
  };
}

export function emptyLearningAnalyticsState(userId: string): LearningAnalyticsState {
  return {
    version: 1,
    userId,
    sharing: 'off',
    events: [],
    experimentVariants: {},
    updatedAt: nowIso()
  };
}

export function sanitizeLearningAnalyticsState(value: unknown, userId: string): LearningAnalyticsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyLearningAnalyticsState(userId);
  const source = value as Partial<LearningAnalyticsState>;
  const cutoff = Date.now() - MAX_EVENT_AGE_MS;
  const seen = new Set<string>();
  const events = Array.isArray(source.events)
    ? source.events
      .map(sanitizeEvent)
      .filter((event): event is LearningAnalyticsEvent => Boolean(event))
      .filter(event => new Date(event.occurredAt).getTime() >= cutoff)
      .filter(event => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      })
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      .slice(-MAX_EVENTS)
    : [];
  const experimentVariants: LearningAnalyticsState['experimentVariants'] = {};
  if (source.experimentVariants && typeof source.experimentVariants === 'object' && !Array.isArray(source.experimentVariants)) {
    for (const [experimentId, variant] of Object.entries(source.experimentVariants)) {
      if (/^[a-z0-9-]{3,80}$/i.test(experimentId) && ['control', 'variant-a', 'variant-b'].includes(String(variant))) {
        experimentVariants[experimentId] = variant as 'control' | 'variant-a' | 'variant-b';
      }
    }
  }
  return {
    version: 1,
    userId,
    sharing: source.sharing === 'coarse-opt-in' ? 'coarse-opt-in' : 'off',
    events,
    experimentVariants,
    updatedAt: validIso(source.updatedAt) ? source.updatedAt as string : nowIso()
  };
}

export function loadLearningAnalyticsState(userId = loadAuthSession()?.userId): LearningAnalyticsState | null {
  if (!userId) return null;
  try {
    return sanitizeLearningAnalyticsState(JSON.parse(localStorage.getItem(storageKey(userId)) || 'null'), userId);
  } catch {
    return emptyLearningAnalyticsState(userId);
  }
}

export function saveLearningAnalyticsState(state: LearningAnalyticsState) {
  const next = sanitizeLearningAnalyticsState({ ...state, updatedAt: nowIso() }, state.userId);
  localStorage.setItem(storageKey(state.userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(LEARNING_ANALYTICS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function deleteLocalLearningAnalytics(userId = loadAuthSession()?.userId) {
  if (!userId) return;
  localStorage.removeItem(storageKey(userId));
  sessionStorage.removeItem(activeSessionKey(userId));
  window.dispatchEvent(new CustomEvent(LEARNING_ANALYTICS_CHANGED_EVENT, { detail: null }));
}

export function activeLearningSession(userId = loadAuthSession()?.userId) {
  if (!userId) return null;
  const key = activeSessionKey(userId);
  const current = sessionStorage.getItem(key);
  if (current && /^[a-z0-9-]{8,80}$/i.test(current)) return current;
  const sessionId = crypto.randomUUID();
  sessionStorage.setItem(key, sessionId);
  return sessionId;
}

export function appendLearningEvent(input: Omit<LearningAnalyticsEvent, 'version' | 'id' | 'sessionId' | 'occurredAt'> & {
  occurredAt?: string;
  sessionId?: string;
}, userId = loadAuthSession()?.userId) {
  if (!userId) return null;
  const state = loadLearningAnalyticsState(userId) || emptyLearningAnalyticsState(userId);
  const sessionId = input.sessionId || activeLearningSession(userId);
  if (!sessionId) return state;
  const event = sanitizeEvent({
    ...input,
    version: 1,
    id: crypto.randomUUID(),
    sessionId,
    occurredAt: input.occurredAt || nowIso()
  });
  if (!event) return state;
  return saveLearningAnalyticsState({ ...state, events: [...state.events, event] });
}

export function setLearningAnalyticsSharing(sharing: LearningAnalyticsSharing, userId = loadAuthSession()?.userId) {
  if (!userId) return null;
  const state = loadLearningAnalyticsState(userId) || emptyLearningAnalyticsState(userId);
  return saveLearningAnalyticsState({ ...state, sharing });
}

function uniqueTasks(events: LearningAnalyticsEvent[], types: LearningAnalyticsEventType[]) {
  return new Set(events.filter(event => types.includes(event.type) && event.taskId).map(event => event.taskId)).size;
}

function durationMinutes(events: LearningAnalyticsEvent[]) {
  const starts = new Map<string, number>();
  let milliseconds = 0;
  for (const event of events) {
    const at = new Date(event.occurredAt).getTime();
    if (event.type === 'session_started') starts.set(event.sessionId, at);
    if (event.type === 'session_ended') {
      const started = starts.get(event.sessionId);
      if (started) milliseconds += Math.max(0, Math.min(4 * 3_600_000, at - started));
    }
  }
  return Math.round(milliseconds / 60_000);
}

function timeBucket(minutes: number): 0 | 5 | 15 | 30 | 60 {
  if (minutes < 5) return 0;
  if (minutes < 15) return 5;
  if (minutes < 30) return 15;
  if (minutes < 60) return 30;
  return 60;
}

function masteryDurations(events: LearningAnalyticsEvent[]) {
  const result: LocalLearningAnalyticsReport['timeToMastery'] = {
    'same-session': 0,
    'same-day': 0,
    '2-7-days': 0,
    '8-30-days': 0,
    'over-30-days': 0
  };
  const opened = new Map<string, LearningAnalyticsEvent>();
  for (const event of events) {
    if (!event.taskId) continue;
    if ((event.type === 'task_opened' || event.type === 'attempted') && !opened.has(event.taskId)) opened.set(event.taskId, event);
    if (event.type !== 'independent_pass') continue;
    const start = opened.get(event.taskId);
    if (!start) continue;
    const days = Math.max(0, (new Date(event.occurredAt).getTime() - new Date(start.occurredAt).getTime()) / 86_400_000);
    if (event.sessionId === start.sessionId) result['same-session'] += 1;
    else if (days < 1) result['same-day'] += 1;
    else if (days <= 7) result['2-7-days'] += 1;
    else if (days <= 30) result['8-30-days'] += 1;
    else result['over-30-days'] += 1;
  }
  return result;
}

function interventionRules(state: LearningAnalyticsState, progress?: Progress): LearningIntervention[] {
  const result: LearningIntervention[] = [];
  const activeSessionId = activeLearningSession(state.userId);
  const sessionEvents = state.events.filter(event => event.sessionId === activeSessionId);
  const attempts = sessionEvents.filter(event => event.type === 'attempted');
  const correct = attempts.filter(event => event.correct).length;
  if (attempts.length >= 6 && correct / attempts.length <= 0.3) {
    result.push({
      id: 'overload', severity: 'important', title: 'Пора снизить нагрузку',
      reason: `${attempts.length - correct} из ${attempts.length} последних попыток не подтвердили contract.`,
      action: 'Останови новый материал и сделай короткий разбор одной ошибки.'
    });
  }

  const weekCutoff = Date.now() - 7 * 86_400_000;
  const diagnostics = state.events.filter(event => event.type === 'diagnostic_observed'
    && event.diagnosticKind && new Date(event.occurredAt).getTime() >= weekCutoff);
  for (const kind of validDiagnostics) {
    const matching = diagnostics.filter(event => event.diagnosticKind === kind);
    const distinctTasks = new Set(matching.map(event => event.taskId).filter(Boolean));
    if (matching.length >= 3 && distinctTasks.size >= 2) {
      const moduleId = matching.map(event => event.moduleId).find(Boolean);
      result.push({
        id: 'repeated-misconception', severity: 'important', title: 'Повторяется одна модель ошибки',
        reason: `${kind}: ${matching.length} наблюдений минимум в ${distinctTasks.size} задачах за 7 дней.`,
        action: 'Открой контрпример этой misconception и затем реши новую задачу без reference.',
        moduleId, diagnosticKind: kind
      });
      break;
    }
  }

  const moduleAttempts = new Map<string, number>();
  const moduleIndependent = new Set<string>();
  for (const event of sessionEvents) {
    if (!event.moduleId) continue;
    if (event.type === 'attempted') moduleAttempts.set(event.moduleId, (moduleAttempts.get(event.moduleId) || 0) + 1);
    if (event.type === 'independent_pass') moduleIndependent.add(event.moduleId);
  }
  const stalled = [...moduleAttempts].find(([moduleId, count]) => count >= 5 && !moduleIndependent.has(moduleId));
  if (stalled) {
    result.push({
      id: 'stalled-module', severity: 'important', title: 'Модуль застрял',
      reason: `${stalled[1]} попыток в текущей сессии без independent evidence.`,
      action: 'Вернись к foundation lesson и реши один минимальный counterexample.', moduleId: stalled[0]
    });
  }

  if (progress) {
    const due = reviewQueue(progress, 30);
    const oldest = due
      .map(task => progress.taskStats[task.id]?.lastAttemptAt)
      .filter((value): value is string => Boolean(value))
      .map(value => (Date.now() - new Date(value).getTime()) / 86_400_000)
      .sort((left, right) => right - left)[0] || 0;
    if (due.length >= 5 || oldest >= 7) {
      result.push({
        id: 'review-debt', severity: 'notice', title: 'Накопился долг повторения',
        reason: `${due.length} задач требуют проверки; самая старая ожидает ${Math.floor(oldest)} дней.`,
        action: 'Собери 15-минутную review-сессию до нового материала.'
      });
    }
  }
  return result;
}

export function localLearningAnalyticsReport(state: LearningAnalyticsState, progress?: Progress): LocalLearningAnalyticsReport {
  const misconceptionCounts: LocalLearningAnalyticsReport['misconceptionCounts'] = {};
  for (const event of state.events) {
    if (event.type === 'diagnostic_observed' && event.diagnosticKind) {
      misconceptionCounts[event.diagnosticKind] = boundedCounter((misconceptionCounts[event.diagnosticKind] || 0) + 1);
    }
  }
  return {
    funnel: {
      opened: uniqueTasks(state.events, ['task_opened', 'attempted']),
      attempted: uniqueTasks(state.events, ['attempted']),
      understood: uniqueTasks(state.events, ['understood', 'independent_pass', 'retention_checked']),
      independent: uniqueTasks(state.events, ['independent_pass', 'retention_checked']),
      retained: uniqueTasks(state.events, ['retention_checked'])
    },
    sessions: new Set(state.events.filter(event => event.type === 'session_started').map(event => event.sessionId)).size,
    attempts: state.events.filter(event => event.type === 'attempted').length,
    independentPasses: state.events.filter(event => event.type === 'independent_pass').length,
    retainedPasses: state.events.filter(event => event.type === 'retention_checked').length,
    lapses: state.events.filter(event => event.type === 'lapse_detected').length,
    remediationStarts: state.events.filter(event => event.type === 'remediation_started').length,
    remediationSuccesses: state.events.filter(event => event.type === 'remediation_completed').length,
    misconceptionCounts,
    timeToMastery: masteryDurations(state.events),
    interventions: interventionRules(state, progress)
  };
}

function weekStart(date = new Date()) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return copy.toISOString().slice(0, 10);
}

function experimentVariant(userId: string, experimentId: string) {
  let hash = 2166136261;
  for (const character of `${experimentId}:${userId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 === 0 ? 'control' as const : 'variant-a' as const;
}

export function ensureExperimentVariant(experimentId: string, userId = loadAuthSession()?.userId) {
  if (!userId || !/^[a-z0-9-]{3,80}$/i.test(experimentId)) return null;
  const state = loadLearningAnalyticsState(userId) || emptyLearningAnalyticsState(userId);
  const existing = state.experimentVariants[experimentId];
  if (existing) return existing;
  const variant = experimentVariant(userId, experimentId);
  saveLearningAnalyticsState({
    ...state,
    experimentVariants: { ...state.experimentVariants, [experimentId]: variant }
  });
  return variant;
}

export function buildLearningAnalyticsSnapshot(state: LearningAnalyticsState, progress?: Progress): LearningAnalyticsSnapshot {
  const report = localLearningAnalyticsReport(state, progress);
  const rows: LearningAnalyticsSnapshotRow[] = [];
  for (const [moduleId] of modules) {
    const events = state.events.filter(event => event.moduleId === moduleId);
    if (!events.length) continue;
    const diagnostics: Partial<Record<AttemptErrorKind, number>> = {};
    for (const event of events) {
      if (event.type === 'diagnostic_observed' && event.diagnosticKind) {
        diagnostics[event.diagnosticKind] = boundedCounter((diagnostics[event.diagnosticKind] || 0) + 1);
      }
    }
    const topDiagnosticKind = (Object.entries(diagnostics) as Array<[AttemptErrorKind, number]>)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || null;
    const interventions = report.interventions.filter(item => !item.moduleId || item.moduleId === moduleId);
    rows.push({
      moduleId,
      opened: uniqueTasks(events, ['task_opened', 'attempted']),
      attempted: uniqueTasks(events, ['attempted']),
      understood: uniqueTasks(events, ['understood', 'independent_pass', 'retention_checked']),
      independent: uniqueTasks(events, ['independent_pass', 'retention_checked']),
      retained: uniqueTasks(events, ['retention_checked']),
      lapses: events.filter(event => event.type === 'lapse_detected').length,
      remediations: events.filter(event => event.type === 'remediation_started').length,
      remediationSuccesses: events.filter(event => event.type === 'remediation_completed').length,
      studyMinutesBucket: timeBucket(durationMinutes(events)),
      overload: interventions.some(item => item.id === 'overload') ? 1 : 0,
      stalled: interventions.some(item => item.id === 'stalled-module') ? 1 : 0,
      reviewDebt: interventions.some(item => item.id === 'review-debt') ? 1 : 0,
      topDiagnosticKind
    });
  }
  return {
    version: 1,
    periodStart: weekStart(),
    courseVersion: 3,
    rows,
    experiments: { ...state.experimentVariants }
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

export async function syncLearningAnalyticsSnapshot(progress?: Progress, userId = loadAuthSession()?.userId) {
  if (!userId) throw new Error('Сессия отсутствует');
  const state = loadLearningAnalyticsState(userId) || emptyLearningAnalyticsState(userId);
  if (state.sharing !== 'coarse-opt-in') return { skipped: true as const };
  const snapshot = buildLearningAnalyticsSnapshot(state, progress);
  return parseResponse<{ ok: true; periodStart: string; rows: number }>(await fetch('/api/learning-analytics/snapshot', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ snapshot })
  }));
}

export async function loadCohortAnalyticsReport() {
  return parseResponse<CohortAnalyticsReport>(await fetch('/api/learning-analytics/report'));
}

export async function deleteCloudLearningAnalytics() {
  return parseResponse<{ ok: true }>(await fetch('/api/learning-analytics', { method: 'DELETE' }));
}

export async function exportCloudLearningAnalytics() {
  return parseResponse<{ version: 1; sharing: LearningAnalyticsSharing; snapshots: LearningAnalyticsSnapshot[] }>(
    await fetch('/api/learning-analytics/export')
  );
}

export function exportLocalLearningAnalytics(state: LearningAnalyticsState) {
  return JSON.stringify({
    version: 1,
    exportedAt: nowIso(),
    privacy: 'local-full-event-log',
    state
  }, null, 2);
}

export function taskForAnalyticsTitle(title: string) {
  return taskByTitle.get(title) || null;
}

export function taskHasIndependentEvidence(progress: Progress, taskId: string) {
  return hasIndependentTaskEvidence(progress, taskId);
}
