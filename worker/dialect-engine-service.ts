import { getSandbox, Sandbox } from '@cloudflare/sandbox';
import { dialectLabCase } from '../src/data/dialect-lab-cases';
import { dialectLabManifest, type SqlDialect } from '../src/data/dialect-lab-manifests';
import { evaluateDialectCaseSql, validateDialectSqlPolicy } from '../src/lib/dialect-lab-policy';

export { Sandbox as DialectEngineSandbox } from '@cloudflare/sandbox';

type EngineDialect = Exclude<SqlDialect, 'sqlite'>;

type DialectEngineEnv = {
  DIALECT_ENGINE_SANDBOX: DurableObjectNamespace<Sandbox>;
  DIALECT_ENGINE_INTERNAL_TOKEN: string;
};

type RunnerPayload = {
  ok: boolean;
  engine: EngineDialect;
  labId: string;
  engineVersion?: string;
  durationMs?: number;
  columns?: string[];
  rows?: unknown[][];
  normalizedPlan?: string[];
  timeline?: string[];
  error?: string;
};

const MAX_REQUEST_BYTES = 28_000;
const MAX_RESPONSE_BYTES = 256_000;
const STARTUP_TIMEOUT_MS = 60_000;
const SERVICE_VERSION = 'dialect-real-engines-v1';
const LAB_PATTERN = /^dialect-[a-z0-9-]{3,96}$/;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-dialect-engine-service': SERVICE_VERSION,
    ...headers
  }
});

function requestTooLarge(request: Request) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > MAX_REQUEST_BYTES;
}

function authorized(request: Request, env: DialectEngineEnv) {
  const expected = env.DIALECT_ENGINE_INTERNAL_TOKEN;
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  return expected.length >= 32 && actual.length === expected.length && actual === expected;
}

async function readJson(request: Request) {
  try { return await request.json<unknown>(); } catch { return null; }
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function normalizeCell(value: unknown): string | number | null {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value);
}

function normalizeRunner(payload: RunnerPayload, maximumRows: number) {
  const columns = Array.isArray(payload.columns)
    ? payload.columns.slice(0, 64).map(column => String(column).toLowerCase().slice(0, 160))
    : [];
  const rows = Array.isArray(payload.rows)
    ? payload.rows.slice(0, maximumRows).map(row => Array.isArray(row) ? row.slice(0, 64).map(normalizeCell) : [])
    : [];
  return {
    columns,
    rows,
    normalizedPlan: Array.isArray(payload.normalizedPlan)
      ? payload.normalizedPlan.slice(0, 32).map(item => String(item).slice(0, 200)).sort()
      : [],
    timeline: Array.isArray(payload.timeline)
      ? payload.timeline.slice(0, 32).map(item => String(item).slice(0, 400))
      : []
  };
}

function expectedOutput(labId: string, dialect: EngineDialect) {
  const labCase = dialectLabCase(labId, dialect);
  if (!labCase) return null;
  return {
    columns: [...labCase.expected.columns],
    rows: labCase.expected.rows.map(row => [...row])
  };
}

function outputMatches(labId: string, dialect: EngineDialect, actual: { columns: string[]; rows: Array<Array<string | number | null>> }) {
  const expected = expectedOutput(labId, dialect);
  if (!expected) return false;
  if (labId === 'dialect-plan-vocabulary') {
    return actual.columns.length === 1 && actual.columns[0] === 'plan' && actual.rows.length === 1;
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function planMatches(dialect: EngineDialect, plan: string[]) {
  if (!plan.some(item => item === 'index=idx_tickets_service')) return false;
  if (dialect === 'postgresql') return plan.some(item => item === 'access=index-scan');
  return plan.some(item => item === 'access=ref' || item === 'access=range');
}

async function executeRealEngine(request: Request, env: DialectEngineEnv) {
  if (!authorized(request, env)) return json({ error: 'Unauthorized' }, 401);
  if (requestTooLarge(request)) return json({ error: 'Request is too large' }, 413);
  const body = await readJson(request) as Record<string, unknown> | null;
  if (!body
    || body.version !== 1
    || !boundedText(body.labId, 120)
    || !LAB_PATTERN.test(String(body.labId))
    || !['postgresql', 'mysql'].includes(String(body.dialect))
    || !boundedText(body.sql, 24_000)) return json({ error: 'Invalid real-engine request' }, 400);

  const labId = String(body.labId);
  const dialect = body.dialect as EngineDialect;
  const sql = String(body.sql);
  const manifest = dialectLabManifest(labId);
  const labCase = dialectLabCase(labId, dialect);
  const behavior = manifest?.behaviors.find(item => item.dialect === dialect);
  if (!manifest || !labCase || !behavior) return json({ error: 'Published real-engine case not found' }, 404);

  const policy = validateDialectSqlPolicy(sql, manifest.statementPolicy);
  const semantic = evaluateDialectCaseSql(sql, labCase, manifest.statementPolicy);
  if (!policy.ok || !semantic.ok) {
    return json({
      version: 1,
      serviceVersion: SERVICE_VERSION,
      labId,
      dialect,
      passed: false,
      evidenceEligible: false,
      errors: [...new Set([...policy.errors, ...semantic.errors])]
    });
  }

  const sandboxId = `dialect-${dialect}-${crypto.randomUUID()}`;
  const sandbox = getSandbox(env.DIALECT_ENGINE_SANDBOX, sandboxId, {
    normalizeId: true,
    sleepAfter: '1m'
  });
  let destroyError = '';
  const startedAt = Date.now();

  try {
    const startup = await sandbox.exec(`/opt/dialect-engine/start-engine.sh ${dialect}`, {
      timeout: STARTUP_TIMEOUT_MS,
      maxOutputChars: 32_000
    });
    if (!startup.success) {
      return json({
        error: 'SQL engine failed to start',
        serviceVersion: SERVICE_VERSION,
        dialect,
        exitCode: startup.exitCode,
        stderr: startup.stderr.slice(0, 4_000)
      }, 503);
    }

    const runnerInput = JSON.stringify({
      labId,
      sql,
      timeoutMs: manifest.statementPolicy.timeoutMs,
      maximumRows: manifest.statementPolicy.maximumRows,
      maximumResultBytes: manifest.statementPolicy.maximumResultBytes
    });
    const command = await sandbox.exec(`node /opt/dialect-engine/engine-runner.mjs ${dialect}`, {
      stdin: runnerInput,
      timeout: Math.min(15_000, manifest.statementPolicy.timeoutMs + 8_000),
      maxOutputChars: MAX_RESPONSE_BYTES
    });
    if (!command.success) {
      let runnerError = command.stderr.slice(0, 4_000);
      try {
        const parsed = JSON.parse(command.stdout) as RunnerPayload;
        runnerError = parsed.error || runnerError;
      } catch {}
      return json({
        version: 1,
        serviceVersion: SERVICE_VERSION,
        labId,
        dialect,
        passed: false,
        evidenceEligible: false,
        realEngine: true,
        durationMs: Math.max(1, Date.now() - startedAt),
        errors: [runnerError || 'Real engine execution failed']
      });
    }

    let runner: RunnerPayload;
    try {
      runner = JSON.parse(command.stdout) as RunnerPayload;
    } catch {
      return json({ error: 'Real engine returned invalid JSON' }, 502);
    }
    if (!runner.ok || runner.engine !== dialect || runner.labId !== labId) {
      return json({ error: runner.error || 'Real engine contract mismatch' }, 502);
    }

    const normalized = normalizeRunner(runner, manifest.statementPolicy.maximumRows);
    const resultBytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength;
    if (resultBytes > manifest.statementPolicy.maximumResultBytes) {
      return json({ error: 'Real engine result exceeded published limit' }, 413);
    }
    const passed = outputMatches(labId, dialect, normalized)
      && (labId !== 'dialect-plan-vocabulary' || planMatches(dialect, normalized.normalizedPlan));

    return json({
      version: 1,
      serviceVersion: SERVICE_VERSION,
      sandboxId: sandboxId.slice(0, 36),
      labId,
      dialect,
      executionMode: 'remote-sandbox',
      engineModel: `${dialect}-container-v1`,
      engineVersion: String(runner.engineVersion || 'unknown').slice(0, 120),
      realEngine: true,
      passed,
      evidenceEligible: passed,
      offlinePreview: false,
      durationMs: Math.max(1, Date.now() - startedAt),
      summary: passed ? labCase.expected.summary : 'Real engine output differs from the published invariant contract.',
      errors: passed ? [] : ['Real engine result/plan contract mismatch.'],
      output: { columns: normalized.columns, rows: normalized.rows },
      normalizedPlan: normalized.normalizedPlan,
      timeline: normalized.timeline
    });
  } finally {
    try {
      await sandbox.destroy();
    } catch (error) {
      destroyError = error instanceof Error ? error.message : String(error);
      console.error('dialect_engine_sandbox_destroy_failed', {
        sandboxId: sandboxId.slice(0, 36),
        dialect,
        labId,
        error: destroyError.slice(0, 240)
      });
    }
  }
}

export default {
  async fetch(request: Request, env: DialectEngineEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, serviceVersion: SERVICE_VERSION, engines: ['postgresql', 'mysql'] });
    }
    if (url.pathname !== '/internal/execute' || request.method !== 'POST') {
      return json({ error: 'Not found' }, 404);
    }
    return executeRealEngine(request, env);
  }
} satisfies ExportedHandler<DialectEngineEnv>;
