export type CounterErrorKind =
  | 'syntax'
  | 'schema'
  | 'runtime'
  | 'result-shape'
  | 'row-set'
  | 'ordering'
  | 'values'
  | 'null-filter'
  | 'aggregation'
  | 'join-cardinality';

export const PROGRESS_REPLICA_STORAGE_KEY = 'sql-academy-progress-replica-v1';
export const MAX_TASK_COUNTER_REPLICAS = 32;

const COUNTER_MAX = 10_000;
const REPLICA_ID_PATTERN = /^(?:legacy|replica-[a-z0-9_-]{8,48})$/;
const COUNTER_FIELDS = [
  'attempts',
  'incorrect',
  'hintsUsed',
  'solutionViews',
  'assistedPasses',
  'retrievalSuccesses',
  'retrievalLapses',
  'independentPasses'
] as const;
const ERROR_KINDS: CounterErrorKind[] = [
  'syntax',
  'schema',
  'runtime',
  'result-shape',
  'row-set',
  'ordering',
  'values',
  'null-filter',
  'aggregation',
  'join-cardinality'
];

export type TaskCounterField = typeof COUNTER_FIELDS[number];
export type TaskCounterComponent = Partial<Record<TaskCounterField, number>> & {
  errorKinds?: Partial<Record<CounterErrorKind, number>>;
};
export type TaskCounterComponents = Record<string, TaskCounterComponent>;

export type CounterBackedTaskStats = {
  attempts: number;
  incorrect: number;
  hintsUsed: number;
  solutionViews?: number;
  assistedPasses?: number;
  retrievalSuccesses?: number;
  retrievalLapses?: number;
  independentPasses?: number;
  errorKinds?: Partial<Record<CounterErrorKind, number>>;
  counterComponents?: TaskCounterComponents;
};

let runtimeReplicaId: string | undefined;

function safeCounter(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function randomReplicaId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return `replica-${cryptoApi.randomUUID().replaceAll('-', '')}`;
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return `replica-${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return 'replica-runtime-local';
}

export function getProgressReplicaId() {
  if (runtimeReplicaId) return runtimeReplicaId;
  try {
    const storage = (globalThis as unknown as {
      localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
    }).localStorage;
    const stored = storage?.getItem(PROGRESS_REPLICA_STORAGE_KEY);
    if (stored && REPLICA_ID_PATTERN.test(stored)) return (runtimeReplicaId = stored);
    const created = randomReplicaId();
    storage?.setItem(PROGRESS_REPLICA_STORAGE_KEY, created);
    return (runtimeReplicaId = created);
  } catch {
    return (runtimeReplicaId = randomReplicaId());
  }
}

function cleanErrorKinds(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = ERROR_KINDS
    .map(kind => [kind, safeCounter((value as Partial<Record<CounterErrorKind, number>>)[kind])] as const)
    .filter(([, count]) => count > 0);
  return entries.length ? Object.fromEntries(entries) as Partial<Record<CounterErrorKind, number>> : undefined;
}

function cleanComponent(value: unknown): TaskCounterComponent {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as TaskCounterComponent
    : {};
  const component: TaskCounterComponent = {};
  for (const field of COUNTER_FIELDS) {
    const count = safeCounter(source[field]);
    if (count > 0 || field === 'attempts' || field === 'incorrect' || field === 'hintsUsed') component[field] = count;
  }
  const errorKinds = cleanErrorKinds(source.errorKinds);
  if (errorKinds) component.errorKinds = errorKinds;
  return component;
}

function sumComponents(components: TaskCounterComponents) {
  const totals: CounterBackedTaskStats = { attempts: 0, incorrect: 0, hintsUsed: 0 };
  const errorKinds: Partial<Record<CounterErrorKind, number>> = {};
  for (const component of Object.values(components)) {
    for (const field of COUNTER_FIELDS) {
      const next = (totals[field] || 0) + safeCounter(component[field]);
      if (next > 0 || field === 'attempts' || field === 'incorrect' || field === 'hintsUsed') totals[field] = next;
    }
    for (const kind of ERROR_KINDS) {
      const next = (errorKinds[kind] || 0) + safeCounter(component.errorKinds?.[kind]);
      if (next > 0) errorKinds[kind] = next;
    }
  }
  if (Object.keys(errorKinds).length) totals.errorKinds = errorKinds;
  return totals;
}

function orderedComponents(components: TaskCounterComponents) {
  return Object.fromEntries(Object.entries(components).sort(([left], [right]) => left.localeCompare(right)));
}

export function normalizeTaskCounterStats(stats: CounterBackedTaskStats): CounterBackedTaskStats {
  const components: TaskCounterComponents = {};
  if (stats.counterComponents && typeof stats.counterComponents === 'object' && !Array.isArray(stats.counterComponents)) {
    for (const [replicaId, component] of Object.entries(stats.counterComponents)) {
      if (REPLICA_ID_PATTERN.test(replicaId)) components[replicaId] = cleanComponent(component);
    }
  }

  const current = sumComponents(components);
  const legacy = cleanComponent(components.legacy);
  let needsLegacy = !Object.keys(components).length;
  for (const field of COUNTER_FIELDS) {
    const residual = Math.max(0, safeCounter(stats[field]) - safeCounter(current[field]));
    if (residual > 0) {
      legacy[field] = safeCounter(legacy[field]) + residual;
      needsLegacy = true;
    }
  }
  for (const kind of ERROR_KINDS) {
    const residual = Math.max(0, safeCounter(stats.errorKinds?.[kind]) - safeCounter(current.errorKinds?.[kind]));
    if (residual > 0) {
      legacy.errorKinds = { ...(legacy.errorKinds || {}), [kind]: safeCounter(legacy.errorKinds?.[kind]) + residual };
      needsLegacy = true;
    }
  }
  if (needsLegacy) components.legacy = legacy;

  const ordered = orderedComponents(components);
  return { ...sumComponents(ordered), counterComponents: ordered };
}

export function incrementTaskCounterStats(
  stats: CounterBackedTaskStats,
  delta: TaskCounterComponent,
  replicaId = getProgressReplicaId()
): CounterBackedTaskStats {
  const normalized = normalizeTaskCounterStats(stats);
  const components = { ...normalized.counterComponents } as TaskCounterComponents;
  const targetReplicaId = REPLICA_ID_PATTERN.test(replicaId) ? replicaId : getProgressReplicaId();
  if (!components[targetReplicaId] && Object.keys(components).length >= MAX_TASK_COUNTER_REPLICAS) {
    throw new Error('Достигнут безопасный лимит устройств для синхронизации этой задачи.');
  }
  const previous = cleanComponent(components[targetReplicaId]);
  const next = { ...previous };
  for (const field of COUNTER_FIELDS) {
    const increase = safeCounter(delta[field]);
    if (increase > 0) next[field] = safeCounter(previous[field]) + increase;
  }
  const errorDelta = cleanErrorKinds(delta.errorKinds);
  if (errorDelta) {
    next.errorKinds = { ...(previous.errorKinds || {}) };
    for (const kind of ERROR_KINDS) {
      if (errorDelta[kind]) next.errorKinds[kind] = safeCounter(previous.errorKinds?.[kind]) + errorDelta[kind]!;
    }
  }
  components[targetReplicaId] = next;
  const ordered = orderedComponents(components);
  return { ...sumComponents(ordered), counterComponents: ordered };
}

export function mergeTaskCounterStats(left: CounterBackedTaskStats, right: CounterBackedTaskStats) {
  const leftComponents = normalizeTaskCounterStats(left).counterComponents!;
  const rightComponents = normalizeTaskCounterStats(right).counterComponents!;
  const components: TaskCounterComponents = {};
  for (const replicaId of new Set([...Object.keys(leftComponents), ...Object.keys(rightComponents)])) {
    const leftComponent = cleanComponent(leftComponents[replicaId]);
    const rightComponent = cleanComponent(rightComponents[replicaId]);
    const merged: TaskCounterComponent = {};
    for (const field of COUNTER_FIELDS) {
      const count = Math.max(safeCounter(leftComponent[field]), safeCounter(rightComponent[field]));
      if (count > 0 || field === 'attempts' || field === 'incorrect' || field === 'hintsUsed') merged[field] = count;
    }
    const errorKinds: Partial<Record<CounterErrorKind, number>> = {};
    for (const kind of ERROR_KINDS) {
      const count = Math.max(safeCounter(leftComponent.errorKinds?.[kind]), safeCounter(rightComponent.errorKinds?.[kind]));
      if (count > 0) errorKinds[kind] = count;
    }
    if (Object.keys(errorKinds).length) merged.errorKinds = errorKinds;
    components[replicaId] = merged;
  }
  const ordered = orderedComponents(components);
  return { ...sumComponents(ordered), counterComponents: ordered };
}

function boundedInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= COUNTER_MAX;
}

export function validTaskCounterComponents(stats: Partial<CounterBackedTaskStats>) {
  const value = stats.counterComponents;
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > MAX_TASK_COUNTER_REPLICAS) return false;
  for (const [replicaId, component] of entries) {
    if (!REPLICA_ID_PATTERN.test(replicaId) || !component || typeof component !== 'object' || Array.isArray(component)) return false;
    const keys = Object.keys(component);
    if (!keys.length || keys.some(key => !COUNTER_FIELDS.includes(key as TaskCounterField) && key !== 'errorKinds')) return false;
    if (COUNTER_FIELDS.some(field => component[field] !== undefined && !boundedInteger(component[field]))) return false;
    if (component.errorKinds !== undefined) {
      if (!component.errorKinds || typeof component.errorKinds !== 'object' || Array.isArray(component.errorKinds)) return false;
      if (Object.entries(component.errorKinds).some(([kind, count]) => !ERROR_KINDS.includes(kind as CounterErrorKind) || !boundedInteger(count))) return false;
    }
  }
  const totals = sumComponents(value);
  if (COUNTER_FIELDS.some(field => safeCounter(stats[field]) !== safeCounter(totals[field]) || safeCounter(totals[field]) > COUNTER_MAX)) return false;
  return ERROR_KINDS.every(kind => safeCounter(stats.errorKinds?.[kind]) === safeCounter(totals.errorKinds?.[kind]));
}

export function preservesTaskCounterComponents(
  previous: Partial<CounterBackedTaskStats>,
  next: Partial<CounterBackedTaskStats>
) {
  const previousComponents = previous.counterComponents;
  if (previousComponents === undefined) return true;
  const nextComponents = next.counterComponents;
  if (!nextComponents || typeof nextComponents !== 'object' || Array.isArray(nextComponents)) return false;
  return Object.entries(previousComponents).every(([replicaId, previousComponent]) => {
    const nextComponent = nextComponents[replicaId];
    if (!nextComponent) return false;
    const fieldsPreserved = COUNTER_FIELDS.every(field => safeCounter(nextComponent[field]) >= safeCounter(previousComponent[field]));
    const errorsPreserved = ERROR_KINDS.every(kind => safeCounter(nextComponent.errorKinds?.[kind]) >= safeCounter(previousComponent.errorKinds?.[kind]));
    return fieldsPreserved && errorsPreserved;
  });
}
