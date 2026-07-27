import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { dialectLabCases, dialectLabCase, type DialectResultValue } from '../src/data/dialect-lab-cases.ts';
import { dialectLabManifests, type SqlDialect } from '../src/data/dialect-lab-manifests.ts';
import { evaluateDialectCaseSql, validateDialectSqlPolicy } from '../src/lib/dialect-lab-policy.ts';
import {
  dialectLabCompletion,
  emptyDialectLabProgress,
  mergeDialectLabProgress,
  recordDialectLabExecution
} from '../src/lib/dialect-lab-progress.ts';
import { trainingSeedSql } from '../src/data/training-dataset.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });
const dialects: SqlDialect[] = ['sqlite', 'postgresql', 'mysql'];

function executeSqlite(source: string, setupSql?: string) {
  const database = new SQL.Database();
  try {
    database.run(trainingSeedSql);
    if (setupSql) database.run(setupSql);
    return database.exec(source);
  } finally {
    database.close();
  }
}

function normalizeValue(value: unknown): DialectResultValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Uint8Array) return Array.from(value).join(',');
  return String(value);
}

function normalizedLastResult(results: ReturnType<typeof executeSqlite>) {
  const last = results.at(-1);
  return {
    columns: (last?.columns || []).map(column => column.toLowerCase()),
    rows: (last?.values || []).map(row => row.map(normalizeValue))
  };
}

assert(dialectLabManifests.length === 6, `Expected 6 published dialect labs, got ${dialectLabManifests.length}`);
assert(dialectLabCases.length === dialectLabManifests.length * dialects.length, 'Every lab must publish one case per executable dialect');
assert(new Set(dialectLabManifests.map(lab => lab.id)).size === dialectLabManifests.length, 'Dialect lab IDs must be unique');
assert(new Set(dialectLabCases.map(item => `${item.labId}:${item.dialect}`)).size === dialectLabCases.length, 'Dialect case keys must be unique');

for (const lab of dialectLabManifests) {
  assert(lab.version === 1, `${lab.id}: unsupported manifest version`);
  assert(lab.dataset.containsPersonalData === false, `${lab.id}: dataset must be explicitly privacy-safe`);
  assert(lab.dataset.tables.length >= 2, `${lab.id}: dataset contract is too narrow`);
  assert(lab.statementPolicy.maximumStatements >= 1 && lab.statementPolicy.maximumStatements <= 10, `${lab.id}: unsafe statement ceiling`);
  assert(lab.statementPolicy.timeoutMs >= 500 && lab.statementPolicy.timeoutMs <= 5_000, `${lab.id}: timeout outside bounded range`);
  assert(lab.statementPolicy.maximumRows <= 200, `${lab.id}: row ceiling exceeds 200`);
  assert(lab.statementPolicy.maximumResultBytes <= 256_000, `${lab.id}: result ceiling is too large`);
  assert(lab.productionFailureMode.length >= 70, `${lab.id}: production failure mode is too vague`);
  assert(lab.portabilityChallenge.equivalenceInvariants.length >= 3, `${lab.id}: portability contract needs at least three invariants`);
  assert(lab.evidence.minimumPassingDialects === 3, `${lab.id}: all three executable dialects must pass`);
  assert(JSON.stringify([...lab.portabilityChallenge.requiredDialects].sort()) === JSON.stringify([...dialects].sort()), `${lab.id}: required dialect coverage changed`);
  assert(lab.behaviors.length === 3, `${lab.id}: expected three engine behaviors`);

  for (const dialect of dialects) {
    const behavior = lab.behaviors.find(item => item.dialect === dialect);
    const labCase = dialectLabCase(lab.id, dialect);
    assert(Boolean(behavior), `${lab.id}:${dialect}: missing behavior`);
    assert(Boolean(labCase), `${lab.id}:${dialect}: missing executable case`);
    if (!behavior || !labCase) continue;
    assert(labCase.starterSql.trim() !== labCase.referenceSql.trim(), `${lab.id}:${dialect}: starter exposes reference solution`);
    assert(labCase.requiredPatterns.length >= 3, `${lab.id}:${dialect}: semantic markers are too weak`);
    const reference = evaluateDialectCaseSql(labCase.referenceSql, labCase, lab.statementPolicy);
    assert(reference.ok, `${lab.id}:${dialect}: reference rejected: ${reference.errors.join(' | ')}`);
    const starter = evaluateDialectCaseSql(labCase.starterSql, labCase, lab.statementPolicy);
    assert(!starter.ok, `${lab.id}:${dialect}: unfinished starter unexpectedly passes`);
    if (dialect === 'sqlite' && behavior.executionMode === 'local-sqlite') {
      try {
        const result = executeSqlite(labCase.referenceSql, labCase.setupSql);
        assert(result.length > 0, `${lab.id}: SQLite reference produced no result block`);
        const normalized = normalizedLastResult(result);
        assert(normalized.columns.length > 0, `${lab.id}: SQLite reference produced no columns`);
        assert(normalized.rows.length <= lab.statementPolicy.maximumRows, `${lab.id}: SQLite reference exceeds row ceiling`);
        if (lab.kind !== 'plan') {
          const expected = {
            columns: [...labCase.expected.columns],
            rows: labCase.expected.rows.map(row => [...row])
          };
          assert(JSON.stringify(normalized) === JSON.stringify(expected), `${lab.id}: SQLite fixture mismatch\nactual=${JSON.stringify(normalized)}\nexpected=${JSON.stringify(expected)}`);
        } else {
          const details = normalized.rows.map(row => String(row.at(-1) || '').toUpperCase()).join(' ');
          assert(/SEARCH|SCAN/.test(details), `${lab.id}: SQLite EXPLAIN result has no access-path evidence`);
        }
      } catch (error) {
        failures.push(`${lab.id}: SQLite reference failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

const readOnly = dialectLabManifests[0].statementPolicy;
assert(validateDialectSqlPolicy("SELECT '-- DROP TABLE tickets' AS sample;", readOnly).ok, 'Quoted deny text must not trigger policy rejection');
assert(validateDialectSqlPolicy('SELECT 1 /* DROP TABLE tickets; */;', readOnly).ok, 'Commented deny text must not trigger policy rejection');
assert(validateDialectSqlPolicy('SELECT 1; -- ordinary EOF comment', readOnly).ok, 'EOF line comment must be treated as terminated');
assert(!validateDialectSqlPolicy('SELECT 1; DROP TABLE tickets;', readOnly).ok, 'Second unsafe statement bypassed policy');
assert(!validateDialectSqlPolicy('SELECT SLEEP(10);', readOnly).ok, 'SLEEP abuse bypassed denylist');
assert(!validateDialectSqlPolicy('SELECT PG_SLEEP(10);', readOnly).ok, 'PG_SLEEP abuse bypassed global denylist');
assert(!validateDialectSqlPolicy("SELECT LOAD_FILE('/etc/passwd');", readOnly).ok, 'LOAD_FILE escape bypassed global denylist');
assert(!validateDialectSqlPolicy("SELECT 'x' INTO DUMPFILE '/tmp/x';", readOnly).ok, 'INTO DUMPFILE escape bypassed global denylist');
assert(!validateDialectSqlPolicy('ATTACH DATABASE \'x\' AS x;', readOnly).ok, 'ATTACH abuse bypassed denylist');
assert(!validateDialectSqlPolicy('SELECT 1 /* unterminated', readOnly).ok, 'Unterminated block comment bypassed parser');
assert(validateDialectSqlPolicy('WITH x AS (SELECT 1 AS id) SELECT id FROM x;', readOnly).ok, 'Safe CTE was rejected');
assert(!validateDialectSqlPolicy('WITH removed AS (DELETE FROM tickets RETURNING ticket_id) SELECT * FROM removed;', readOnly).ok, 'DML hidden inside a read-only CTE bypassed policy');
assert(!validateDialectSqlPolicy("WITH changed AS (UPDATE tickets SET priority = 'High' RETURNING ticket_id) SELECT * FROM changed;", readOnly).ok, 'UPDATE hidden inside a read-only CTE bypassed policy');

const userId = '12345678-1234-4234-9234-123456789abc';
let progress = emptyDialectLabProgress(userId);
for (const dialect of dialects) {
  progress = recordDialectLabExecution(progress, {
    version: 1,
    labId: dialectLabManifests[0].id,
    dialect,
    executionMode: dialect === 'sqlite' ? 'local-sqlite' : 'remote-sandbox',
    passed: true,
    evidenceEligible: true,
    offlinePreview: false,
    durationMs: 120,
    summary: 'passed',
    errors: [],
    output: { columns: ['ok'], rows: [[1]] },
    normalizedPlan: [],
    timeline: [],
    resultDigest: 'fnv1a-1234abcd'
  }, true);
}
assert(dialectLabCompletion(progress, dialectLabManifests[0].id).complete, 'Three independent engine passes must complete a lab');
const offline = recordDialectLabExecution(progress, {
  version: 1,
  labId: dialectLabManifests[1].id,
  dialect: 'postgresql',
  executionMode: 'remote-sandbox',
  passed: false,
  evidenceEligible: false,
  offlinePreview: true,
  durationMs: 10,
  summary: 'preview',
  errors: ['offline'],
  output: null,
  normalizedPlan: [],
  timeline: [],
  resultDigest: 'fnv1a-deadbeef'
}, true);
assert(!dialectLabCompletion(offline, dialectLabManifests[1].id).complete, 'Offline preview must never create completion evidence');
const stale = emptyDialectLabProgress(userId);
const merged = mergeDialectLabProgress(progress, stale);
assert(dialectLabCompletion(merged, dialectLabManifests[0].id).complete, 'Stale cross-device merge regressed passed evidence');

const migration = readFileSync(new URL('../migrations/0016_dialect_lab_progress.sql', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/dialect-labs.ts', import.meta.url), 'utf8');
const indexWorker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const realRoute = readFileSync(new URL('../worker/dialect-real-engine-route.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../worker/dialect-real-engine.ts', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../containers/dialect-engines/runner.mjs', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../containers/dialect-engines/Dockerfile', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/cloudflare.yml', import.meta.url), 'utf8');
const productionSmoke = readFileSync(new URL('./dialect-labs-production-smoke.mjs', import.meta.url), 'utf8');

assert(/REFERENCES\s+users\s*\(\s*user_id\s*\)\s+ON DELETE CASCADE/i.test(migration), 'Dialect progress must cascade with account deletion');
assert(!/\bsql\s+TEXT\b/i.test(migration), 'Dialect progress schema must not store learner SQL');
assert(worker.includes("'/api/dialect-labs/execute'"), 'Fallback Worker execute route is missing');
assert(worker.includes('HOURLY_EXECUTION_LIMIT = 120'), 'Fallback sandbox rate limit is missing');
assert(worker.includes('validateDialectSqlPolicy'), 'Fallback Worker is not using the shared policy scanner');
assert(worker.includes("sandboxModelVersion: 'dialect-sandbox-v1'"), 'Fallback contract sandbox version is not explicit');
assert(indexWorker.includes('handleDialectRealEngineRequest'), 'Canonical Worker pipeline does not route real dialect execution');
assert(indexWorker.includes("export { Sandbox } from '@cloudflare/sandbox'"), 'Canonical Worker does not export the Sandbox Durable Object');
assert(!indexWorker.includes('index-real-engines'), 'Canonical Worker still depends on the deleted wrapper entrypoint');
assert(realRoute.includes('DIALECT_REAL_ENGINE_RUNNER_VERSION'), 'Real route does not bind evidence to the runner contract');
assert(realRoute.includes('sandboxDestroyed'), 'Real route does not publish destroy evidence');
assert(realRoute.includes('dialect-sandbox-v1'), 'Real route must preserve the v1 evidence digest contract');
assert(adapter.includes("transport: 'rpc'"), 'Sandbox adapter is not pinned to RPC transport');
assert(adapter.includes('enableDefaultSession: false'), 'Sandbox adapter still permits implicit default sessions');
assert(adapter.includes('file.content'), 'Sandbox adapter does not use the current readFile result contract');
assert(adapter.includes('await sandbox.destroy()'), 'Sandbox adapter does not unconditionally destroy attempts');
assert(adapter.includes('passed: outcome.passed && destroyed'), 'Sandbox destroy is not a prerequisite for eligible evidence');
assert(runner.includes("commandPath('mysqld')"), 'Runner does not start Oracle MySQL');
assert(runner.includes('--initialize-insecure'), 'Runner does not initialize an ephemeral MySQL data directory');
assert(!/mariadb/i.test(runner), 'Runner still contains MariaDB runtime code');
assert(dockerfile.includes('mysql-8.4-lts'), 'Container image is not sourced from the official MySQL 8.4 LTS repository');
assert(dockerfile.includes('mysql-community-server-core'), 'Container image does not install Oracle MySQL server core');
assert(!/mariadb-(client|server)/i.test(dockerfile), 'Container image still substitutes MariaDB for MySQL');
assert(wrangler.includes('"nodejs_compat"'), 'Wrangler config is missing nodejs_compat');
assert(wrangler.includes('"SANDBOX_TRANSPORT": "rpc"'), 'Wrangler config is missing RPC transport');
assert(workflow.includes("main: 'worker/index.ts'"), 'Production workflow does not deploy the canonical Worker entrypoint');
assert(workflow.includes("SANDBOX_TRANSPORT: 'rpc'"), 'Production workflow is missing RPC transport');
assert(productionSmoke.includes("['postgresql', 'mysql']"), 'Production smoke does not exercise both real engines');
assert(productionSmoke.includes("verificationMode !== 'real-engine-v1'"), 'Production smoke does not verify the real adapter contract');
assert(productionSmoke.includes('sandboxDestroyed !== true'), 'Production smoke does not prove destroy cleanup');
assert(!/console\.(log|error)\([^\n]*\bsql\b/i.test(worker + realRoute + adapter), 'Worker appears to log learner SQL');

if (failures.length) {
  console.error(`Dialect lab validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Dialect lab validation passed: ${dialectLabManifests.length} labs, ${dialectLabCases.length} engine cases, exact SQLite fixtures, hidden-DML/escape policy, canonical RPC adapter, Oracle MySQL image, production lifecycle evidence and D1 privacy contract.`);
