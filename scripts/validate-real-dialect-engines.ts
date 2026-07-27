import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dialectLabCase, type DialectResultValue } from '../src/data/dialect-lab-cases.ts';
import { dialectLabManifest } from '../src/data/dialect-lab-manifests.ts';
import { realEngineContracts } from '../worker/dialect-real-engine-contracts.ts';

const image = process.env.DIALECT_ENGINE_IMAGE || 'sql-academy-dialect-engines:pr';
const runner = '/opt/sql-academy-dialect-runner/runner.mjs';
const failures: string[] = [];

type RunnerResult = {
  version?: unknown;
  runnerVersion?: unknown;
  engine?: unknown;
  serverVersion?: unknown;
  success?: unknown;
  durationMs?: unknown;
  output?: { columns?: unknown; rows?: unknown };
  errorCode?: unknown;
  error?: unknown;
};

function normalizedTimestamp(value: string) {
  return value.replace('T', ' ').replace(/(?:\.0+)?(?:\+00(?::00)?|Z)$/, '').trim();
}

function cellsEqual(actual: unknown, expected: DialectResultValue) {
  if (actual === expected) return true;
  if (typeof actual === 'boolean' && typeof expected === 'number') return Number(actual) === expected;
  if (typeof actual === 'string' && typeof expected === 'string') return normalizedTimestamp(actual) === normalizedTimestamp(expected);
  if (typeof actual === 'string' && typeof expected === 'number') return Number(actual) === expected;
  if (typeof actual === 'number' && typeof expected === 'string') return actual === Number(expected);
  return false;
}

function exactOutput(actual: { columns?: unknown; rows?: unknown }, expected: { columns: readonly string[]; rows: readonly (readonly DialectResultValue[])[] }) {
  if (!Array.isArray(actual.columns) || !Array.isArray(actual.rows)) return false;
  if (actual.columns.length !== expected.columns.length || actual.rows.length !== expected.rows.length) return false;
  if (!actual.columns.every((column, index) => String(column).toLowerCase() === expected.columns[index].toLowerCase())) return false;
  return actual.rows.every((row, rowIndex) => Array.isArray(row)
    && row.length === expected.rows[rowIndex].length
    && row.every((cell, columnIndex) => cellsEqual(cell, expected.rows[rowIndex][columnIndex])));
}

function planMatches(dialect: 'postgresql' | 'mysql', output: { rows?: unknown }) {
  if (!Array.isArray(output.rows)) return false;
  const raw = output.rows.flat().find(value => typeof value === 'string' && (value.trim().startsWith('[') || value.trim().startsWith('{')));
  if (typeof raw !== 'string') return false;
  try {
    const serialized = JSON.stringify(JSON.parse(raw)).toLowerCase();
    if (!serialized.includes('idx_tickets_service')) return false;
    if (dialect === 'postgresql') return serialized.includes('index scan') || serialized.includes('bitmap index scan');
    return /"access_type"\s*:\s*"(?:ref|range|const)"/.test(serialized);
  } catch {
    return false;
  }
}

function runContainer(directory: string) {
  const shell = `node ${runner} /workspace/request.json /workspace/result.json; status=$?; cat /workspace/result.json; exit $status`;
  try {
    return execFileSync('docker', [
      'run', '--rm', '--platform', 'linux/amd64',
      '--entrypoint', 'sh',
      '--mount', `type=bind,source=${directory},target=/workspace`,
      image, '-lc', shell
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 });
  } catch (error) {
    const output = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout || '') : '';
    if (output.trim()) return output;
    throw error;
  }
}

function executeContract(contract: (typeof realEngineContracts)[number]) {
  const manifest = dialectLabManifest(contract.labId);
  const labCase = dialectLabCase(contract.labId, contract.dialect);
  if (!manifest || !labCase) throw new Error('Published manifest/case is missing');

  const directory = mkdtempSync(join(tmpdir(), `sql-academy-${contract.dialect}-`));
  try {
    const request = {
      version: 1,
      requestId: crypto.randomUUID(),
      engine: contract.dialect,
      mode: contract.scenario,
      transactionKind: contract.transactionKind,
      setupSql: contract.setupSql,
      learnerSql: labCase.referenceSql,
      verificationSql: contract.verificationSql,
      timeoutMs: manifest.statementPolicy.timeoutMs,
      maximumRows: manifest.statementPolicy.maximumRows,
      maximumCellBytes: manifest.statementPolicy.maximumCellBytes,
      maximumResultBytes: manifest.statementPolicy.maximumResultBytes
    };
    writeFileSync(join(directory, 'request.json'), JSON.stringify(request), { mode: 0o644 });
    const result = JSON.parse(runContainer(directory)) as RunnerResult;
    if (result.version !== 1 || result.runnerVersion !== 'dialect-real-engine-v1' || result.engine !== contract.dialect || result.success !== true) {
      throw new Error(`runner failure: ${JSON.stringify(result)}`);
    }
    if (typeof result.serverVersion !== 'string' || !/\d+\.\d+/.test(result.serverVersion)) throw new Error('engine version is missing');
    if (contract.dialect === 'mysql' && !/^8\.4(?:\.|$)/.test(result.serverVersion)) throw new Error(`expected MySQL 8.4, got ${result.serverVersion}`);
    if (typeof result.durationMs !== 'number' || result.durationMs < 1 || result.durationMs > 60_000) throw new Error('duration is outside the integration budget');
    if (!result.output) throw new Error('runner output is missing');
    const passed = manifest.kind === 'plan'
      ? planMatches(contract.dialect, result.output)
      : exactOutput(result.output, labCase.expected);
    if (!passed) throw new Error(`semantic output mismatch: ${JSON.stringify(result.output)}`);
    return result.serverVersion;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const versions = new Map<string, string>();
for (const contract of realEngineContracts) {
  const key = `${contract.labId}:${contract.dialect}`;
  try {
    const version = executeContract(contract);
    versions.set(contract.dialect, version);
    console.log(`PASS ${key} (${version})`);
  } catch (error) {
    failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error(`Real dialect engine integration failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Real dialect engine integration passed: ${realEngineContracts.length} isolated PostgreSQL/MySQL contracts across ${new Set(realEngineContracts.map(item => item.labId)).size} labs; PostgreSQL ${versions.get('postgresql')}, MySQL ${versions.get('mysql')}.`);
