import { getSandbox } from '@cloudflare/sandbox';
import { dialectLabCase, type DialectResultValue } from '../src/data/dialect-lab-cases';
import { dialectLabManifest } from '../src/data/dialect-lab-manifests';
import { realEngineContract, type RealEngineDialect } from './dialect-real-engine-contracts';

const ADAPTER_VERSION = 'real-engine-v1';
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

function boundedEngineVersion(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9.+_()\- ]{1,120}$/i.test(value) ? value.trim() : null;
}

function normalizeValue(value: unknown): DialectResultValue {
  if (value === null || typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value);
}

function normalizedOutput(value: RunnerResult['output']) {
  if (!value || !Array.isArray(value.columns) || !Array.isArray(value.rows)) return null;
  return {
    columns: value.columns.map(column => String(column).toLowerCase()),
    rows: value.rows.map(row => row.map(normalizeValue))
  };
}

function timestampsEquivalent(actual: string, expected: string) {
  const normalize = (value: string) => value
    .replace(/T/, ' ')
    .replace(/(?:\.0+)?(?:\+00(?::00)?|Z)$/, '')
    .trim();
  return normalize(actual) === normalize(expected);
}

function cellsEqual(actual: DialectResultValue, expected: DialectResultValue) {
  if (actual === expected) return true;
  if (typeof actual === 'string' && typeof expected === 'string') return timestampsEquivalent(actual, expected);
  if (typeof actual === 'number' && typeof expected === 'string' && Number(expected) === actual) return true;
  if (typeof actual === 'string' && typeof expected === 'number' && Number(actual) === expected) return true;
  return false;
}

function outputMatches(actual: ReturnType<typeof normalizedOutput>, expected: { columns: readonly string[]; rows: readonly (readonly DialectResultValue[])[] }) {
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
      if (Array.isArray(children)) for (const child of children) visit(child as Record<string, unknown>);
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
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const serialized = JSON.stringify(parsed).toLowerCase();
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
  if (dialect === 'postgresql') return normalizedPlan.includes('access=index-scan') && normalizedPlan.includes('index=idx_tickets_service');
  return normalizedPlan.includes('access=ref') && normalizedPlan.includes('index=idx_tickets_service');
}

async function opaqueSandboxId(userId: string, requestId: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${requestId}`));
  return `dialect-${Array.from(new Uint8Array(bytes)).slice(0, 16).map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function runnerRequest(input: {
  requestId: string;
  dialect: RealEngineDialect;
  labId: string;
  sql: string;
}) {
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
  const request = runnerRequest(input);
  if (!binding || !request) {
    return {
      available: false,
      passed: false,
      engineVersion: null,
      runnerVersion: null,
      durationMs: 0,
      output: null,
      normalizedPlan: [],
      errors: [binding ? 'Real engine scenario is not published yet.' : 'Cloudflare Sandbox binding is unavailable.'],
      sandboxDestroyed: false
    };
  }

  const sandboxId = await opaqueSandboxId(input.userId, input.requestId);
  const sandbox = getSandbox(binding, sandboxId, {
    enableDefaultSession: false,
    sleepAfter: '30s',
    containerTimeouts: {
      instanceGetTimeoutMS: 45_000,
      portReadyTimeoutMS: 120_000
    }
  });
  let destroyed = false;
  try {
    await sandbox.writeFile(REQUEST_PATH, JSON.stringify(request));
    const session = await sandbox.createSession({ id: 'dialect-engine', commandTimeoutMs: TOTAL_TIMEOUT_MS });
    const execution = await session.exec(`node ${RUNNER_PATH} ${REQUEST_PATH} ${RESULT_PATH}`, { timeout: TOTAL_TIMEOUT_MS });
    const raw = await sandbox.readFile(RESULT_PATH);
    const serialized = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as Uint8Array);
    const result = JSON.parse(serialized) as RunnerResult;
    if (!result.success || execution.exitCode !== 0) {
      return {
        available: true,
        passed: false,
        engineVersion: boundedEngineVersion(result.serverVersion),
        runnerVersion: typeof result.runnerVersion === 'string' ? result.runnerVersion.slice(0, 80) : null,
        durationMs: Math.max(1, Number(result.durationMs) || 1),
        output: null,
        normalizedPlan: [],
        errors: [result.error || `Real engine process exited with ${execution.exitCode}.`],
        sandboxDestroyed: false
      };
    }

    const labCase = dialectLabCase(input.labId, input.dialect);
    if (!labCase) throw new Error('Published dialect case is missing');
    const output = normalizedOutput(result.output);
    const normalizedPlan = labCase.expected.normalizedPlan
      ? input.dialect === 'postgresql' ? normalizePostgresPlan(output) : normalizeMysqlPlan(output)
      : [];
    const passed = labCase.expected.normalizedPlan
      ? planPasses(input.dialect, normalizedPlan)
      : outputMatches(output, labCase.expected);
    return {
      available: true,
      passed,
      engineVersion: boundedEngineVersion(result.serverVersion),
      runnerVersion: typeof result.runnerVersion === 'string' ? result.runnerVersion.slice(0, 80) : null,
      durationMs: Math.max(1, Number(result.durationMs) || 1),
      output,
      normalizedPlan,
      errors: passed ? [] : ['Real engine result/plan does not match the published semantic contract.'],
      sandboxDestroyed: false
    };
  } catch (error) {
    return {
      available: true,
      passed: false,
      engineVersion: null,
      runnerVersion: null,
      durationMs: 0,
      output: null,
      normalizedPlan: [],
      errors: [error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)],
      sandboxDestroyed: false
    };
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
    void destroyed;
  }
}

export const DIALECT_REAL_ENGINE_ADAPTER_VERSION = ADAPTER_VERSION;
