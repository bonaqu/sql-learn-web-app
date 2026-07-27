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
import { realEngineContracts } from '../worker/dialect-real-engine-contracts.ts';

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

assert(dialectLabManifests.length === 11, `Expected 11 published dialect labs, got ${dialectLabManifests.length}`);
assert(dialectLabCases.length === 33, `Expected 33 executable dialect cases, got ${dialectLabCases.length}`);
assert(dialectLabCases.length === dialectLabManifests.length * dialects.length, 'Every lab must publish one case per dialect');
assert(realEngineContracts.length === dialectLabManifests.length * 2, 'Every lab must retain PostgreSQL and MySQL real-engine CI contracts');
assert(new Set(dialectLabManifests.map(lab => lab.id)).size === dialectLabManifests.length, 'Dialect lab IDs must be unique');
assert(new Set(dialectLabCases.map(item => `${item.labId}:${item.dialect}`)).size === dialectLabCases.length, 'Dialect case keys must be unique');
assert(new Set(realEngineContracts.map(item => `${item.labId}:${item.dialect}`)).size === realEngineContracts.length, 'Real-engine contract keys must be unique');

for (const lab of dialectLabManifests) {
  assert(lab.version === 1, `${lab.id}: unsupported manifest version`);
  assert(lab.dataset.containsPersonalData === false, `${lab.id}: dataset must be privacy-safe`);
  assert(lab.dataset.tables.length >= 2, `${lab.id}: dataset contract is too narrow`);
  assert(lab.statementPolicy.maximumStatements >= 1 && lab.statementPolicy.maximumStatements <= 10, `${lab.id}: unsafe statement ceiling`);
  assert(lab.statementPolicy.timeoutMs >= 500 && lab.statementPolicy.timeoutMs <= 5_000, `${lab.id}: timeout outside bounded range`);
  assert(lab.statementPolicy.maximumRows <= 200, `${lab.id}: row ceiling exceeds 200`);
  assert(lab.statementPolicy.maximumResultBytes <= 256_000, `${lab.id}: result ceiling is too large`);
  assert(lab.productionFailureMode.length >= 70, `${lab.id}: production failure mode is too vague`);
  assert(lab.portabilityChallenge.equivalenceInvariants.length >= 3, `${lab.id}: portability contract needs three invariants`);
  assert(lab.evidence.minimumPassingDialects === 3, `${lab.id}: completion still requires three independently verified dialects`);
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

    if (dialect !== 'sqlite') {
      const contract = realEngineContracts.find(item => item.labId === lab.id && item.dialect === dialect);
      assert(Boolean(contract), `${lab.id}:${dialect}: missing real-engine CI fixture`);
      if (lab.kind === 'transaction') assert(Boolean(contract?.transactionKind), `${lab.id}:${dialect}: transaction kind is not explicit`);
    }

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
          assert(/SEARCH|SCAN/.test(details), `${lab.id}: SQLite EXPLAIN has no access-path evidence`);
        }
      } catch (error) {
        failures.push(`${lab.id}: SQLite reference failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

const readOnly = dialectLabManifests[0].statementPolicy;
assert(validateDialectSqlPolicy("SELECT '-- DROP TABLE tickets' AS sample;", readOnly).ok, 'Quoted deny text must not trigger rejection');
assert(validateDialectSqlPolicy('SELECT 1 /* DROP TABLE tickets; */;', readOnly).ok, 'Commented deny text must not trigger rejection');
assert(validateDialectSqlPolicy('SELECT 1; -- ordinary EOF comment', readOnly).ok, 'EOF line comment must terminate');
assert(!validateDialectSqlPolicy('SELECT 1; DROP TABLE tickets;', readOnly).ok, 'Second unsafe statement bypassed policy');
assert(!validateDialectSqlPolicy('SELECT SLEEP(10);', readOnly).ok, 'SLEEP abuse bypassed denylist');
assert(!validateDialectSqlPolicy('SELECT PG_SLEEP(10);', readOnly).ok, 'PG_SLEEP abuse bypassed global denylist');
assert(!validateDialectSqlPolicy("SELECT LOAD_FILE('/etc/passwd');", readOnly).ok, 'LOAD_FILE bypassed denylist');
assert(!validateDialectSqlPolicy("SELECT 'x' INTO DUMPFILE '/tmp/x';", readOnly).ok, 'DUMPFILE bypassed denylist');
assert(!validateDialectSqlPolicy("ATTACH DATABASE 'x' AS x;", readOnly).ok, 'ATTACH bypassed denylist');
assert(!validateDialectSqlPolicy('SELECT 1 /* unterminated', readOnly).ok, 'Unterminated comment bypassed parser');
assert(validateDialectSqlPolicy('WITH x AS (SELECT 1 AS id) SELECT id FROM x;', readOnly).ok, 'Safe CTE was rejected');
assert(!validateDialectSqlPolicy('WITH removed AS (DELETE FROM tickets RETURNING ticket_id) SELECT * FROM removed;', readOnly).ok, 'DML hidden in CTE bypassed policy');
assert(!validateDialectSqlPolicy("WITH changed AS (UPDATE tickets SET priority = 'High' RETURNING ticket_id) SELECT * FROM changed;", readOnly).ok, 'UPDATE hidden in CTE bypassed policy');

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
const preview = recordDialectLabExecution(progress, {
  version: 1,
  labId: dialectLabManifests[1].id,
  dialect: 'postgresql',
  executionMode: 'remote-sandbox',
  passed: false,
  evidenceEligible: false,
  offlinePreview: true,
  durationMs: 10,
  summary: 'CI reference preview',
  errors: [],
  output: null,
  normalizedPlan: [],
  timeline: [],
  resultDigest: 'fnv1a-deadbeef'
}, true);
assert(!dialectLabCompletion(preview, dialectLabManifests[1].id).complete, 'Reference preview must never create completion evidence');
const merged = mergeDialectLabProgress(progress, emptyDialectLabProgress(userId));
assert(dialectLabCompletion(merged, dialectLabManifests[0].id).complete, 'Stale cross-device merge regressed real evidence');

const migration = readFileSync(new URL('../migrations/0016_dialect_lab_progress.sql', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/dialect-labs.ts', import.meta.url), 'utf8');
const indexWorker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const realRoute = readFileSync(new URL('../worker/dialect-real-engine-route.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../worker/dialect-real-engine.ts', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../containers/dialect-engines/runner.mjs', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../containers/dialect-engines/Dockerfile', import.meta.url), 'utf8');
const freeWrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const paidWrangler = readFileSync(new URL('../wrangler.real-engines.jsonc', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/cloudflare.yml', import.meta.url), 'utf8');
const freeProductionSmoke = readFileSync(new URL('./dialect-labs-free-production-smoke.ts', import.meta.url), 'utf8');
const qualityWorkflow = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

assert(/REFERENCES\s+users\s*\(\s*user_id\s*\)\s+ON DELETE CASCADE/i.test(migration), 'Dialect progress must cascade with account deletion');
assert(!/\bsql\s+TEXT\b/i.test(migration), 'Dialect progress schema must not store learner SQL');
assert(worker.includes("PREVIEW_VERIFICATION_MODE = 'ci-reference-preview-v1'"), 'Free fallback preview version is not explicit');
assert(worker.includes('passed: false'), 'Free server-dialect preview can still claim a pass');
assert(worker.includes('evidenceEligible: false'), 'Free server-dialect preview can still create mastery evidence');
assert(worker.includes('offlinePreview: true'), 'Free server-dialect response is not marked preview-only');
assert(worker.includes('ciVerifiedReference: true'), 'Preview does not disclose its CI-verified reference origin');
assert(worker.includes('dialectLabManifests.reduce'), 'Progress evidence ceiling is not derived from manifests');
assert(worker.includes('validateDialectSqlPolicy'), 'Preview route is not using the shared SQL policy');
assert(worker.includes('monotonicProgress'), 'Historical real evidence is not protected from regression');
assert(indexWorker.includes('handleDialectRealEngineRequest'), 'Optional paid real-engine route disappeared');
assert(realRoute.includes('DIALECT_REAL_ENGINE_RUNNER_VERSION'), 'Paid route does not bind evidence to the runner version');
assert(realRoute.includes('sandboxDestroyed'), 'Paid route does not publish destroy evidence');
assert(adapter.includes("transport: 'rpc'"), 'Paid adapter is not pinned to RPC');
assert(adapter.includes('enableDefaultSession: false'), 'Paid adapter permits implicit sessions');
assert(adapter.includes('file.content'), 'Paid adapter uses the wrong readFile contract');
assert(adapter.includes('await sandbox.destroy()'), 'Paid adapter does not destroy attempts');
assert(adapter.includes('passed: outcome.passed && destroyed'), 'Destroy is not required for paid evidence');
assert(runner.includes("commandPath('mysqld')"), 'CI runner does not start Oracle MySQL');
assert(runner.includes('--initialize-insecure'), 'CI runner does not initialize ephemeral MySQL');
assert(!/mariadb/i.test(runner), 'CI runner still substitutes MariaDB');
assert(runner.includes('class InteractiveSession'), 'CI runner lacks independent sessions');
assert(runner.includes("request.transactionKind === 'optimistic-conflict'"), 'CI runner lacks lost-update scenario');
assert(runner.includes("request.transactionKind === 'skip-locked'"), 'CI runner lacks queue locking scenario');
assert(runner.includes('POSTGRES_NULL_MARKER'), 'CI runner does not preserve PostgreSQL NULL');
assert(dockerfile.includes('mysql-8.4-lts'), 'CI image does not use Oracle MySQL 8.4 LTS');
assert(dockerfile.includes('RPM-GPG-KEY-mysql-2025'), 'CI image does not use the current MySQL signing key');
assert(dockerfile.includes('BCA43417C3B485DD128EC6D4B7B3B788A8D3785C'), 'CI image does not pin the MySQL key fingerprint');

assert(freeWrangler.includes('"DIALECT_ENGINE_MODE": "preview-only"'), 'Default Wrangler mode is not free-tier preview-only');
assert(!freeWrangler.includes('"containers"'), 'Default Wrangler config still requires paid Containers');
assert(!freeWrangler.includes('"durable_objects"'), 'Default Wrangler config still requires a paid Sandbox Durable Object');
assert(paidWrangler.includes('"containers"'), 'Optional paid real-engine profile was lost');
assert(paidWrangler.includes('"DIALECT_ENGINE_MODE": "real-required"'), 'Optional paid profile is not strict');
assert(paidWrangler.includes('"SANDBOX_TRANSPORT": "rpc"'), 'Optional paid profile is missing RPC');
assert(workflow.includes('Deploy Cloudflare Free Stack'), 'Production workflow is not explicitly free-tier');
assert(workflow.includes("DIALECT_ENGINE_MODE: 'preview-only'"), 'Production workflow is not preview-only');
assert(workflow.includes('npx tsx scripts/dialect-labs-free-production-smoke.ts'), 'Production workflow does not run free-tier dialect smoke');
assert(!workflow.includes('containers:'), 'Production workflow still generates paid Containers');
assert(!workflow.includes('Dockerfile'), 'Production workflow still builds or pushes the Container image');
assert(!workflow.includes('SANDBOX_TRANSPORT'), 'Production workflow still configures Sandbox transport');
assert(qualityWorkflow.includes('Run all PostgreSQL and MySQL contracts'), 'PR quality no longer executes real server engines');
assert(qualityWorkflow.includes('validate:real-dialect-engines'), 'PR quality lost the 22-contract integration gate');
assert(freeProductionSmoke.includes("const SERVER_DIALECTS = ['postgresql', 'mysql'] as const"), 'Free smoke does not cover both server dialects');
assert(freeProductionSmoke.includes('for (const lab of dialectLabManifests)'), 'Free smoke does not iterate all labs');
assert(freeProductionSmoke.includes("value.verificationMode !== 'ci-reference-preview-v1'"), 'Free smoke does not verify preview provenance');
assert(freeProductionSmoke.includes('value.evidenceEligible !== false'), 'Free smoke does not forbid mastery evidence');
assert(freeProductionSmoke.includes('allPublishedPatternsPreviewed: true'), 'Free smoke lacks complete matrix evidence');
assert(freeProductionSmoke.includes('masteryEvidenceCreated: false'), 'Free smoke lacks zero-mastery summary');
assert(freeProductionSmoke.includes('verifyCascade()'), 'Free smoke does not verify D1 cascade');
assert(!/console\.(log|error)\([^\n]*\bsql\b/i.test(worker + realRoute + adapter), 'Worker appears to log learner SQL');

if (failures.length) {
  console.error(`Dialect lab validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Dialect lab validation passed: ${dialectLabManifests.length} labs, ${dialectLabCases.length} cases, exact SQLite fixtures, 22 real PostgreSQL/MySQL CI contracts and an honest Cloudflare Free preview boundary with zero false mastery.`);
