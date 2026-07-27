import { getSandbox } from '@cloudflare/sandbox';
import { dialectLabCase, type DialectResultValue } from '../src/data/dialect-lab-cases';
import { dialectLabManifest } from '../src/data/dialect-lab-manifests';
import { realEngineContract, type RealEngineDialect } from './dialect-real-engine-contracts';

export const DIALECT_REAL_ENGINE_ADAPTER_VERSION = 'real-engine-v1';
export const DIALECT_REAL_ENGINE_RUNNER_VERSION = 'dialect-real-engine-v1';

const RUNNER_PATH = '/opt/sql-academy-dialect-runner/runner.mjs';
const REQUEST_PATH = '/workspace/dialect-request.json';
const RESULT_PATH = '/workspace/dialect-result.json';
const TOTAL_TIMEOUT_MS = 45_000;
const MAX_RUNNER_ERROR_BYTES = 500;

// This optional profile is deliberately wider than the generated Cloudflare Free Env.
// The production typegen pins DIALECT_ENGINE_MODE to "preview-only" and has no Sandbox binding.
type RealEngineEnv = {
  DIALECT_SANDBOX?: Parameters<typeof getSandbox>[0];
  DIALECT_ENGINE_MODE?: string;
};

type RunnerResult = {
  version: 1;
  runnerVersion: string;
  engine?: RealEngineDialect;
  serverVersion?: string;
  success: boolean;
  durationMs: number;
  output?: {
    columns: string[];
    rows: unknown[][];
    truncated?: boolean;
  };
  errorCode?: string;
  error?: string;
};

export type RealEngineExecution = {
  available: boolean;
  passed: boolean;
  engineVersion: string | null;
  runnerVersion: string | null;
  durationMs: number;
  output: { columns: string[]; rows: DialectResultValue[][] } | null;
  normalizedPlan: string[];
  errors: string[];
  sandboxDestroyed: boolean;
};

function optionalEnv(env: Cloudflare.Env): RealEngineEnv {
  return env as unknown as RealEngineEnv;
}

function emptyExecution(error: string, available = false): RealEngineExecution {
  return {
    available,
    passed: false,
    engineVersion: null,
    runnerVersion: null,
    durationMs: 0,
    output: null,
    normalizedPlan: [],
    errors: [error],
    sandboxDestroyed: false
  };
}

function boundedEngineVersion(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9.+_()\- ]{1,120}$/i.test(value) ? value.trim() : null;
}

function boundedRunnerVersion(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9._\-]{1,80}$/i.test(value) ? value : null;
}

function safeRunnerError(code: unknown) {
  switch (code) {
    case 'engine_timeout': return 'Database statement exceeded the published timeout.';
    case 'engine_startup_timeout': return 'Database engine did not become ready before the startup deadline.';
    case 'result_too_large': return 'Database result exceeded the published size limit.';
    case 'invalid_request': return 'Real engine runner rejected its internal request contract.';
    case 'engine_error': return 'Database engine rejected the statement.';
    default: return 'Real database engine execution failed.';
  }
}

function parseRunnerResult(value: unknown, dialect: RealEngineDialect): RunnerResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid real engine runner response');
  const result = value as Record<string, unknown>;
  if (result.version !== 1
    || result.runnerVersion !== DIALECT_REAL_ENGINE_RUNNER_VERSION
    || result.engine !== dialect
    || typeof result.success !== 'boolean'
    || typeof result.durationMs !== 'number'
    || !Number.isFinite(result.durationMs)
    || result.durationMs < 0
    || result.durationMs > TOTAL_TIMEOUT_MS + 10_000) {
    throw new Error('Real engine runner response does not match the published contract');
  }
  if (result.error !== undefined
    && (typeof result.error !== 'string'
      || new TextEncoder().encode(result.error).byteLength > MAX_RUNNER_ERROR_BYTES)) {
    throw new Error('Real engine runner error payload is invalid');
  }
  return result as RunnerResult;
}

function normalizeValue(value: unknown): DialectResultValue {
  if (value === null || typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value);
}

function normalizedOutput(value: RunnerResult['output']) {
  if (!value
    || !Array.isArray(value.columns)
    || !Array.isArray(value.rows)
    || value.columns.length > 100
    || value.rows.length > 500) return null;
  if (!value.rows.every(row => Array.isArray(row) && row.length === value.columns.length)) return null;
  return {
    columns: value.columns.map(column => String(column).toLowerCase()),
    rows: value.rows.map(row => row.map(normalizeValue))
  };
}

function normalizeTimestamp(value: string) {
  return value
    .replace('T', ' ')
    .replace(/(?:\.0+)?(?:\+00(?::00)?|Z)$/, '')
    .trim();
}

function cellsEqual(actual: DialectResultValue, expected: DialectResultValue) {
  if (actual === expected) return true;
  if (typeof actual === 'string' && typeof expected === 'string') {
    return normalizeTimestamp(actual) === normalizeTimestamp(expected);
  }
  if (typeof actual === 'number' && typeof expected === 'string') return Number(expected) === actual;
  if (typeof actual === 'string' && typeof expected === 'number') return Number(actual) === expected;
  return false;
}

function outputMatches(
  actual: ReturnType<typeof normalizedOutput>,
  expected: { columns: readonly string[]; rows: readonly (readonly DialectResultValue[])[] }
) {
  if (!actual || actual.columns.length !== expected.columns.length || actual.rows.length !== expected.rows.length) return false;
  if (!actual.columns.every((column, index) => column === expected.columns[index].toLowerCase())) return false;
  return actual.rows.every((row, rowIndex) => row.length === expected.rows[rowIndex].length
    && row.every((cell, columnIndex) => cellsEqual(cell, expected.rows[rowIndex][columnIndex])));
}

function normalizePostgresPlan(output: ReturnType<typeof normalizedOutput>) {
  const raw = output?.rows.flat().find(value => typeof value === 'string' && value.trim().startsWith('['));
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ Plan?: Record<string, unknown> }>;
    const normalized = new Set<string>();
    const visit = (plan: Record<string, unknown> | undefined) => {
      if (!plan) return;
      const node = String(plan['Node Type'] || '').toLowerCase();
      if (node.includes('index')) normalized.add('access=index-scan');
      else if (node.includes('seq scan')) normalized.add('access=seq-scan');
      const index = plan['Index Name'];
      if (typeof index === 'string') normalized.add(`index=${index.toLowerCase()}`);
      if (node === 'sort') normalized.add('sort=explicit');
      const children = plan.Plans;
      if (Array.isArray(children)) {
        for (const child of children) visit(child as Record<string, unknown>);
      }
    };
    visit(parsed[0]?.Plan);
    if (![...normalized].some(item => item.startsWith('sort='))) normalized.add('sort=none');
    return [...normalized].sort();
  } catch {
    return [];
  }
}

function normalizeMysqlPlan(output: ReturnType<typeof normalizedOutput>) {
  const raw = output?.rows.flat().find(value => typeof value === 'string' && value.trim().startsWith('{'));
  if (typeof raw !== 'string') return [];
  try {
    const serialized = JSON.stringify(JSON.parse(raw)).toLowerCase();
    const normalized = new Set<string>();
    if (serialized.includes('idx_tickets_service')) normalized.add('index=idx_tickets_service');
    if (serialized.includes('"access_type":"ref"') || serialized.includes('"access_type": "ref"')) normalized.add('access=ref');
    else if (serialized.includes('"access_type":"all"') || serialized.includes('"access_type": "all"')) normalized.add('access=all');
    normalized.add(serialized.includes('filesort') ? 'sort=filesort' : 'sort=none');
    return [...normalized].sort();
  } catch {
    return [];
  }
}

function planPasses(dialect: RealEngineDialect, normalizedPlan: string[]) {
  if (dialect === 'postgresql') {
    return normalizedPlan.includes('access=index-scan') && normalizedPlan.includes('index=idx_tickets_service');
  }
  return normalizedPlan.includes('access=ref') && normalizedPlan.includes('index=idx_tickets_service');
}

async function opaqueSandboxId(userId: string, requestId: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${requestId}`));
  return `dialect-${Array.from(new Uint8Array(bytes))
    .slice(0, 16)
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function runnerRequest(input: { requestId: string; dialect: RealEngineDialect; labId: string; sql: string }) {
  const manifest = dialectLabManifest(input.labId);
  const contract = realEngineContract(input.labId, input.dialect);
  if (!manifest || !contract) return null;
  return {
    version: 1,
    requestId: input.requestId,
    engine: input.dialect,
    mode: contract.scenario,
    transactionKind: contract.transactionKind,
    setupSql: contract.setupSql,
    learnerSql: input.sql,
    verificationSql: contract.verificationSql,
    timeoutMs: manifest.statementPolicy.timeoutMs,
    maximumRows: manifest.statementPolicy.maximumRows,
    maximumCellBytes: manifest.statementPolicy.maximumCellBytes,
    maximumResultBytes: manifest.statementPolicy.maximumResultBytes
  };
}

export function realEngineRequired(env: Cloudflare.Env) {
  return optionalEnv(env).DIALECT_ENGINE_MODE === 'real-required';
}

export function realEngineConfigured(env: Cloudflare.Env) {
  return Boolean(optionalEnv(env).DIALECT_SANDBOX);
}

export async function executeRealDialectEngine(input: {
  env: Cloudflare.Env;
  userId: string;
  requestId: string;
  labId: string;
  dialect: RealEngineDialect;
  sql: string;
}): Promise<RealEngineExecution> {
  const binding = optionalEnv(input.env).DIALECT_SANDBOX;
  const request = runnerRequest(input);
  if (!binding) return emptyExecution('Cloudflare Sandbox binding is unavailable.');
  if (!request) return emptyExecution('Real engine scenario is not published yet.');

  const sandbox = getSandbox(binding, await opaqueSandboxId(input.userId, input.requestId), {
    enableDefaultSession: false,
    transport: 'rpc',
    sleepAfter: '30s',
    containerTimeouts: {
      instanceGetTimeoutMS: 45_000,
      portReadyTimeoutMS: 120_000
    }
  });
  let outcome = emptyExecution('Real engine did not return a result.', true);
  let destroyed = false;

  try {
    await sandbox.writeFile(REQUEST_PATH, JSON.stringify(request));
    const session = await sandbox.createSession({ id: 'dialect-engine', commandTimeoutMs: TOTAL_TIMEOUT_MS });
    const execution = await session.exec(`node ${RUNNER_PATH} ${REQUEST_PATH} ${RESULT_PATH}`, { timeout: TOTAL_TIMEOUT_MS });
    const file = await sandbox.readFile(RESULT_PATH, { encoding: 'utf-8' });
    const result = parseRunnerResult(JSON.parse(file.content), input.dialect);
    const engine = boundedEngineVersion(result.serverVersion);
    const runner = boundedRunnerVersion(result.runnerVersion);

    if (!result.success || !execution.success || execution.exitCode !== 0) {
      outcome = {
        ...emptyExecution(safeRunnerError(result.errorCode), true),
        engineVersion: engine,
        runnerVersion: runner,
        durationMs: Math.max(1, Math.trunc(result.durationMs) || 1)
      };
    } else {
      const labCase = dialectLabCase(input.labId, input.dialect);
      if (!labCase) throw new Error('Published dialect case is missing');
      const output = normalizedOutput(result.output);
      if (!output) throw new Error('Real engine output is invalid');
      const normalizedPlan = labCase.expected.normalizedPlan
        ? input.dialect === 'postgresql'
          ? normalizePostgresPlan(output)
          : normalizeMysqlPlan(output)
        : [];
      const passed = labCase.expected.normalizedPlan
        ? planPasses(input.dialect, normalizedPlan)
        : outputMatches(output, labCase.expected);
      outcome = {
        available: true,
        passed,
        engineVersion: engine,
        runnerVersion: runner,
        durationMs: Math.max(1, Math.trunc(result.durationMs) || 1),
        output,
        normalizedPlan,
        errors: passed ? [] : ['Real engine result/plan does not match the published semantic contract.'],
        sandboxDestroyed: false
      };
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.error('dialect_real_engine_execution_failed', {
      requestId: input.requestId,
      labId: input.labId,
      dialect: input.dialect,
      name
    });
    outcome = emptyExecution('Real database engine execution failed.', true);
  } finally {
    try {
      await sandbox.destroy();
      destroyed = true;
    } catch (error) {
      console.error('dialect_sandbox_destroy_failed', {
        requestId: input.requestId,
        name: error instanceof Error ? error.name : 'UnknownError'
      });
    }
  }

  return {
    ...outcome,
    passed: outcome.passed && destroyed,
    errors: destroyed ? outcome.errors : [...outcome.errors, 'Sandbox destroy was not confirmed.'],
    sandboxDestroyed: destroyed
  };
}
