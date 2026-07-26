import type { SqlDialect } from '../src/data/dialect-lab-manifests';

type RealEngineDialect = Exclude<SqlDialect, 'sqlite'>;

type DialectEngineClientEnv = Cloudflare.Env & {
  DIALECT_ENGINE_SERVICE?: Fetcher;
  DIALECT_ENGINE_INTERNAL_TOKEN?: string;
  DIALECT_REAL_ENGINES_ENABLED?: string;
};

export type RealDialectEngineResponse = {
  version: 1;
  serviceVersion: string;
  labId: string;
  dialect: RealEngineDialect;
  executionMode: 'remote-sandbox';
  engineModel: `${RealEngineDialect}-container-v1`;
  engineVersion: string;
  realEngine: true;
  passed: boolean;
  evidenceEligible: boolean;
  offlinePreview: false;
  durationMs: number;
  summary: string;
  errors: string[];
  output: { columns: string[]; rows: Array<Array<string | number | null>> } | null;
  normalizedPlan: string[];
  timeline: string[];
};

export function realDialectEnginesConfigured(env: Cloudflare.Env) {
  const candidate = env as DialectEngineClientEnv;
  return candidate.DIALECT_REAL_ENGINES_ENABLED === 'true'
    && Boolean(candidate.DIALECT_ENGINE_SERVICE)
    && typeof candidate.DIALECT_ENGINE_INTERNAL_TOKEN === 'string'
    && candidate.DIALECT_ENGINE_INTERNAL_TOKEN.length >= 32;
}

function validResponse(value: unknown, labId: string, dialect: RealEngineDialect): value is RealDialectEngineResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Partial<RealDialectEngineResponse>;
  return response.version === 1
    && response.realEngine === true
    && response.executionMode === 'remote-sandbox'
    && response.labId === labId
    && response.dialect === dialect
    && response.engineModel === `${dialect}-container-v1`
    && typeof response.engineVersion === 'string'
    && response.engineVersion.length <= 120
    && typeof response.passed === 'boolean'
    && typeof response.evidenceEligible === 'boolean'
    && response.offlinePreview === false
    && typeof response.durationMs === 'number'
    && Number.isFinite(response.durationMs)
    && response.durationMs >= 1
    && response.durationMs <= 120_000
    && typeof response.summary === 'string'
    && Array.isArray(response.errors)
    && response.errors.length <= 32
    && response.errors.every(item => typeof item === 'string' && item.length <= 500)
    && (response.output === null || (
      Array.isArray(response.output?.columns)
      && response.output.columns.length <= 64
      && Array.isArray(response.output?.rows)
      && response.output.rows.length <= 200
    ))
    && Array.isArray(response.normalizedPlan)
    && response.normalizedPlan.length <= 32
    && Array.isArray(response.timeline)
    && response.timeline.length <= 32;
}

export async function executeRealDialectEngine(
  env: Cloudflare.Env,
  input: { labId: string; dialect: RealEngineDialect; sql: string }
): Promise<RealDialectEngineResponse | null> {
  const candidate = env as DialectEngineClientEnv;
  if (!realDialectEnginesConfigured(env) || !candidate.DIALECT_ENGINE_SERVICE || !candidate.DIALECT_ENGINE_INTERNAL_TOKEN) return null;

  const response = await candidate.DIALECT_ENGINE_SERVICE.fetch('https://dialect-engine.internal/internal/execute', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${candidate.DIALECT_ENGINE_INTERNAL_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ version: 1, ...input })
  });
  const payload = await response.json<unknown>();
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? String((payload as Record<string, unknown>).error || `HTTP ${response.status}`)
      : `HTTP ${response.status}`;
    throw new Error(`Real dialect engine service failed: ${error.slice(0, 240)}`);
  }
  if (!validResponse(payload, input.labId, input.dialect)) throw new Error('Real dialect engine service returned an invalid contract');
  return payload;
}
