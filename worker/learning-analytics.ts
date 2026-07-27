import { modules } from '../src/data/course-catalog';
import type { AttemptErrorKind } from '../src/lib/attempt-diagnostics';

const MAX_BODY_BYTES = 72_000;
const MAX_ROWS = modules.length;
const MINIMUM_COHORT = 5;
const REPORT_WEEKS = 12;
const MODULE_IDS = new Set(modules.map(([id]) => id));
const DIAGNOSTIC_KINDS = new Set<AttemptErrorKind>([
  'syntax', 'schema', 'runtime', 'result-shape', 'row-set', 'ordering', 'values',
  'null-filter', 'aggregation', 'join-cardinality'
]);
const EXPERIMENT_IDS = new Set(['remediation-copy-v1']);
const VARIANTS = new Set(['control', 'variant-a', 'variant-b']);

type Sharing = 'off' | 'coarse-opt-in';

type SnapshotRow = {
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

type Snapshot = {
  version: 1;
  periodStart: string;
  courseVersion: 3;
  rows: SnapshotRow[];
  experiments: Record<string, 'control' | 'variant-a' | 'variant-b'>;
};

type StoredSnapshotRow = {
  period_start: string;
  course_version: number;
  payload: string;
  updated_at: string;
};

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

function bodyTooLarge(request: Request) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > MAX_BODY_BYTES;
}

async function readJson(request: Request) {
  try { return await request.json<unknown>(); } catch { return null; }
}

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
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

function validSnapshotRow(value: unknown): value is SnapshotRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.moduleId === 'string'
    && MODULE_IDS.has(row.moduleId)
    && ['opened', 'attempted', 'understood', 'independent', 'retained', 'lapses', 'remediations', 'remediationSuccesses']
      .every(key => boundedInteger(row[key]))
    && [0, 5, 15, 30, 60].includes(Number(row.studyMinutesBucket))
    && (row.overload === 0 || row.overload === 1)
    && (row.stalled === 0 || row.stalled === 1)
    && (row.reviewDebt === 0 || row.reviewDebt === 1)
    && (row.topDiagnosticKind === null || (typeof row.topDiagnosticKind === 'string' && DIAGNOSTIC_KINDS.has(row.topDiagnosticKind as AttemptErrorKind)))
    && Number(row.attempted) <= Number(row.opened)
    && Number(row.understood) <= Number(row.attempted)
    && Number(row.independent) <= Number(row.understood)
    && Number(row.retained) <= Number(row.independent)
    && Number(row.remediationSuccesses) <= Number(row.remediations);
}

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 1 || snapshot.courseVersion !== 3 || !validPeriod(snapshot.periodStart) || !Array.isArray(snapshot.rows)) return false;
  if (snapshot.rows.length > MAX_ROWS || !snapshot.rows.every(validSnapshotRow)) return false;
  if (new Set(snapshot.rows.map(row => (row as SnapshotRow).moduleId)).size !== snapshot.rows.length) return false;
  if (!snapshot.experiments || typeof snapshot.experiments !== 'object' || Array.isArray(snapshot.experiments)) return false;
  return Object.entries(snapshot.experiments as Record<string, unknown>).every(([id, variant]) => EXPERIMENT_IDS.has(id) && VARIANTS.has(String(variant)));
}

function parseStoredSnapshot(row: StoredSnapshotRow): Snapshot | null {
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    return validSnapshot(parsed) && parsed.periodStart === row.period_start && parsed.courseVersion === row.course_version ? parsed : null;
  } catch {
    return null;
  }
}

async function preference(env: Cloudflare.Env, userId: string) {
  const row = await env.DB.prepare(`SELECT sharing, updated_at
    FROM learning_analytics_preferences WHERE user_id = ?`)
    .bind(userId)
    .first<{ sharing: Sharing; updated_at: string }>();
  return row || { sharing: 'off' as const, updated_at: null };
}

async function readPreference(env: Cloudflare.Env, userId: string) {
  const current = await preference(env, userId);
  return json({ version: 1, sharing: current.sharing, updatedAt: current.updated_at });
}

async function writePreference(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request)) return json({ error: 'Learning analytics payload is too large' }, 413);
  const body = await readJson(request) as { sharing?: unknown } | null;
  if (!body || !['off', 'coarse-opt-in'].includes(String(body.sharing))) return json({ error: 'Invalid learning analytics preference' }, 400);
  const sharing = body.sharing as Sharing;
  const updatedAt = sqliteTime();
  if (sharing === 'off') {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO learning_analytics_preferences(user_id, sharing, updated_at)
        VALUES(?, 'off', ?)
        ON CONFLICT(user_id) DO UPDATE SET sharing = 'off', updated_at = excluded.updated_at`).bind(userId, updatedAt),
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
  if (!body || !validSnapshot(body.snapshot)) return json({ error: 'Invalid coarse learning analytics snapshot' }, 400);
  const current = await preference(env, userId);
  if (current.sharing !== 'coarse-opt-in') return json({ error: 'Learning analytics sharing is disabled' }, 403);
  const serialized = JSON.stringify(body.snapshot);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BODY_BYTES) return json({ error: 'Learning analytics payload is too large' }, 413);
  const updatedAt = sqliteTime();
  await env.DB.prepare(`INSERT INTO learning_analytics_snapshots(user_id, period_start, course_version, payload, updated_at)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(user_id, period_start) DO UPDATE SET
      course_version = excluded.course_version,
      payload = excluded.payload,
      updated_at = excluded.updated_at`)
    .bind(userId, body.snapshot.periodStart, body.snapshot.courseVersion, serialized, updatedAt).run();
  return json({ ok: true, periodStart: body.snapshot.periodStart, rows: body.snapshot.rows.length, updatedAt });
}

function reportCutoff() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - REPORT_WEEKS * 7);
  return date.toISOString().slice(0, 10);
}

async function cohortReport(env: Cloudflare.Env) {
  const result = await env.DB.prepare(`SELECT period_start, course_version, payload, updated_at
    FROM learning_analytics_snapshots
    WHERE period_start >= ?
    ORDER BY period_start DESC
    LIMIT 5000`).bind(reportCutoff()).all<StoredSnapshotRow>();
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
    studyMinutesBucket: number;
    overload: number;
    stalled: number;
    reviewDebt: number;
    diagnostics: Map<AttemptErrorKind, number>;
  }>();
  for (const stored of result.results || []) {
    const snapshot = parseStoredSnapshot(stored);
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
        studyMinutesBucket: 0,
        overload: 0,
        stalled: 0,
        reviewDebt: 0,
        diagnostics: new Map<AttemptErrorKind, number>()
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
      group.studyMinutesBucket += row.studyMinutesBucket;
      group.overload += row.overload;
      group.stalled += row.stalled;
      group.reviewDebt += row.reviewDebt;
      if (row.topDiagnosticKind) group.diagnostics.set(row.topDiagnosticKind, (group.diagnostics.get(row.topDiagnosticKind) || 0) + 1);
      groups.set(key, group);
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
      studyMinutesBucket: Math.round(group.studyMinutesBucket / group.contributors),
      overload: group.overload,
      stalled: group.stalled,
      reviewDebt: group.reviewDebt,
      topDiagnosticKind
    }];
  }).sort((left, right) => right.periodStart.localeCompare(left.periodStart) || left.moduleId.localeCompare(right.moduleId));

  return json({
    version: 1,
    minimumCohort: MINIMUM_COHORT,
    generatedAt: new Date().toISOString(),
    rows,
    suppressedRows
  });
}

async function exportAnalytics(env: Cloudflare.Env, userId: string) {
  const current = await preference(env, userId);
  const result = await env.DB.prepare(`SELECT period_start, course_version, payload, updated_at
    FROM learning_analytics_snapshots WHERE user_id = ? ORDER BY period_start`)
    .bind(userId).all<StoredSnapshotRow>();
  const snapshots = (result.results || []).map(parseStoredSnapshot).filter((item): item is Snapshot => Boolean(item));
  return json({ version: 1, sharing: current.sharing, snapshots });
}

async function deleteAnalytics(env: Cloudflare.Env, userId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM learning_analytics_snapshots WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM learning_analytics_preferences WHERE user_id = ?').bind(userId)
  ]);
  return json({ ok: true });
}

export async function handleLearningAnalyticsRequest(request: Request, env: Cloudflare.Env, userId: string): Promise<Response | null> {
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
