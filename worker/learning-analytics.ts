import {
  ANALYTICS_DIAGNOSTIC_KINDS,
  ANALYTICS_EXPERIMENT_IDS,
  ANALYTICS_LESSON_IDS,
  ANALYTICS_MODULE_IDS,
  ANALYTICS_TASK_IDS,
  ANALYTICS_VARIANTS,
  analyticsLessonForTaskId,
  type AnalyticsDiagnosticKind,
  type AnalyticsVariant
} from './learning-analytics-contract';

const MAX_BODY_BYTES = 72_000;
const MAX_ROWS = ANALYTICS_MODULE_IDS.length;
const MAX_ITEMS = ANALYTICS_TASK_IDS.length;
const MINIMUM_COHORT = 5;
const REPORT_WEEKS = 12;
const MODULE_IDS = new Set<string>(ANALYTICS_MODULE_IDS);
const TASK_IDS = new Set<string>(ANALYTICS_TASK_IDS);
const LESSON_IDS = new Set<string>(ANALYTICS_LESSON_IDS);
const DIAGNOSTIC_KINDS = new Set<string>(ANALYTICS_DIAGNOSTIC_KINDS);
const EXPERIMENT_IDS = new Set<string>(ANALYTICS_EXPERIMENT_IDS);
const VARIANTS = new Set<string>(ANALYTICS_VARIANTS);
const SNAPSHOT_V1_KEYS = new Set(['version', 'periodStart', 'courseVersion', 'rows', 'mastery', 'experiments']);
const SNAPSHOT_V2_KEYS = new Set(['version', 'periodStart', 'courseVersion', 'rows', 'items', 'mastery', 'experiments']);
const MASTERY_KEYS = new Set(['same-session', 'same-day', '2-7-days', '8-30-days', 'over-30-days']);
const ROW_V1_KEYS = new Set([
  'moduleId', 'opened', 'attempted', 'understood', 'independent', 'retained', 'lapses',
  'remediations', 'remediationSuccesses', 'studyMinutesBucket', 'overload', 'stalled',
  'reviewDebt', 'topDiagnosticKind'
]);
const ROW_V2_KEYS = new Set([
  ...ROW_V1_KEYS,
  'hintDependent', 'solutionDependent', 'placementChecks', 'placementMatches'
]);
const ITEM_KEYS = new Set([
  'taskId', 'lessonId', 'attempted', 'independent', 'hinted', 'solutionViewed',
  'misconceptions', 'remediations', 'remediationSuccesses', 'retained',
  'placementChecks', 'placementMatches'
]);

type Sharing = 'off' | 'coarse-opt-in';
type MasteryBuckets = Record<'same-session' | 'same-day' | '2-7-days' | '8-30-days' | 'over-30-days', number>;
type LegacySnapshotRow = {
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
  topDiagnosticKind: AnalyticsDiagnosticKind | null;
};
type SnapshotRow = LegacySnapshotRow & {
  hintDependent: number;
  solutionDependent: number;
  placementChecks: number;
  placementMatches: number;
};
type ItemRow = {
  taskId: string;
  lessonId: string;
  attempted: number;
  independent: number;
  hinted: 0 | 1;
  solutionViewed: 0 | 1;
  misconceptions: number;
  remediations: number;
  remediationSuccesses: number;
  retained: 0 | 1;
  placementChecks: number;
  placementMatches: number;
};
type Snapshot = {
  version: 1 | 2;
  periodStart: string;
  courseVersion: 3;
  rows: SnapshotRow[];
  items: ItemRow[];
  mastery: MasteryBuckets;
  experiments: Record<string, AnalyticsVariant>;
};
type StoredRow = { period_start: string; course_version: number; payload: string; updated_at: string };

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-learning-analytics-contract': 'learning-analytics-v1',
    ...headers
  }
});

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function bodyTooLarge(request: Request) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > MAX_BODY_BYTES;
}

async function readJson(request: Request) {
  try {
    return await request.json<unknown>();
  } catch {
    return null;
  }
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every(key => allowed.has(key)) && Object.keys(value).length === allowed.size;
}

function boundedInteger(value: unknown, maximum = 10_000) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
}

function validPeriod(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) return false;
  const age = Date.now() - date.getTime();
  return age >= -7 * 86_400_000 && age <= 180 * 86_400_000;
}

function validMastery(value: unknown): value is MasteryBuckets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const mastery = value as Record<string, unknown>;
  return exactKeys(mastery, MASTERY_KEYS) && [...MASTERY_KEYS].every(key => boundedInteger(mastery[key]));
}

function validLegacyRow(value: unknown): value is LegacySnapshotRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return exactKeys(row, ROW_V1_KEYS)
    && typeof row.moduleId === 'string'
    && MODULE_IDS.has(row.moduleId)
    && ['opened', 'attempted', 'understood', 'independent', 'retained', 'lapses', 'remediations', 'remediationSuccesses']
      .every(key => boundedInteger(row[key]))
    && [0, 5, 15, 30, 60].includes(Number(row.studyMinutesBucket))
    && (row.overload === 0 || row.overload === 1)
    && (row.stalled === 0 || row.stalled === 1)
    && (row.reviewDebt === 0 || row.reviewDebt === 1)
    && (row.topDiagnosticKind === null
      || (typeof row.topDiagnosticKind === 'string' && DIAGNOSTIC_KINDS.has(row.topDiagnosticKind)))
    && Number(row.attempted) <= Number(row.opened)
    && Number(row.understood) <= Number(row.attempted)
    && Number(row.independent) <= Number(row.understood)
    && Number(row.retained) <= Number(row.independent)
    && Number(row.remediationSuccesses) <= Number(row.remediations);
}

function validRow(value: unknown): value is SnapshotRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const legacy = Object.fromEntries([...ROW_V1_KEYS].map(key => [key, row[key]]));
  return exactKeys(row, ROW_V2_KEYS)
    && validLegacyRow(legacy)
    && ['hintDependent', 'solutionDependent', 'placementChecks', 'placementMatches'].every(key => boundedInteger(row[key]))
    && Number(row.hintDependent) <= Number(row.attempted)
    && Number(row.solutionDependent) <= Number(row.attempted)
    && Number(row.placementMatches) <= Number(row.placementChecks);
}

function validItem(value: unknown): value is ItemRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return exactKeys(row, ITEM_KEYS)
    && typeof row.taskId === 'string' && TASK_IDS.has(row.taskId)
    && typeof row.lessonId === 'string' && LESSON_IDS.has(row.lessonId)
    && analyticsLessonForTaskId(row.taskId) === row.lessonId
    && ['attempted', 'independent', 'misconceptions', 'remediations', 'remediationSuccesses', 'placementChecks', 'placementMatches']
      .every(key => boundedInteger(row[key]))
    && (row.hinted === 0 || row.hinted === 1)
    && (row.solutionViewed === 0 || row.solutionViewed === 1)
    && (row.retained === 0 || row.retained === 1)
    && Number(row.independent) <= Number(row.attempted)
    && Number(row.retained) <= Number(row.independent)
    && Number(row.remediationSuccesses) <= Number(row.remediations)
    && Number(row.placementMatches) <= Number(row.placementChecks);
}

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  const isV1 = snapshot.version === 1;
  const isV2 = snapshot.version === 2;
  if ((!isV1 && !isV2)
    || !exactKeys(snapshot, isV1 ? SNAPSHOT_V1_KEYS : SNAPSHOT_V2_KEYS)
    || snapshot.courseVersion !== 3
    || !validPeriod(snapshot.periodStart)
    || !Array.isArray(snapshot.rows)
    || snapshot.rows.length > MAX_ROWS
    || !snapshot.rows.every(isV1 ? validLegacyRow : validRow)
    || new Set(snapshot.rows.map(row => (row as LegacySnapshotRow).moduleId)).size !== snapshot.rows.length
    || (isV2 && (!Array.isArray(snapshot.items)
      || snapshot.items.length > MAX_ITEMS
      || !snapshot.items.every(validItem)
      || new Set(snapshot.items.map(row => (row as ItemRow).taskId)).size !== snapshot.items.length))
    || !validMastery(snapshot.mastery)
    || !snapshot.experiments
    || typeof snapshot.experiments !== 'object'
    || Array.isArray(snapshot.experiments)) return false;
  return Object.entries(snapshot.experiments as Record<string, unknown>)
    .every(([id, variant]) => EXPERIMENT_IDS.has(id) && VARIANTS.has(String(variant)));
}

function parseStored(row: StoredRow): Snapshot | null {
  try {
    const value = JSON.parse(row.payload) as unknown;
    if (!validSnapshot(value)
      || value.periodStart !== row.period_start
      || value.courseVersion !== row.course_version) return null;
    if (value.version === 2) return value;
    return {
      ...value,
      rows: value.rows.map(item => ({
        ...item,
        hintDependent: 0,
        solutionDependent: 0,
        placementChecks: 0,
        placementMatches: 0
      })),
      items: []
    };
  } catch {
    return null;
  }
}

async function preference(env: Cloudflare.Env, userId: string) {
  const row = await env.DB.prepare(`SELECT sharing, updated_at
    FROM learning_analytics_preferences WHERE user_id = ?`)
    .bind(userId).first<{ sharing: Sharing; updated_at: string }>();
  return row || { sharing: 'off' as const, updated_at: null };
}

async function readPreference(env: Cloudflare.Env, userId: string) {
  const current = await preference(env, userId);
  return json({ version: 1, sharing: current.sharing, updatedAt: current.updated_at });
}

async function writePreference(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request)) return json({ error: 'Learning analytics payload is too large' }, 413);
  const body = await readJson(request) as { sharing?: unknown } | null;
  if (!body || Object.keys(body).length !== 1 || !['off', 'coarse-opt-in'].includes(String(body.sharing))) {
    return json({ error: 'Invalid learning analytics preference' }, 400);
  }
  const sharing = body.sharing as Sharing;
  const updatedAt = sqliteTime();
  if (sharing === 'off') {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO learning_analytics_preferences(user_id, sharing, updated_at)
        VALUES(?, 'off', ?)
        ON CONFLICT(user_id) DO UPDATE SET sharing = 'off', updated_at = excluded.updated_at`)
        .bind(userId, updatedAt),
      env.DB.prepare('DELETE FROM learning_analytics_snapshots WHERE user_id = ?').bind(userId)
    ]);
  } else {
    await env.DB.prepare(`INSERT INTO learning_analytics_preferences(user_id, sharing, updated_at)
      VALUES(?, 'coarse-opt-in', ?)
      ON CONFLICT(user_id) DO UPDATE SET sharing = 'coarse-opt-in', updated_at = excluded.updated_at`)
      .bind(userId, updatedAt).run();
  }
  return json({ ok: true, version: 1, sharing, updatedAt });
}

async function writeSnapshot(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request)) return json({ error: 'Learning analytics payload is too large' }, 413);
  const body = await readJson(request) as { snapshot?: unknown } | null;
  if (!body || Object.keys(body).length !== 1 || !validSnapshot(body.snapshot)) {
    return json({ error: 'Invalid coarse learning analytics snapshot' }, 400);
  }
  const current = await preference(env, userId);
  if (current.sharing !== 'coarse-opt-in') return json({ error: 'Learning analytics sharing is disabled' }, 403);
  const serialized = JSON.stringify(body.snapshot);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'Learning analytics payload is too large' }, 413);
  }
  const updatedAt = sqliteTime();
  await env.DB.prepare(`INSERT INTO learning_analytics_snapshots(user_id, period_start, course_version, payload, updated_at)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(user_id, period_start) DO UPDATE SET
      course_version = excluded.course_version,
      payload = excluded.payload,
      updated_at = excluded.updated_at`)
    .bind(userId, body.snapshot.periodStart, body.snapshot.courseVersion, serialized, updatedAt).run();
  return json({
    ok: true,
    periodStart: body.snapshot.periodStart,
    rows: body.snapshot.rows.length,
    items: body.snapshot.items?.length || 0,
    updatedAt
  });
}

function reportCutoff() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - REPORT_WEEKS * 7);
  return date.toISOString().slice(0, 10);
}

function snapshotTotals(snapshot: Snapshot) {
  return snapshot.rows.reduce((totals, row) => ({
    attempted: totals.attempted + row.attempted,
    independent: totals.independent + row.independent,
    retained: totals.retained + row.retained,
    remediations: totals.remediations + row.remediations,
    remediationSuccesses: totals.remediationSuccesses + row.remediationSuccesses
  }), { attempted: 0, independent: 0, retained: 0, remediations: 0, remediationSuccesses: 0 });
}

async function cohortReport(env: Cloudflare.Env) {
  const result = await env.DB.prepare(`SELECT period_start, course_version, payload, updated_at
    FROM learning_analytics_snapshots WHERE period_start >= ?
    ORDER BY period_start DESC LIMIT 5000`).bind(reportCutoff()).all<StoredRow>();
  const groups = new Map<string, {
    periodStart: string;
    moduleId: string;
    contributors: number;
    opened: number;
    attempted: number;
    understood: number;
    independent: number;
    retained: number;
    lapses: number;
    remediations: number;
    remediationSuccesses: number;
    hintDependent: number;
    solutionDependent: number;
    placementChecks: number;
    placementMatches: number;
    studyMinutes: number;
    overload: number;
    stalled: number;
    reviewDebt: number;
    diagnostics: Map<AnalyticsDiagnosticKind, number>;
  }>();
  const itemGroups = new Map<string, {
    periodStart: string;
    taskId: string;
    lessonId: string;
    contributors: number;
    attempted: number;
    independent: number;
    hinted: number;
    solutionViewed: number;
    misconceptions: number;
    remediations: number;
    remediationSuccesses: number;
    retained: number;
    placementChecks: number;
    placementMatches: number;
  }>();
  const masteryGroups = new Map<string, { periodStart: string; contributors: number; mastery: MasteryBuckets }>();
  const experimentGroups = new Map<string, {
    periodStart: string;
    experimentId: string;
    variant: AnalyticsVariant;
    contributors: number;
    attempted: number;
    independent: number;
    retained: number;
    remediations: number;
    remediationSuccesses: number;
  }>();

  for (const stored of result.results || []) {
    const snapshot = parseStored(stored);
    if (!snapshot) continue;
    for (const row of snapshot.rows) {
      const key = `${snapshot.periodStart}:${row.moduleId}`;
      const group = groups.get(key) || {
        periodStart: snapshot.periodStart,
        moduleId: row.moduleId,
        contributors: 0,
        opened: 0,
        attempted: 0,
        understood: 0,
        independent: 0,
        retained: 0,
        lapses: 0,
        remediations: 0,
        remediationSuccesses: 0,
        hintDependent: 0,
        solutionDependent: 0,
        placementChecks: 0,
        placementMatches: 0,
        studyMinutes: 0,
        overload: 0,
        stalled: 0,
        reviewDebt: 0,
        diagnostics: new Map<AnalyticsDiagnosticKind, number>()
      };
      group.contributors += 1;
      group.opened += row.opened;
      group.attempted += row.attempted;
      group.understood += row.understood;
      group.independent += row.independent;
      group.retained += row.retained;
      group.lapses += row.lapses;
      group.remediations += row.remediations;
      group.remediationSuccesses += row.remediationSuccesses;
      group.hintDependent += row.hintDependent;
      group.solutionDependent += row.solutionDependent;
      group.placementChecks += row.placementChecks;
      group.placementMatches += row.placementMatches;
      group.studyMinutes += row.studyMinutesBucket;
      group.overload += row.overload;
      group.stalled += row.stalled;
      group.reviewDebt += row.reviewDebt;
      if (row.topDiagnosticKind) {
        group.diagnostics.set(row.topDiagnosticKind, (group.diagnostics.get(row.topDiagnosticKind) || 0) + 1);
      }
      groups.set(key, group);
    }

    for (const item of snapshot.items) {
      const key = `${snapshot.periodStart}:${item.taskId}`;
      const group = itemGroups.get(key) || {
        periodStart: snapshot.periodStart,
        taskId: item.taskId,
        lessonId: item.lessonId,
        contributors: 0,
        attempted: 0,
        independent: 0,
        hinted: 0,
        solutionViewed: 0,
        misconceptions: 0,
        remediations: 0,
        remediationSuccesses: 0,
        retained: 0,
        placementChecks: 0,
        placementMatches: 0
      };
      group.contributors += 1;
      group.attempted += item.attempted;
      group.independent += item.independent;
      group.hinted += item.hinted;
      group.solutionViewed += item.solutionViewed;
      group.misconceptions += item.misconceptions;
      group.remediations += item.remediations;
      group.remediationSuccesses += item.remediationSuccesses;
      group.retained += item.retained;
      group.placementChecks += item.placementChecks;
      group.placementMatches += item.placementMatches;
      itemGroups.set(key, group);
    }

    const mastery = masteryGroups.get(snapshot.periodStart) || {
      periodStart: snapshot.periodStart,
      contributors: 0,
      mastery: { 'same-session': 0, 'same-day': 0, '2-7-days': 0, '8-30-days': 0, 'over-30-days': 0 }
    };
    mastery.contributors += 1;
    for (const key of MASTERY_KEYS) mastery.mastery[key as keyof MasteryBuckets] += snapshot.mastery[key as keyof MasteryBuckets];
    masteryGroups.set(snapshot.periodStart, mastery);

    const totals = snapshotTotals(snapshot);
    for (const [experimentId, variant] of Object.entries(snapshot.experiments)) {
      const key = `${snapshot.periodStart}:${experimentId}:${variant}`;
      const experiment = experimentGroups.get(key) || {
        periodStart: snapshot.periodStart,
        experimentId,
        variant,
        contributors: 0,
        attempted: 0,
        independent: 0,
        retained: 0,
        remediations: 0,
        remediationSuccesses: 0
      };
      experiment.contributors += 1;
      experiment.attempted += totals.attempted;
      experiment.independent += totals.independent;
      experiment.retained += totals.retained;
      experiment.remediations += totals.remediations;
      experiment.remediationSuccesses += totals.remediationSuccesses;
      experimentGroups.set(key, experiment);
    }
  }

  let suppressedRows = 0;
  const rows = [...groups.values()].flatMap(group => {
    if (group.contributors < MINIMUM_COHORT) {
      suppressedRows += 1;
      return [];
    }
    const topDiagnosticKind = [...group.diagnostics]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || null;
    return [{
      periodStart: group.periodStart,
      moduleId: group.moduleId,
      contributors: group.contributors,
      suppressed: false as const,
      opened: group.opened,
      attempted: group.attempted,
      understood: group.understood,
      independent: group.independent,
      retained: group.retained,
      lapses: group.lapses,
      remediations: group.remediations,
      remediationSuccesses: group.remediationSuccesses,
      hintDependent: group.hintDependent,
      solutionDependent: group.solutionDependent,
      placementChecks: group.placementChecks,
      placementMatches: group.placementMatches,
      studyMinutesAverage: Math.round(group.studyMinutes / group.contributors),
      overload: group.overload,
      stalled: group.stalled,
      reviewDebt: group.reviewDebt,
      topDiagnosticKind
    }];
  }).sort((left, right) => right.periodStart.localeCompare(left.periodStart) || left.moduleId.localeCompare(right.moduleId));

  let suppressedItems = 0;
  const items = [...itemGroups.values()].flatMap(group => {
    if (group.contributors < MINIMUM_COHORT) {
      suppressedItems += 1;
      return [];
    }
    return [{ ...group, suppressed: false as const }];
  }).sort((left, right) => right.periodStart.localeCompare(left.periodStart) || left.lessonId.localeCompare(right.lessonId) || left.taskId.localeCompare(right.taskId));

  let suppressedMasteryPeriods = 0;
  const mastery = [...masteryGroups.values()].flatMap(group => {
    if (group.contributors < MINIMUM_COHORT) {
      suppressedMasteryPeriods += 1;
      return [];
    }
    return [{ periodStart: group.periodStart, contributors: group.contributors, suppressed: false as const, ...group.mastery }];
  }).sort((left, right) => right.periodStart.localeCompare(left.periodStart));

  let suppressedExperiments = 0;
  const experiments = [...experimentGroups.values()].flatMap(group => {
    if (group.contributors < MINIMUM_COHORT) {
      suppressedExperiments += 1;
      return [];
    }
    return [{ ...group, suppressed: false as const }];
  }).sort((left, right) => right.periodStart.localeCompare(left.periodStart)
    || left.experimentId.localeCompare(right.experimentId)
    || left.variant.localeCompare(right.variant));

  return json({
    version: 2,
    minimumCohort: MINIMUM_COHORT,
    generatedAt: new Date().toISOString(),
    rows,
    items,
    mastery,
    experiments,
    suppressedRows,
    suppressedItems,
    suppressedMasteryPeriods,
    suppressedExperiments
  });
}

async function exportAnalytics(env: Cloudflare.Env, userId: string) {
  const current = await preference(env, userId);
  const result = await env.DB.prepare(`SELECT period_start, course_version, payload, updated_at
    FROM learning_analytics_snapshots WHERE user_id = ? ORDER BY period_start`)
    .bind(userId).all<StoredRow>();
  const snapshots = (result.results || []).map(parseStored).filter((item): item is Snapshot => Boolean(item));
  return json({ version: 2, sharing: current.sharing, snapshots });
}

async function deleteAnalytics(env: Cloudflare.Env, userId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM learning_analytics_snapshots WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM learning_analytics_preferences WHERE user_id = ?').bind(userId)
  ]);
  return json({ ok: true });
}

export async function handleLearningAnalyticsRequest(
  request: Request,
  env: Cloudflare.Env,
  userId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/learning-analytics')) return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (url.pathname === '/api/learning-analytics/preferences') {
    if (request.method === 'GET') return readPreference(env, userId);
    if (request.method === 'PUT') return writePreference(request, env, userId);
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PUT' });
  }
  if (url.pathname === '/api/learning-analytics/snapshot') {
    if (request.method === 'PUT') return writeSnapshot(request, env, userId);
    return json({ error: 'Method not allowed' }, 405, { allow: 'PUT' });
  }
  if (url.pathname === '/api/learning-analytics/report') {
    if (request.method === 'GET') return cohortReport(env);
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  }
  if (url.pathname === '/api/learning-analytics/export') {
    if (request.method === 'GET') return exportAnalytics(env, userId);
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  }
  if (url.pathname === '/api/learning-analytics') {
    if (request.method === 'DELETE') return deleteAnalytics(env, userId);
    return json({ error: 'Method not allowed' }, 405, { allow: 'DELETE' });
  }
  return json({ error: 'Not found' }, 404);
}
