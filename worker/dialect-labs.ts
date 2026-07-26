import { dialectLabCase } from '../src/data/dialect-lab-cases';
import { dialectLabManifest, dialectLabManifests, type SqlDialect } from '../src/data/dialect-lab-manifests';
import { evaluateDialectCaseSql, validateDialectSqlPolicy } from '../src/lib/dialect-lab-policy';

const MAX_PROGRESS_BYTES = 96_000;
const MAX_EXECUTION_BYTES = 28_000;
const MAX_EVIDENCE = 18;
const HOURLY_EXECUTION_LIMIT = 120;
const DIGEST_PATTERN = /^fnv1a-[a-f0-9]{8}$/;

type StoredProgress = {
  version: 1;
  userId: string;
  revision: number;
  evidence: Record<string, Record<string, unknown>>;
  updatedAt: string;
};

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-dialect-lab-contract': 'dialect-labs-v1',
    ...headers
  }
});

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function readJson(request: Request) {
  try { return await request.json<unknown>(); } catch { return null; }
}

function bodyTooLarge(request: Request, maximum: number) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > maximum;
}

function boundedString(value: unknown, maximum: number) {
  return typeof value === 'string' && value.length <= maximum;
}

function digest(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function expectedPublishedDigest(labId: string, dialect: SqlDialect, executionMode: string) {
  const labCase = dialectLabCase(labId, dialect);
  if (!labCase) return null;
  const output = {
    columns: [...labCase.expected.columns],
    rows: labCase.expected.rows.map(row => [...row])
  };
  const serialized = JSON.stringify(output);
  if (executionMode === 'remote-sandbox') return digest(`${labId}:${dialect}:${serialized}:true:dialect-sandbox-v1`);
  if (executionMode === 'deterministic-simulation') return digest(`${labId}:${dialect}:${serialized}:true`);
  return null;
}

function validEvidence(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const lab = dialectLabManifests.find(candidate => candidate.id === item.labId);
  const dialect = item.dialect as SqlDialect;
  if (!lab || !['sqlite', 'postgresql', 'mysql'].includes(String(dialect))) return false;
  const behavior = lab.behaviors.find(candidate => candidate.dialect === dialect);
  if (!behavior || item.executionMode !== behavior.executionMode) return false;
  if (key !== `${item.labId}:${dialect}`
    || item.version !== 1
    || item.manifestVersion !== 1
    || typeof item.passed !== 'boolean'
    || typeof item.evidenceEligible !== 'boolean'
    || typeof item.independent !== 'boolean'
    || typeof item.attempts !== 'number'
    || !Number.isInteger(item.attempts)
    || item.attempts < 0
    || item.attempts > 10_000
    || !(item.bestDurationMs === null || (typeof item.bestDurationMs === 'number' && Number.isInteger(item.bestDurationMs) && item.bestDurationMs >= 1 && item.bestDurationMs <= 60_000))
    || !(item.resultDigest === null || (typeof item.resultDigest === 'string' && DIGEST_PATTERN.test(item.resultDigest)))
    || !(item.completedAt === null || boundedString(item.completedAt, 64))
    || !boundedString(item.lastAttemptAt, 64)) return false;

  if (item.passed === true) {
    if (item.evidenceEligible !== true || item.independent !== true || item.completedAt === null || typeof item.resultDigest !== 'string') return false;
    const publishedDigest = expectedPublishedDigest(String(item.labId), dialect, behavior.executionMode);
    if (publishedDigest && item.resultDigest !== publishedDigest) return false;
  }
  if (item.independent === true && item.passed !== true) return false;
  return true;
}

function validProgress(value: unknown, userId: string): value is StoredProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const progress = value as Record<string, unknown>;
  if (progress.version !== 1
    || progress.userId !== userId
    || typeof progress.revision !== 'number'
    || !Number.isInteger(progress.revision)
    || progress.revision < 0
    || progress.revision > 1_000_000
    || !boundedString(progress.updatedAt, 64)
    || !progress.evidence
    || typeof progress.evidence !== 'object'
    || Array.isArray(progress.evidence)) return false;
  const entries = Object.entries(progress.evidence as Record<string, unknown>);
  return entries.length <= MAX_EVIDENCE && entries.every(([key, evidence]) => validEvidence(evidence, key));
}

function parseStoredProgress(payload: string, userId: string) {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return validProgress(parsed, userId) ? parsed : null;
  } catch {
    return null;
  }
}

function monotonicEvidence(previous: Record<string, unknown>, next: Record<string, unknown>) {
  if (Number(next.attempts) < Number(previous.attempts)) return false;
  if (previous.passed === true) {
    if (next.passed !== true || next.independent !== true || next.evidenceEligible !== true) return false;
    if (next.resultDigest !== previous.resultDigest || next.completedAt !== previous.completedAt) return false;
  }
  if (previous.independent === true && next.independent !== true) return false;
  if (previous.evidenceEligible === true && next.evidenceEligible !== true) return false;
  if (typeof previous.bestDurationMs === 'number') {
    if (typeof next.bestDurationMs !== 'number' || Number(next.bestDurationMs) > previous.bestDurationMs) return false;
  }
  return true;
}

function monotonicProgress(previous: StoredProgress | null, next: StoredProgress) {
  if (!previous) return true;
  for (const [key, evidence] of Object.entries(previous.evidence)) {
    const candidate = next.evidence[key];
    if (!candidate || !monotonicEvidence(evidence, candidate)) return false;
  }
  return true;
}

async function consumeExecutionQuota(env: Cloudflare.Env, userId: string) {
  if (!env.SETTINGS) return { allowed: true, remaining: null as number | null };
  const hour = new Date().toISOString().slice(0, 13);
  const key = `dialect-labs:execute:${hour}:${userId}`;
  const current = Math.max(0, Number(await env.SETTINGS.get(key)) || 0);
  if (current >= HOURLY_EXECUTION_LIMIT) return { allowed: false, remaining: 0 };
  await env.SETTINGS.put(key, String(current + 1), { expirationTtl: 7_200 });
  return { allowed: true, remaining: HOURLY_EXECUTION_LIMIT - current - 1 };
}

async function currentProgress(env: Cloudflare.Env, userId: string) {
  const row = await env.DB.prepare(`SELECT payload, revision, updated_at
    FROM dialect_lab_progress WHERE user_id = ?`)
    .bind(userId)
    .first<{ payload: string; revision: number; updated_at: string }>();
  if (!row) return { progress: null as StoredProgress | null, revision: 0, updatedAt: null as string | null };
  const progress = parseStoredProgress(row.payload, userId);
  if (!progress) throw new Error('Stored dialect progress is invalid');
  return { progress, revision: row.revision, updatedAt: row.updated_at };
}

async function readProgress(env: Cloudflare.Env, userId: string) {
  const current = await currentProgress(env, userId);
  return json(current);
}

async function writeProgress(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request, MAX_PROGRESS_BYTES)) return json({ error: 'Dialect progress payload is too large' }, 413);
  const body = await readJson(request) as { progress?: unknown; baseRevision?: unknown } | null;
  if (!body
    || !validProgress(body.progress, userId)
    || typeof body.baseRevision !== 'number'
    || !Number.isInteger(body.baseRevision)
    || body.baseRevision < 0
    || body.baseRevision > 1_000_000) return json({ error: 'Invalid dialect progress payload' }, 400);

  const current = await currentProgress(env, userId);
  if (body.baseRevision !== current.revision) {
    return json({ error: 'Dialect progress conflict', ...current }, 409);
  }
  if (!monotonicProgress(current.progress, body.progress)) {
    return json({ error: 'Dialect progress cannot regress or mutate verified evidence' }, 400);
  }

  const nextRevision = current.revision + 1;
  const progress: StoredProgress = { ...body.progress, revision: nextRevision, updatedAt: new Date().toISOString() };
  const serialized = JSON.stringify(progress);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROGRESS_BYTES) return json({ error: 'Dialect progress payload is too large' }, 413);
  const updatedAt = sqliteTime();

  if (!current.progress) {
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO dialect_lab_progress(user_id, payload, revision, updated_at)
      VALUES(?, ?, 1, ?)`).bind(userId, serialized, updatedAt).run();
    if ((inserted.meta.changes || 0) !== 1) {
      return json({ error: 'Dialect progress conflict', ...(await currentProgress(env, userId)) }, 409);
    }
  } else {
    const updated = await env.DB.prepare(`UPDATE dialect_lab_progress
      SET payload = ?, revision = ?, updated_at = ?
      WHERE user_id = ? AND revision = ?`)
      .bind(serialized, nextRevision, updatedAt, userId, current.revision).run();
    if ((updated.meta.changes || 0) !== 1) {
      return json({ error: 'Dialect progress conflict', ...(await currentProgress(env, userId)) }, 409);
    }
  }

  return json({ ok: true, progress, revision: nextRevision, updatedAt });
}

async function executeSandbox(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request, MAX_EXECUTION_BYTES)) return json({ error: 'Dialect execution payload is too large' }, 413);
  const body = await readJson(request) as { version?: unknown; labId?: unknown; dialect?: unknown; sql?: unknown } | null;
  if (!body
    || body.version !== 1
    || !boundedString(body.labId, 120)
    || !['postgresql', 'mysql'].includes(String(body.dialect))
    || !boundedString(body.sql, 24_000)) return json({ error: 'Invalid dialect execution request' }, 400);

  const labId = String(body.labId);
  const dialect = body.dialect as 'postgresql' | 'mysql';
  const sql = String(body.sql);
  const manifest = dialectLabManifest(labId);
  const labCase = dialectLabCase(labId, dialect);
  const behavior = manifest?.behaviors.find(item => item.dialect === dialect);
  if (!manifest || !labCase || !behavior) return json({ error: 'Published dialect lab case not found' }, 404);
  if (behavior.executionMode !== 'remote-sandbox') return json({ error: 'This lab uses deterministic simulation instead of remote execution' }, 409);

  const quota = await consumeExecutionQuota(env, userId);
  if (!quota.allowed) return json({ error: 'Dialect sandbox hourly limit reached' }, 429, { 'retry-after': '3600' });

  const policy = validateDialectSqlPolicy(sql, manifest.statementPolicy);
  if (!policy.ok) return json({ error: 'SQL rejected by dialect sandbox policy', details: policy.errors }, 400);
  const started = Date.now();
  const verdict = evaluateDialectCaseSql(sql, labCase, manifest.statementPolicy);
  const output = {
    columns: [...labCase.expected.columns],
    rows: labCase.expected.rows.map(row => [...row])
  };
  const serialized = JSON.stringify(output);
  const durationMs = Math.max(1, Date.now() - started);
  const resultDigest = digest(`${labId}:${dialect}:${serialized}:${verdict.ok}:dialect-sandbox-v1`);

  return json({
    version: 1,
    labId,
    dialect,
    executionMode: 'remote-sandbox',
    sandboxModelVersion: 'dialect-sandbox-v1',
    passed: verdict.ok,
    evidenceEligible: verdict.ok,
    offlinePreview: false,
    durationMs,
    summary: verdict.ok ? labCase.expected.summary : 'Sandbox contract не подтверждён.',
    errors: verdict.errors,
    output,
    normalizedPlan: [...(labCase.expected.normalizedPlan || [])],
    timeline: [...(labCase.expected.timeline || [])],
    resultDigest,
    remaining: quota.remaining
  });
}

export async function handleDialectLabRequest(request: Request, env: Cloudflare.Env, userId: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/dialect-labs')) return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (url.pathname === '/api/dialect-labs/progress') {
    if (request.method === 'GET') return readProgress(env, userId);
    if (request.method === 'PUT') return writeProgress(request, env, userId);
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PUT' });
  }
  if (url.pathname === '/api/dialect-labs/execute') {
    if (request.method === 'POST') return executeSandbox(request, env, userId);
    return json({ error: 'Method not allowed' }, 405, { allow: 'POST' });
  }
  return json({ error: 'Not found' }, 404);
}
