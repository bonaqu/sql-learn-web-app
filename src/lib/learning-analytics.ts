import { modules, tasks } from '../data/course-catalog';
import type { AttemptErrorKind } from './attempt-diagnostics';
import { loadAuthSession } from './auth';
import type { Progress } from './progress';

export const LEARNING_ANALYTICS_SCHEMA_VERSION = 1 as const;
export const LEARNING_ANALYTICS_CHANGED_EVENT = 'sql-academy-learning-analytics-changed';
const STORAGE_PREFIX = 'sql-academy-learning-analytics-v1:';
const ACTIVE_SESSION_PREFIX = 'sql-academy-learning-analytics-session-v1:';
const MAX_EVENTS = 5_000;
const MAX_EVENT_AGE_MS = 180 * 86_400_000;
const DUPLICATE_WINDOW_MS = 1_500;
const KNOWN_EXPERIMENTS = new Set(['remediation-copy-v1']);

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
export type ExperimentVariant = 'control' | 'variant-a' | 'variant-b';
export type TimeToMasteryBuckets = Record<'same-session' | 'same-day' | '2-7-days' | '8-30-days' | 'over-30-days', number>;

export type LearningAnalyticsState = {
  version: 1;
  userId: string;
  sharing: LearningAnalyticsSharing;
  events: LearningAnalyticsEvent[];
  experimentVariants: Record<string, ExperimentVariant>;
  updatedAt: string;
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
  funnel: { opened: number; attempted: number; understood: number; independent: number; retained: number };
  sessions: number;
  attempts: number;
  independentPasses: number;
  retainedPasses: number;
  lapses: number;
  remediationStarts: number;
  remediationSuccesses: number;
  misconceptionCounts: Partial<Record<AttemptErrorKind, number>>;
  timeToMastery: TimeToMasteryBuckets;
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
  mastery: TimeToMasteryBuckets;
  experiments: Record<string, ExperimentVariant>;
};

export type CohortAnalyticsRow = Omit<LearningAnalyticsSnapshotRow, 'studyMinutesBucket'> & {
  periodStart: string;
  contributors: number;
  suppressed: false;
  studyMinutesAverage: number;
};

export type CohortMasteryRow = TimeToMasteryBuckets & {
  periodStart: string;
  contributors: number;
  suppressed: false;
};

export type CohortExperimentRow = {
  periodStart: string;
  experimentId: string;
  variant: ExperimentVariant;
  contributors: number;
  attempted: number;
  independent: number;
  retained: number;
  remediations: number;
  remediationSuccesses: number;
  suppressed: false;
};

export type CohortAnalyticsReport = {
  version: 1;
  minimumCohort: number;
  generatedAt: string;
  rows: CohortAnalyticsRow[];
  mastery: CohortMasteryRow[];
  experiments: CohortExperimentRow[];
  suppressedRows: number;
  suppressedMasteryPeriods: number;
  suppressedExperiments: number;
};

const eventTypes = new Set<LearningAnalyticsEventType>([
  'session_started', 'task_opened', 'attempted', 'understood', 'diagnostic_observed',
  'independent_pass', 'retention_checked', 'lapse_detected', 'remediation_started',
  'remediation_completed', 'session_ended'
]);
const diagnosticKinds = new Set<AttemptErrorKind>([
  'syntax', 'schema', 'runtime', 'result-shape', 'row-set', 'ordering', 'values',
  'null-filter', 'aggregation', 'join-cardinality'
]);
const moduleIds = new Set(modules.map(([id]) => id));
const taskById = new Map(tasks.map(task => [task.id, task]));
const taskByTitle = new Map(tasks.map(task => [task.title, task]));

const nowIso = () => new Date().toISOString();
const storageKey = (userId: string) => `${STORAGE_PREFIX}${userId}`;
const activeSessionKey = (userId: string) => `${ACTIVE_SESSION_PREFIX}${userId}`;
const validIso = (value: unknown) => typeof value === 'string' && value.length <= 64 && Number.isFinite(new Date(value).getTime());

function sanitizeEvent(value: unknown): LearningAnalyticsEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<LearningAnalyticsEvent>;
  if (item.version !== 1
    || typeof item.id !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(item.id)
    || typeof item.sessionId !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(item.sessionId)
    || !validIso(item.occurredAt)
    || !eventTypes.has(item.type as LearningAnalyticsEventType)) return null;
  const task = typeof item.taskId === 'string' ? taskById.get(item.taskId) : undefined;
  const moduleId = typeof item.moduleId === 'string' && moduleIds.has(item.moduleId) ? item.moduleId : task?.module;
  const diagnosticKind = item.diagnosticKind && diagnosticKinds.has(item.diagnosticKind) ? item.diagnosticKind : undefined;
  const remediation = item.remediation && ['hint', 'solution', 'retry', 'review'].includes(item.remediation) ? item.remediation : undefined;
  const durationBucket = item.durationBucket && ['under-5m', '5-15m', '15-30m', '30-60m', '60m-plus'].includes(item.durationBucket)
    ? item.durationBucket : undefined;
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
  return { version: 1, userId, sharing: 'off', events: [], experimentVariants: {}, updatedAt: nowIso() };
}

export function sanitizeLearningAnalyticsState(value: unknown, userId: string): LearningAnalyticsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyLearningAnalyticsState(userId);
  const source = value as Partial<LearningAnalyticsState>;
  const cutoff = Date.now() - MAX_EVENT_AGE_MS;
  const seen = new Set<string>();
  const events = Array.isArray(source.events) ? source.events
    .map(sanitizeEvent)
    .filter((event): event is LearningAnalyticsEvent => Boolean(event))
    .filter(event => new Date(event.occurredAt).getTime() >= cutoff)
    .filter(event => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .slice(-MAX_EVENTS) : [];
  const experimentVariants: Record<string, ExperimentVariant> = {};
  if (source.experimentVariants && typeof source.experimentVariants === 'object' && !Array.isArray(source.experimentVariants)) {
    for (const [experimentId, variant] of Object.entries(source.experimentVariants)) {
      if (KNOWN_EXPERIMENTS.has(experimentId) && ['control', 'variant-a', 'variant-b'].includes(String(variant))) {
        experimentVariants[experimentId] = variant as ExperimentVariant;
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

function sameEvent(left: LearningAnalyticsEvent, right: LearningAnalyticsEvent) {
  return left.sessionId === right.sessionId
    && left.type === right.type
    && left.moduleId === right.moduleId
    && left.taskId === right.taskId
    && left.diagnosticKind === right.diagnosticKind
    && left.correct === right.correct
    && left.independent === right.independent
    && left.remediation === right.remediation
    && Math.abs(new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime()) <= DUPLICATE_WINDOW_MS;
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
  if (!event || state.events.slice(-8).some(existing => sameEvent(existing, event))) return state;
  return saveLearningAnalyticsState({ ...state, events: [...state.events, event] });
}

export function setLearningAnalyticsSharing(sharing: LearningAnalyticsSharing, userId = loadAuthSession()?.userId) {
  if (!userId) return null;
  const state = loadLearningAnalyticsState(userId) || emptyLearningAnalyticsState(userId);
  return saveLearningAnalyticsState({ ...state, sharing });
}

function uniqueTasks(events: LearningAnalyticsEvent[], types: LearningAnalyticsEventType[]) {
  return new Set(events.filter(event => event.taskId && types.includes(event.type)).map(event => event.taskId)).size;
}

function latestSessionEvents(events: LearningAnalyticsEvent[]) {
  const session = [...events].reverse().find(event => event.type === 'session_started')?.sessionId;
  return session ? events.filter(event => event.sessionId === session) : [];
}

function timeToMastery(events: LearningAnalyticsEvent[]): TimeToMasteryBuckets {
  const result: TimeToMasteryBuckets = { 'same-session': 0, 'same-day': 0, '2-7-days': 0, '8-30-days': 0, 'over-30-days': 0 };
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

function dueReviewCount(progress?: Progress) {
  if (!progress) return { count: 0, oldestDays: 0 };
  let count = 0;
  let oldestDays = 0;
  for (const taskId of progress.completed) {
    const stats = progress.taskStats[taskId];
    const last = stats?.lastIndependentAt || stats?.lastAttemptAt || stats?.completedAt;
    if (!last) continue;
    const days = Math.max(0, (Date.now() - new Date(last).getTime()) / 86_400_000);
    if (days >= 3) {
      count += 1;
      oldestDays = Math.max(oldestDays, days);
    }
  }
  return { count, oldestDays };
}

function interventions(state: LearningAnalyticsState, progress?: Progress): LearningIntervention[] {
  const result: LearningIntervention[] = [];
  const sessionEvents = latestSessionEvents(state.events);
  const attempts = sessionEvents.filter(event => event.type === 'attempted');
  const correct = attempts.filter(event => event.correct).length;
  if (attempts.length >= 6 && correct / attempts.length <= 0.3) {
    result.push({ id: 'overload', severity: 'important', title: 'Пора снизить нагрузку', reason: `${attempts.length - correct} из ${attempts.length} попыток не подтвердили contract.`, action: 'Останови новый материал и разбери одну ошибку.' });
  }
  const cutoff = Date.now() - 7 * 86_400_000;
  const diagnostics = state.events.filter(event => event.type === 'diagnostic_observed' && event.diagnosticKind && new Date(event.occurredAt).getTime() >= cutoff);
  const remediationVariant = state.experimentVariants['remediation-copy-v1'] || 'control';
  for (const kind of diagnosticKinds) {
    const matching = diagnostics.filter(event => event.diagnosticKind === kind);
    const taskCount = new Set(matching.map(event => event.taskId).filter(Boolean)).size;
    if (matching.length >= 3 && taskCount >= 2) {
      result.push({
        id: 'repeated-misconception',
        severity: 'important',
        title: 'Повторяется одна модель ошибки',
        reason: `${kind}: ${matching.length} наблюдений в ${taskCount} задачах за 7 дней.`,
        action: remediationVariant === 'variant-a'
          ? 'Сначала напиши минимальный counterexample, затем реши новую задачу без reference.'
          : 'Разбери counterexample и реши новую задачу без reference.',
        moduleId: matching.find(event => event.moduleId)?.moduleId,
        diagnosticKind: kind
      });
      break;
    }
  }
  const moduleAttempts = new Map<string, number>();
  const independent = new Set<string>();
  for (const event of sessionEvents) {
    if (!event.moduleId) continue;
    if (event.type === 'attempted') moduleAttempts.set(event.moduleId, (moduleAttempts.get(event.moduleId) || 0) + 1);
    if (event.type === 'independent_pass' || event.type === 'retention_checked') independent.add(event.moduleId);
  }
  const stalled = [...moduleAttempts].find(([moduleId, count]) => count >= 5 && !independent.has(moduleId));
  if (stalled) result.push({ id: 'stalled-module', severity: 'important', title: 'Модуль застрял', reason: `${stalled[1]} попыток без independent evidence.`, action: 'Вернись к foundation lesson и реши минимальный counterexample.', moduleId: stalled[0] });
  const debt = dueReviewCount(progress);
  if (debt.count >= 5 || debt.oldestDays >= 7) result.push({ id: 'review-debt', severity: 'notice', title: 'Накопился долг повторения', reason: `${debt.count} задач требуют проверки; самая старая ждёт ${Math.floor(debt.oldestDays)} дней.`, action: 'Собери 15-минутную review-сессию до нового материала.' });
  return result;
}

export function localLearningAnalyticsReport(state: LearningAnalyticsState, progress?: Progress): LocalLearningAnalyticsReport {
  const misconceptionCounts: Partial<Record<AttemptErrorKind, number>> = {};
  for (const event of state.events) if (event.type === 'diagnostic_observed' && event.diagnosticKind) misconceptionCounts[event.diagnosticKind] = (misconceptionCounts[event.diagnosticKind] || 0) + 1;
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
    timeToMastery: timeToMastery(state.events),
    interventions: interventions(state, progress)
  };
}

function sessionMinutes(events: LearningAnalyticsEvent[]) {
  const starts = new Map<string, number>();
  let milliseconds = 0;
  for (const event of events) {
    if (event.type === 'session_started') starts.set(event.sessionId, new Date(event.occurredAt).getTime());
    if (event.type === 'session_ended') {
      const start = starts.get(event.sessionId);
      if (start) milliseconds += Math.max(0, Math.min(4 * 3_600_000, new Date(event.occurredAt).getTime() - start));
    }
  }
  return Math.round(milliseconds / 60_000);
}

function minuteBucket(minutes: number): 0 | 5 | 15 | 30 | 60 {
  if (minutes < 5) return 0;
  if (minutes < 15) return 5;
  if (minutes < 30) return 15;
  if (minutes < 60) return 30;
  return 60;
}

function weekStart(date = new Date()) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

export function buildLearningAnalyticsSnapshot(state: LearningAnalyticsState, progress?: Progress): LearningAnalyticsSnapshot {
  const report = localLearningAnalyticsReport(state, progress);
  const rows: LearningAnalyticsSnapshotRow[] = [];
  for (const [moduleId] of modules) {
    const events = state.events.filter(event => event.moduleId === moduleId);
    if (!events.length) continue;
    const diagnosticCounts = new Map<AttemptErrorKind, number>();
    for (const event of events) if (event.type === 'diagnostic_observed' && event.diagnosticKind) diagnosticCounts.set(event.diagnosticKind, (diagnosticCounts.get(event.diagnosticKind) || 0) + 1);
    const topDiagnosticKind = [...diagnosticCounts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || null;
    const relevant = report.interventions.filter(item => !item.moduleId || item.moduleId === moduleId);
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
      studyMinutesBucket: minuteBucket(sessionMinutes(events)),
      overload: relevant.some(item => item.id === 'overload') ? 1 : 0,
      stalled: relevant.some(item => item.id === 'stalled-module') ? 1 : 0,
      reviewDebt: relevant.some(item => item.id === 'review-debt') ? 1 : 0,
      topDiagnosticKind
    });
  }
  return {
    version: 1,
    periodStart: weekStart(),
    courseVersion: 3,
    rows,
    mastery: { ...report.timeToMastery },
    experiments: { ...state.experimentVariants }
  };
}

function deterministicVariant(userId: string, experimentId: string): ExperimentVariant {
  let hash = 2166136261;
  for (const character of `${experimentId}:${userId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 === 0 ? 'control' : 'variant-a';
}

export function ensureExperimentVariant(experimentId: string, userId = loadAuthSession()?.userId) {
  if (!userId || !KNOWN_EXPERIMENTS.has(experimentId)) return null;
  const state = loadLearningAnalyticsState(userId) || emptyLearningAnalyticsState(userId);
  if (state.experimentVariants[experimentId]) return state.experimentVariants[experimentId];
  const variant = deterministicVariant(userId, experimentId);
  saveLearningAnalyticsState({ ...state, experimentVariants: { ...state.experimentVariants, [experimentId]: variant } });
  return variant;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

export async function updateLearningAnalyticsPreference(sharing: LearningAnalyticsSharing) {
  return responseJson<{ ok: true; sharing: LearningAnalyticsSharing }>(await fetch('/api/learning-analytics/preferences', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sharing })
  }));
}

export async function syncLearningAnalyticsSnapshot(progress?: Progress, userId = loadAuthSession()?.userId) {
  if (!userId) throw new Error('Сессия отсутствует');
  const state = loadLearningAnalyticsState(userId) || emptyLearningAnalyticsState(userId);
  if (state.sharing !== 'coarse-opt-in') return { skipped: true as const };
  return responseJson<{ ok: true; periodStart: string; rows: number }>(await fetch('/api/learning-analytics/snapshot', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: buildLearningAnalyticsSnapshot(state, progress) })
  }));
}

export async function loadCohortAnalyticsReport() {
  return responseJson<CohortAnalyticsReport>(await fetch('/api/learning-analytics/report'));
}

export async function deleteCloudLearningAnalytics() {
  return responseJson<{ ok: true }>(await fetch('/api/learning-analytics', { method: 'DELETE' }));
}

export async function exportCloudLearningAnalytics() {
  return responseJson<{ version: 1; sharing: LearningAnalyticsSharing; snapshots: LearningAnalyticsSnapshot[] }>(await fetch('/api/learning-analytics/export'));
}

export function exportLocalLearningAnalytics(state: LearningAnalyticsState) {
  return JSON.stringify({ version: 1, exportedAt: nowIso(), privacy: 'local-full-event-log', state }, null, 2);
}

export function taskForAnalyticsTitle(title: string) {
  return taskByTitle.get(title) || null;
}
