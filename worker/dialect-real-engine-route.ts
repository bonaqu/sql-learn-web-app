import { dialectLabCase } from '../src/data/dialect-lab-cases';
import { dialectLabManifest } from '../src/data/dialect-lab-manifests';
import { evaluateDialectCaseSql, validateDialectSqlPolicy } from '../src/lib/dialect-lab-policy';
import {
  DIALECT_REAL_ENGINE_ADAPTER_VERSION,
  DIALECT_REAL_ENGINE_RUNNER_VERSION,
  executeRealDialectEngine,
  realEngineConfigured,
  realEngineRequired
} from './dialect-real-engine';

const MAX_EXECUTION_BYTES = 28_000;
const HOURLY_EXECUTION_LIMIT = 30;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-dialect-lab-contract': 'dialect-real-engines-v1',
    ...headers
  }
});

function bodyTooLarge(headers: { get(name: string): string | null }, maximum: number) {
  const length = Number(headers.get('content-length') || 0);
  return Number.isFinite(length) && length > maximum;
}

function boundedString(value: unknown, maximum: number) {
  return typeof value === 'string' && value.length <= maximum;
}

async function readJson(request: { json<T>(): Promise<T> }) {
  try { return await request.json<unknown>(); } catch { return null; }
}

function digest(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

async function consumeQuota(env: Cloudflare.Env, userId: string) {
  if (!env.SETTINGS) return { allowed: true, remaining: null as number | null };
  const hour = new Date().toISOString().slice(0, 13);
  const key = `dialect-real-engines:${hour}:${userId}`;
  const current = Math.max(0, Number(await env.SETTINGS.get(key)) || 0);
  if (current >= HOURLY_EXECUTION_LIMIT) return { allowed: false, remaining: 0 };
  await env.SETTINGS.put(key, String(current + 1), { expirationTtl: 7_200 });
  return { allowed: true, remaining: HOURLY_EXECUTION_LIMIT - current - 1 };
}

export async function handleDialectRealEngineRequest(
  request: Request,
  env: Cloudflare.Env,
  userId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/dialect-labs/execute' || request.method !== 'POST') return null;
  const configured = realEngineConfigured(env);
  const required = realEngineRequired(env);
  if (!configured && !required) return null;
  if (!configured) return json({ error: 'Real database engine binding is required but unavailable' }, 503);
  if (bodyTooLarge(request.headers, MAX_EXECUTION_BYTES)) return json({ error: 'Dialect execution payload is too large' }, 413);

  const body = await readJson(request.clone()) as Record<string, unknown> | null;
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
  if (behavior.executionMode !== 'remote-sandbox') return null;

  const policy = validateDialectSqlPolicy(sql, manifest.statementPolicy);
  if (!policy.ok) return json({ error: 'SQL rejected by real engine policy', details: policy.errors }, 400);
  const semantic = evaluateDialectCaseSql(sql, labCase, manifest.statementPolicy);
  if (!semantic.ok) {
    return json({
      version: 1,
      labId,
      dialect,
      executionMode: 'remote-sandbox',
      verificationMode: DIALECT_REAL_ENGINE_ADAPTER_VERSION,
      engineVersion: null,
      runnerVersion: null,
      sandboxDestroyed: true,
      passed: false,
      evidenceEligible: false,
      offlinePreview: false,
      durationMs: 1,
      summary: 'Semantic contract не подтверждён; real engine не запускался.',
      errors: semantic.errors,
      output: null,
      normalizedPlan: [],
      timeline: [],
      resultDigest: digest(`${labId}:${dialect}:semantic-failed:${DIALECT_REAL_ENGINE_ADAPTER_VERSION}`)
    });
  }

  const quota = await consumeQuota(env, userId);
  if (!quota.allowed) return json({ error: 'Real dialect engine hourly limit reached' }, 429, { 'retry-after': '3600' });
  const requestId = crypto.randomUUID();
  const result = await executeRealDialectEngine({ env, userId, requestId, labId, dialect, sql });
  if (!result.available) {
    if (!required) return null;
    return json({ error: result.errors[0] || 'Real database engine is unavailable' }, 503);
  }

  const publishedOutput = {
    columns: [...labCase.expected.columns],
    rows: labCase.expected.rows.map(row => [...row])
  };
  const eligible = result.passed
    && result.sandboxDestroyed
    && Boolean(result.engineVersion)
    && result.runnerVersion === DIALECT_REAL_ENGINE_RUNNER_VERSION;
  const resultDigest = digest(`${labId}:${dialect}:${JSON.stringify(publishedOutput)}:${eligible}:${DIALECT_REAL_ENGINE_ADAPTER_VERSION}`);
  return json({
    version: 1,
    labId,
    dialect,
    executionMode: 'remote-sandbox',
    verificationMode: DIALECT_REAL_ENGINE_ADAPTER_VERSION,
    engineVersion: result.engineVersion,
    runnerVersion: result.runnerVersion,
    sandboxDestroyed: result.sandboxDestroyed,
    passed: eligible,
    evidenceEligible: eligible,
    offlinePreview: false,
    durationMs: result.durationMs,
    summary: eligible ? labCase.expected.summary : 'Real database engine contract не подтверждён.',
    errors: result.errors,
    output: result.output,
    normalizedPlan: result.normalizedPlan,
    timeline: [...(labCase.expected.timeline || [])],
    resultDigest,
    remaining: quota.remaining
  });
}
