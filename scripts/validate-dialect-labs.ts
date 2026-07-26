import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { dialectLabCases, dialectLabCase } from '../src/data/dialect-lab-cases.ts';
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
        const last = result.at(-1);
        assert(Boolean(last?.columns.length), `${lab.id}: SQLite reference produced no columns`);
        assert((last?.values.length || 0) <= lab.statementPolicy.maximumRows, `${lab.id}: SQLite reference exceeds row ceiling`);
      } catch (error) {
        failures.push(`${lab.id}: SQLite reference failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

const readOnly = dialectLabManifests[0].statementPolicy;
assert(validateDialectSqlPolicy("SELECT '-- DROP TABLE tickets' AS sample;", readOnly).ok, 'Quoted deny text must not trigger policy rejection');
assert(validateDialectSqlPolicy('SELECT 1 /* DROP TABLE tickets; */;', readOnly).ok, 'Commented deny text must not trigger policy rejection');
assert(!validateDialectSqlPolicy('SELECT 1; DROP TABLE tickets;', readOnly).ok, 'Second unsafe statement bypassed policy');
assert(!validateDialectSqlPolicy('SELECT SLEEP(10);', readOnly).ok, 'SLEEP abuse bypassed denylist');
assert(!validateDialectSqlPolicy('ATTACH DATABASE \'x\' AS x;', readOnly).ok, 'ATTACH abuse bypassed denylist');
assert(!validateDialectSqlPolicy('SELECT 1 /* unterminated', readOnly).ok, 'Unterminated block comment bypassed parser');
assert(validateDialectSqlPolicy('WITH x AS (SELECT 1 AS id) SELECT id FROM x;', readOnly).ok, 'Safe CTE was rejected');

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
assert(/REFERENCES\s+users\s*\(\s*user_id\s*\)\s+ON DELETE CASCADE/i.test(migration), 'Dialect progress must cascade with account deletion');
assert(!/\bsql\s+TEXT\b/i.test(migration), 'Dialect progress schema must not store learner SQL');
assert(worker.includes("'/api/dialect-labs/execute'"), 'Worker execute route is missing');
assert(worker.includes('HOURLY_EXECUTION_LIMIT = 120'), 'Sandbox rate limit is missing');
assert(worker.includes('validateDialectSqlPolicy'), 'Worker is not using the shared policy scanner');
assert(!/console\.(log|error)\([^\n]*\bsql\b/i.test(worker), 'Worker appears to log learner SQL');

if (failures.length) {
  console.error(`Dialect lab validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Dialect lab validation passed: ${dialectLabManifests.length} labs, ${dialectLabCases.length} engine cases, SQLite execution, policy abuse, evidence merge and D1 privacy contract.`);
