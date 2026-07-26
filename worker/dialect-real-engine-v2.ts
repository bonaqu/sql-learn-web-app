import { getSandbox } from '@cloudflare/sandbox';
import { dialectLabCase, type DialectResultValue } from '../src/data/dialect-lab-cases';
import { dialectLabManifest } from '../src/data/dialect-lab-manifests';
import { realEngineContract, type RealEngineDialect } from './dialect-real-engine-contracts';

export const DIALECT_REAL_ENGINE_ADAPTER_VERSION = 'real-engine-v1';

const RUNNER_PATH = '/opt/sql-academy-dialect-runner/runner.mjs';
const REQUEST_PATH = '/workspace/dialect-request.json';
const RESULT_PATH = '/workspace/dialect-result.json';
const TOTAL_TIMEOUT_MS = 45_000;

type RealEngineEnv = Cloudflare.Env & {
  DIALECT_SANDBOX?: Parameters<typeof getSandbox>[0];
  DIALECT_ENGINE_MODE?: string;
};

type RunnerResult = {
  version: 1;
  runnerVersion: string;
  serverVersion?: string;
  success: boolean;
  durationMs: number;
  output?: { columns: string[]; rows: unknown[][]; truncated?: boolean };
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

function engineVersion(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9.+_()\- ]{1,120}$/i.test(value) ? value.trim() : null;
}

function normalizeValue(value: unknown): DialectResultValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value);
}

function normalizeOutput(value: RunnerResult['output']) {
  if (!value || !Array.isArray(value.columns) || !Array.isArray(value.rows)) return null;
  return {
    columns: value.columns.map(column => String(column).toLowerCase()),
    rows: value.rows.map(row => row.map(normalizeValue))
  };
}

function timestamp(value: string) {
  return value.replace('T', ' ').replace(/(?:\.0+)?(?:\+00(?::00)?|Z)$/, '').trim();
}

function cellEqual(actual: DialectResultValue, expected: DialectResultValue) {
  if (actual === expected) return true;
  if (typeof actual === 'string' && typeof expected === 'string') return timestamp(actual) === timestamp(expected);
  if (typeof actual === 'number' && typeof expected === 'string') return Number(expected) === actual;
  if (typeof actual === 'string' && typeof expected === 'number') return Number(actual) === expected;
  return false;
}

function outputEqual(actual: ReturnType<typeof normalizeOutput>, expected: { columns: readonly string[]; rows: readonly (readonly DialectResultValue[])[] }) {
  return Boolean(actual
    && actual.columns.length === expected.columns.length
    && actual.rows.length === expected.rows.length
    && actual.columns.every((column, index) => column === expected.columns[index].toLowerCase())
    && actual.rows.every((row, rowIndex) => row.length === expected.rows[rowIndex].length
      && row.every((cell, columnIndex) => cellEqual(cell, expected.rows[rowIndex][columnIndex]))));
}

function postgresPlan(output: ReturnType<typeof normalizeOutput>) {
  const raw = output?.rows.flat().find(value => typeof value === 'string' && value.trim().startsWith('['));
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ Plan?: Record<string, unknown> }>;
    const values = new Set<string>();
    const walk = (plan: Record<string, unknown> | undefined) => {
      if (!plan) return;
      const node = String(plan['Node Type'] || '').toLowerCase();
      if (node.includes('index')) values.add('access=index-scan');
      else if (node.includes('seq scan')) values.add('access=seq-scan');
      if (typeof plan['Index Name'] === 'string') values.add(`index=${String(plan['Index Name']).toLowerCase()}`);
      if (node === 'sort') values.add('sort=explicit');
      if (Array.isArray(plan.Plans)) for (const child of plan.Plans) walk(child as Record<string, unknown>);
    };
    walk(parsed[0]?.Plan);
    if (![...values].some(item => item.startsWith('sort='))) values.add('sort=none');
    return [...values].sort();
  } catch {
    return [];
  }
}

function mysqlPlan(output: ReturnType<typeof normalizeOutput>) {
  const raw = output?.rows.flat().find(value => typeof value === 'string' && value.trim().startsWith('{'));
  if (typeof raw !== 'string') return [];
  try {
    const serialized = JSON.stringify(JSON.parse(raw)).toLowerCase();
    const values = new Set<string>();
    values.add(serialized.includes('"access_type":"ref"') ? 'access=ref' : 'access=all');
    if (serialized.includes('idx_tickets_service')) values.add('index=idx_tickets_service');
    values.add(serialized.includes('filesort') ? 'sort=filesort' : 'sort=none');
    return [...values].sort();
  } catch {
    return [];
  }
}

function planEqual(dialect: RealEngineDialect, values: string[]) {
  return dialect === 'postgresql'
    ? values.includes('access=index-scan') && values.includes('index=idx_tickets_service')
    : values.includes('access=ref') && values.includes('index=idx_tickets_service');
}

async function sandboxId(userId: string, requestId: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${requestId}`));
  return `dialect-${Array.from(new Uint8Array(bytes)).slice(0, 16).map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function requestPayload(input: { requestId: string; labId: string; dialect: RealEngineDialect; sql: string }) {
  const manifest = dialectLabManifest(input.labId);
  const contract = realEngineContract(input.labId, input.dialect);
  if (!manifest || !contract || contract.scenario === 'transaction') return null;
  return {
    version: 1,
    requestId: input.requestId,
    engine: input.dialect,
    mode: contract.scenario,
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
  return (env as RealEngineEnv).DIALECT_ENGINE_MODE === 'real-required';
}

export function realEngineConfigured(env: Cloudflare.Env) {
  return Boolean((env as RealEngineEnv).DIALECT_SANDBOX);
}

export async function executeRealDialectEngine(input: {
  env: Cloudflare.Env;
  userId: string;
  requestId: string;
  labId: string;
  dialect: RealEngineDialect;
  sql: string;
}): Promise<RealEngineExecution> {
  const binding = (input.env as RealEngineEnv).DIALECT_SANDBOX;
  const request = requestPayload(input);
  if (!binding) return emptyExecution('Cloudflare Sandbox binding is unavailable.');
  if (!request) return emptyExecution('Real engine scenario is not published yet.');

  const sandbox = getSandbox(binding, await sandboxId(input.userId, input.requestId), {
    enableDefaultSession: false,
    sleepAfter: '30s',
    containerTimeouts: { instanceGetTimeoutMS: 45_000, portReadyTimeoutMS: 120_000 }
  });
  let outcome = emptyExecution('Real engine did not return a result.', true);
  let destroyed = false;
  try {
    await sandbox.writeFile(REQUEST_PATH, JSON.stringify(request));
    const session = await sandbox.createSession({ id: 'dialect-engine', commandTimeoutMs: TOTAL_TIMEOUT_MS });
    const command = await session.exec(`node ${RUNNER_PATH} ${REQUEST_PATH} ${RESULT_PATH}`, { timeout: TOTAL_TIMEOUT_MS });
    const raw = await sandbox.readFile(RESULT_PATH);
    const serialized = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as Uint8Array);
    const result = JSON.parse(serialized) as RunnerResult;
    if (!result.success || command.exitCode !== 0) {
      outcome = {
        ...emptyExecution(result.error || `Real engine process exited with ${command.exitCode}.`, true),
        engineVersion: engineVersion(result.serverVersion),
        runnerVersion: result.runnerVersion?.slice(0, 80) || null,
        durationMs: Math.max(1, Number(result.durationMs) || 1)
      };
    } else {
      const labCase = dialectLabCase(input.labId, input.dialect);
      if (!labCase) throw new Error('Published dialect case is missing');
      const output = normalizeOutput(result.output);
      const normalizedPlan = labCase.expected.normalizedPlan
        ? input.dialect === 'postgresql' ? postgresPlan(output) : mysqlPlan(output)
        : [];
      const passed = labCase.expected.normalizedPlan ? planEqual(input.dialect, normalizedPlan) : outputEqual(output, labCase.expected);
      outcome = {
        available: true,
        passed,
        engineVersion: engineVersion(result.serverVersion),
        runnerVersion: result.runnerVersion?.slice(0, 80) || null,
        durationMs: Math.max(1, Number(result.durationMs) || 1),
        output,
        normalizedPlan,
        errors: passed ? [] : ['Real engine result/plan does not match the published semantic contract.'],
        sandboxDestroyed: false
      };
    }
  } catch (error) {
    outcome = emptyExecution(error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), true);
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
