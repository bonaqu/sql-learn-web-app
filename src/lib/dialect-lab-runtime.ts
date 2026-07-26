import { dialectLabCase, type DialectResultValue } from '../data/dialect-lab-cases';
import { dialectLabManifest, type DialectExecutionMode, type SqlDialect } from '../data/dialect-lab-manifests';
import { trainingSeedSql } from '../data/training-dataset';
import { loadCapstoneSqlRuntime } from './capstone-sql-runtime';
import { evaluateDialectCaseSql } from './dialect-lab-policy';

export type DialectLabOutput = {
  columns: string[];
  rows: DialectResultValue[][];
};

export type DialectLabExecution = {
  version: 1;
  labId: string;
  dialect: SqlDialect;
  executionMode: DialectExecutionMode;
  passed: boolean;
  evidenceEligible: boolean;
  offlinePreview: boolean;
  durationMs: number;
  summary: string;
  errors: string[];
  output: DialectLabOutput | null;
  normalizedPlan: string[];
  timeline: string[];
  resultDigest: string;
};

type RemoteExecutionResponse = Omit<DialectLabExecution, 'offlinePreview'> & { offlinePreview?: boolean };

function normalizeValue(value: unknown): DialectResultValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Uint8Array) return Array.from(value).join(',');
  return String(value);
}

function normalizeOutput(results: Array<{ columns: string[]; values: unknown[][] }>): DialectLabOutput {
  const last = results.at(-1);
  if (!last) return { columns: [], rows: [] };
  return {
    columns: last.columns.map(column => column.toLowerCase()),
    rows: last.values.map(row => row.map(normalizeValue))
  };
}

function stableOutput(output: DialectLabOutput) {
  return JSON.stringify({ columns: output.columns, rows: output.rows });
}

function digest(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function enforceOutputLimits(output: DialectLabOutput, maximumRows: number, maximumCellBytes: number, maximumResultBytes: number) {
  const errors: string[] = [];
  if (output.rows.length > maximumRows) errors.push(`Результат превышает лимит ${maximumRows} строк.`);
  for (const row of output.rows) {
    for (const cell of row) {
      if (new TextEncoder().encode(cell === null ? 'NULL' : String(cell)).byteLength > maximumCellBytes) {
        errors.push(`Ячейка превышает лимит ${maximumCellBytes} байт.`);
        break;
      }
    }
  }
  if (new TextEncoder().encode(stableOutput(output)).byteLength > maximumResultBytes) {
    errors.push(`Результат превышает лимит ${maximumResultBytes} байт.`);
  }
  return Array.from(new Set(errors));
}

function normalizeSqlitePlan(output: DialectLabOutput) {
  const detailIndex = output.columns.findIndex(column => column === 'detail');
  const details = output.rows.map(row => String(row[detailIndex >= 0 ? detailIndex : row.length - 1] || '').toUpperCase());
  const normalized = new Set<string>();
  for (const detail of details) {
    if (detail.includes('SEARCH')) normalized.add('access=search');
    else if (detail.includes('SCAN')) normalized.add('access=scan');
    const index = detail.match(/USING (?:COVERING )?INDEX ([A-Z0-9_]+)/)?.[1];
    if (index) normalized.add(`index=${index.toLowerCase()}`);
    if (detail.includes('TEMP B-TREE') || detail.includes('ORDER BY')) normalized.add('sort=temporary');
  }
  if (![...normalized].some(item => item.startsWith('sort='))) normalized.add('sort=none');
  return [...normalized].sort();
}

async function executeSqliteSource(source: string, setupSql?: string) {
  const engine = await loadCapstoneSqlRuntime();
  const database = new engine.Database();
  try {
    database.run(trainingSeedSql);
    if (setupSql) database.run(setupSql);
    return normalizeOutput(database.exec(source));
  } finally {
    database.close();
  }
}

function simulationExecution(labId: string, dialect: SqlDialect, sql: string, started: number): DialectLabExecution {
  const manifest = dialectLabManifest(labId);
  const labCase = dialectLabCase(labId, dialect);
  if (!manifest || !labCase) throw new Error('Dialect lab case not found');
  const verdict = evaluateDialectCaseSql(sql, labCase, manifest.statementPolicy);
  const output = { columns: [...labCase.expected.columns], rows: labCase.expected.rows.map(row => [...row]) };
  const serialized = stableOutput(output);
  return {
    version: 1,
    labId,
    dialect,
    executionMode: 'deterministic-simulation',
    passed: verdict.ok,
    evidenceEligible: verdict.ok,
    offlinePreview: false,
    durationMs: Math.max(1, Date.now() - started),
    summary: verdict.ok ? labCase.expected.summary : 'Simulation contract не подтверждён.',
    errors: verdict.errors,
    output,
    normalizedPlan: [...(labCase.expected.normalizedPlan || [])],
    timeline: [...(labCase.expected.timeline || [])],
    resultDigest: digest(`${labId}:${dialect}:${serialized}:${verdict.ok}`)
  };
}

export async function executeLocalDialectLab(labId: string, dialect: SqlDialect, sql: string): Promise<DialectLabExecution> {
  const started = Date.now();
  const manifest = dialectLabManifest(labId);
  const labCase = dialectLabCase(labId, dialect);
  if (!manifest || !labCase) throw new Error('Dialect lab case not found');
  const behavior = manifest.behaviors.find(item => item.dialect === dialect);
  if (!behavior) throw new Error('Dialect behavior not found');
  if (behavior.executionMode === 'deterministic-simulation') return simulationExecution(labId, dialect, sql, started);
  if (dialect !== 'sqlite' || behavior.executionMode !== 'local-sqlite') throw new Error('This dialect requires remote sandbox execution');

  const verdict = evaluateDialectCaseSql(sql, labCase, manifest.statementPolicy);
  if (!verdict.ok) {
    return {
      version: 1,
      labId,
      dialect,
      executionMode: 'local-sqlite',
      passed: false,
      evidenceEligible: false,
      offlinePreview: false,
      durationMs: Math.max(1, Date.now() - started),
      summary: 'SQL остановлен policy/semantic validator до исполнения.',
      errors: verdict.errors,
      output: null,
      normalizedPlan: [],
      timeline: [],
      resultDigest: digest(`${labId}:${dialect}:policy-failed`)
    };
  }

  try {
    const [output, reference] = await Promise.all([
      executeSqliteSource(sql, labCase.setupSql),
      executeSqliteSource(labCase.referenceSql, labCase.setupSql)
    ]);
    const outputErrors = enforceOutputLimits(
      output,
      manifest.statementPolicy.maximumRows,
      manifest.statementPolicy.maximumCellBytes,
      manifest.statementPolicy.maximumResultBytes
    );
    const elapsed = Date.now() - started;
    if (elapsed > manifest.statementPolicy.timeoutMs) outputErrors.push(`Execution превысил soft timeout ${manifest.statementPolicy.timeoutMs} ms.`);
    const normalizedPlan = manifest.kind === 'plan' ? normalizeSqlitePlan(output) : [];
    const referencePlan = manifest.kind === 'plan' ? normalizeSqlitePlan(reference) : [];
    const equal = manifest.kind === 'plan'
      ? JSON.stringify(normalizedPlan) === JSON.stringify(referencePlan)
      : stableOutput(output) === stableOutput(reference);
    const passed = equal && outputErrors.length === 0;
    const serialized = stableOutput(output);
    return {
      version: 1,
      labId,
      dialect,
      executionMode: 'local-sqlite',
      passed,
      evidenceEligible: passed,
      offlinePreview: false,
      durationMs: Math.max(1, elapsed),
      summary: passed ? labCase.expected.summary : 'Результат не совпал с semantic contract.',
      errors: [...outputErrors, ...(equal ? [] : ['Result/plan contract отличается от reference evidence.'])],
      output,
      normalizedPlan,
      timeline: [],
      resultDigest: digest(`${labId}:${dialect}:${serialized}:${normalizedPlan.join('|')}`)
    };
  } catch (error) {
    return {
      version: 1,
      labId,
      dialect,
      executionMode: 'local-sqlite',
      passed: false,
      evidenceEligible: false,
      offlinePreview: false,
      durationMs: Math.max(1, Date.now() - started),
      summary: 'SQLite execution завершилось ошибкой.',
      errors: [error instanceof Error ? error.message : String(error)],
      output: null,
      normalizedPlan: [],
      timeline: [],
      resultDigest: digest(`${labId}:${dialect}:runtime-error`)
    };
  }
}

export async function executeRemoteDialectLab(labId: string, dialect: Exclude<SqlDialect, 'sqlite'>, sql: string): Promise<DialectLabExecution> {
  const started = Date.now();
  try {
    const response = await fetch('/api/dialect-labs/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, labId, dialect, sql })
    });
    const payload = await response.json() as RemoteExecutionResponse & { error?: string };
    if (!response.ok) throw new Error(payload.error || `Remote sandbox HTTP ${response.status}`);
    return { ...payload, offlinePreview: Boolean(payload.offlinePreview) };
  } catch (error) {
    const manifest = dialectLabManifest(labId);
    const labCase = dialectLabCase(labId, dialect);
    if (!manifest || !labCase) throw error;
    const verdict = evaluateDialectCaseSql(sql, labCase, manifest.statementPolicy);
    const output = { columns: [...labCase.expected.columns], rows: labCase.expected.rows.map(row => [...row]) };
    return {
      version: 1,
      labId,
      dialect,
      executionMode: 'remote-sandbox',
      passed: false,
      evidenceEligible: false,
      offlinePreview: true,
      durationMs: Math.max(1, Date.now() - started),
      summary: verdict.ok
        ? 'Offline preview: semantic markers выглядят корректно, но remote engine evidence не получен.'
        : 'Offline preview обнаружил проблемы; remote engine evidence недоступен.',
      errors: [...verdict.errors, error instanceof Error ? error.message : String(error)],
      output,
      normalizedPlan: [...(labCase.expected.normalizedPlan || [])],
      timeline: [...(labCase.expected.timeline || [])],
      resultDigest: digest(`${labId}:${dialect}:offline-preview`)
    };
  }
}
