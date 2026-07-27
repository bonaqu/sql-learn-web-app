import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dialectLabCase, type DialectResultValue } from '../src/data/dialect-lab-cases.ts';
import { dialectLabManifests, type DialectLabManifest } from '../src/data/dialect-lab-manifests.ts';

const deployUrl = process.env.DEPLOY_URL;
if (!deployUrl) throw new Error('DEPLOY_URL is required');

const ROUTE_PROPAGATION_ATTEMPTS = 8;
const ROUTE_PROPAGATION_DELAY_MS = 4_000;
const REAL_DIALECTS = ['postgresql', 'mysql'] as const;
type RealDialect = (typeof REAL_DIALECTS)[number];

type ExecutionPayload = {
  version: 1;
  labId: string;
  dialect: RealDialect;
  executionMode: 'remote-sandbox';
  verificationMode: string;
  engineVersion: string | null;
  runnerVersion: string | null;
  sandboxDestroyed: boolean;
  passed: boolean;
  evidenceEligible: boolean;
  offlinePreview: boolean;
  durationMs: number;
  errors: string[];
  output: { columns: string[]; rows: DialectResultValue[][] } | null;
  normalizedPlan: string[];
  resultDigest: string;
};

type RegistrationPayload = {
  session?: { token?: string };
  recoveryCodes?: string[];
  user?: { id?: string };
};

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
let stageName = 'bootstrap';
let authToken = '';
let recoveryCode = '';
let smokePassword = '';
let smokeUserId = '';
let accountDeleted = false;

function stage(name: string) {
  stageName = name;
  writeFileSync('cloudflare-dialect-stage.txt', `${name}\n`);
  console.log(`::group::Cloudflare dialect lab smoke · ${name}`);
}

function endStage() {
  console.log('::endgroup::');
}

function parseJson<T>(text: string, label: string): T {
  try { return JSON.parse(text) as T; } catch { throw new Error(`${label} returned invalid JSON`); }
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function request(path: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  expected?: number[];
  attempts?: number;
  delayMs?: number;
  diagnosticFile?: string;
} = {}) {
  const {
    method = 'GET', headers = {}, body, expected = [200], attempts = 1, delayMs = 3_000, diagnosticFile
  } = options;
  let last: { response?: Response; text?: string; error?: unknown } | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${deployUrl}${path}`, { method, headers, body, redirect: 'follow' });
      const text = await response.text();
      last = { response, text };
      if (expected.includes(response.status)) {
        if (diagnosticFile) writeFileSync(diagnosticFile, text);
        return { response, text };
      }
      console.warn(`${method} ${path}: attempt ${attempt}/${attempts}, HTTP ${response.status}`);
    } catch (error) {
      last = { error };
      console.warn(`${method} ${path}: attempt ${attempt}/${attempts} failed`, error);
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  if (last?.text && diagnosticFile) writeFileSync(diagnosticFile, last.text);
  throw new Error(`${method} ${path} did not return ${expected.join('/')} (last: ${last?.response?.status ?? 'network error'})`);
}

const propagationOptions = {
  attempts: ROUTE_PROPAGATION_ATTEMPTS,
  delayMs: ROUTE_PROPAGATION_DELAY_MS
};

function findCount(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const count = findCount(item);
      if (count !== null) return count;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, 'count') && Number.isFinite(Number(record.count))) return Number(record.count);
  for (const nested of Object.values(record)) {
    const count = findCount(nested);
    if (count !== null) return count;
  }
  return null;
}

function normalizeTimestamp(value: string) {
  return value.replace('T', ' ').replace(/(?:\.0+)?(?:\+00(?::00)?|Z)$/, '').trim();
}

function cellsEqual(actual: DialectResultValue, expected: DialectResultValue) {
  if (actual === expected) return true;
  if (typeof actual === 'string' && typeof expected === 'string') return normalizeTimestamp(actual) === normalizeTimestamp(expected);
  if (typeof actual === 'string' && typeof expected === 'number') return Number(actual) === expected;
  if (typeof actual === 'number' && typeof expected === 'string') return actual === Number(expected);
  return false;
}

function outputMatches(actual: ExecutionPayload['output'], expected: {
  columns: readonly string[];
  rows: readonly (readonly DialectResultValue[])[];
}) {
  if (!actual || actual.columns.length !== expected.columns.length || actual.rows.length !== expected.rows.length) return false;
  if (!actual.columns.every((column, index) => column.toLowerCase() === expected.columns[index].toLowerCase())) return false;
  return actual.rows.every((row, rowIndex) => row.length === expected.rows[rowIndex].length
    && row.every((cell, columnIndex) => cellsEqual(cell, expected.rows[rowIndex][columnIndex])));
}

function assertRealExecution(value: ExecutionPayload, lab: DialectLabManifest, dialect: RealDialect) {
  if (!value.passed || !value.evidenceEligible || value.offlinePreview || value.executionMode !== 'remote-sandbox') {
    throw new Error(`${lab.id}:${dialect} did not produce eligible real-engine evidence: ${JSON.stringify(value)}`);
  }
  if (value.verificationMode !== 'real-engine-v1') throw new Error(`${lab.id}:${dialect} verificationMode is invalid`);
  if (value.runnerVersion !== 'dialect-real-engine-v1') throw new Error(`${lab.id}:${dialect} runnerVersion is invalid`);
  if (value.sandboxDestroyed !== true) throw new Error(`${lab.id}:${dialect} sandbox destroy was not confirmed`);
  if (typeof value.engineVersion !== 'string' || !/\d+\.\d+/.test(value.engineVersion)) throw new Error(`${lab.id}:${dialect} engineVersion is missing`);
  if (dialect === 'mysql' && !/^8\.4(?:\.|$)/.test(value.engineVersion)) throw new Error(`Expected Oracle MySQL 8.4, got ${value.engineVersion}`);
  if (!/^fnv1a-[a-f0-9]{8}$/.test(value.resultDigest)) throw new Error(`${lab.id}:${dialect} evidence digest is invalid`);

  const labCase = dialectLabCase(lab.id, dialect);
  if (!labCase) throw new Error(`${lab.id}:${dialect} source case is missing`);
  if (lab.kind === 'plan') {
    if (!value.normalizedPlan.some(item => item === 'index=idx_tickets_service')) {
      throw new Error(`${lab.id}:${dialect} normalized index evidence is missing: ${JSON.stringify(value.normalizedPlan)}`);
    }
  } else if (!outputMatches(value.output, labCase.expected)) {
    throw new Error(`${lab.id}:${dialect} output differs from the published case: ${JSON.stringify(value.output)}`);
  }
}

function evidenceItem(labId: string, dialect: RealDialect, execution: ExecutionPayload) {
  const now = new Date().toISOString();
  return {
    version: 1,
    labId,
    dialect,
    manifestVersion: 1,
    executionMode: 'remote-sandbox',
    passed: true,
    evidenceEligible: true,
    independent: true,
    attempts: 1,
    bestDurationMs: Math.max(1, Math.min(60_000, Math.trunc(execution.durationMs || 1))),
    resultDigest: execution.resultDigest,
    completedAt: now,
    lastAttemptAt: now
  };
}

function progressPayload(userId: string, revision: number, executions: Record<string, ExecutionPayload>) {
  const evidence: Record<string, ReturnType<typeof evidenceItem>> = {};
  for (const lab of dialectLabManifests) {
    for (const dialect of REAL_DIALECTS) {
      const key = `${lab.id}:${dialect}`;
      evidence[key] = evidenceItem(lab.id, dialect, executions[key]);
    }
  }
  return { version: 1, userId, revision, evidence, updatedAt: new Date().toISOString() };
}

async function deleteSmokeAccount() {
  if (!authToken || !smokePassword || !recoveryCode || accountDeleted) return;
  try {
    const result = await request('/api/profile', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: smokePassword, recoveryCode, confirm: 'DELETE' }),
      expected: [200],
      attempts: 2
    });
    if (parseJson<{ ok?: boolean }>(result.text, 'Dialect account delete').ok !== true) throw new Error('Account delete was not ok');
    accountDeleted = true;
  } catch (error) {
    appendFileSync('cloudflare-dialect-cleanup-error.txt', `${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  }
}

async function verifyCascade() {
  stage('dialect-d1-cascade');
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const stdout = execFileSync('npx', [
        'wrangler', 'd1', 'execute', 'sql-academy', '--remote', '--config', 'wrangler.deploy.jsonc',
        '--command', `SELECT COUNT(*) AS count FROM dialect_lab_progress WHERE user_id = '${smokeUserId}'`, '--yes', '--json'
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      writeFileSync('cloudflare-dialect-cascade.json', stdout);
      const count = findCount(parseJson<unknown>(stdout, 'Dialect D1 cascade query'));
      if (count === 0) { endStage(); return; }
      lastError = new Error(`Dialect progress row survived account delete (count=${count})`);
    } catch (error) {
      lastError = error;
      appendFileSync('cloudflare-dialect-cascade-errors.txt', `attempt ${attempt}/8: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    }
    if (attempt < 8) await sleep(3_000);
  }
  endStage();
  throw lastError || new Error('Unable to verify dialect progress cascade');
}

try {
  stage('dialect-unauthenticated');
  await request('/api/dialect-labs/progress', {
    expected: [401], diagnosticFile: 'cloudflare-dialect-unauthorized.json', ...propagationOptions
  });
  await request('/api/dialect-labs/execute', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', expected: [401], ...propagationOptions
  });
  endStage();

  stage('dialect-register');
  const username = `dial_${Math.floor(Date.now() / 1000)}_${process.env.GITHUB_RUN_ATTEMPT || '1'}`.slice(0, 32);
  smokePassword = `${randomBytes(28).toString('base64url')}!aA1`;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: smokePassword, displayName: 'Dialect Lab Smoke', deviceName: 'GitHub Actions dialect lifecycle' }),
    expected: [201],
    attempts: 3
  });
  const registrationPayload = parseJson<RegistrationPayload>(registration.text, 'Dialect registration');
  authToken = String(registrationPayload.session?.token || '');
  recoveryCode = String(registrationPayload.recoveryCodes?.[0] || '');
  smokeUserId = String(registrationPayload.user?.id || '');
  if (!authToken || !recoveryCode || !smokeUserId) throw new Error('Registration did not return required credentials');
  writeJson('cloudflare-dialect-register-redacted.json', { userId: smokeUserId, username, tokenPresent: true });
  endStage();

  const headers = { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' };

  stage('dialect-initial-progress');
  const initial = parseJson<{ progress: unknown; revision: number }>((await request('/api/dialect-labs/progress', {
    headers, ...propagationOptions
  })).text, 'Initial dialect progress');
  if (initial.progress !== null || initial.revision !== 0) throw new Error('New account must have empty dialect progress');
  endStage();

  stage('dialect-policy-abuse');
  await request('/api/dialect-labs/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify({ version: 1, labId: 'dialect-null-ordering', dialect: 'postgresql', sql: 'SELECT PG_SLEEP(10);' }),
    expected: [400],
    diagnosticFile: 'cloudflare-dialect-policy-rejection.json',
    ...propagationOptions
  });
  endStage();

  stage('dialect-incomplete-contract');
  const incomplete = parseJson<ExecutionPayload>((await request('/api/dialect-labs/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify({ version: 1, labId: 'dialect-null-ordering', dialect: 'postgresql', sql: 'SELECT ticket_id, closed_at FROM tickets ORDER BY closed_at, ticket_id;' }),
    expected: [200],
    ...propagationOptions
  })).text, 'Incomplete dialect contract');
  if (incomplete.passed !== false || incomplete.evidenceEligible !== false || incomplete.engineVersion !== null || incomplete.errors.length === 0) {
    throw new Error('Incomplete semantic contract unexpectedly reached/passed the real engine');
  }
  endStage();

  const executions: Record<string, ExecutionPayload> = {};
  for (const lab of dialectLabManifests) {
    stage(`dialect-real-${lab.id}`);
    const pair = await Promise.all(REAL_DIALECTS.map(async dialect => {
      const labCase = dialectLabCase(lab.id, dialect);
      if (!labCase) throw new Error(`${lab.id}:${dialect} source case is missing`);
      const result = parseJson<ExecutionPayload>((await request('/api/dialect-labs/execute', {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: 1, labId: lab.id, dialect, sql: labCase.referenceSql }),
        expected: [200],
        attempts: 3,
        delayMs: 5_000,
        diagnosticFile: `cloudflare-dialect-${lab.id}-${dialect}.json`
      })).text, `${lab.id}:${dialect} real contract`);
      assertRealExecution(result, lab, dialect);
      return [dialect, result] as const;
    }));
    for (const [dialect, result] of pair) executions[`${lab.id}:${dialect}`] = result;
    endStage();
  }

  stage('dialect-engine-error-cleanup');
  const failedExecution = parseJson<ExecutionPayload>((await request('/api/dialect-labs/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      version: 1,
      labId: 'dialect-null-ordering',
      dialect: 'postgresql',
      sql: 'SELECT ticket_id, closed_at FROM tickets ORDER BY closed_at NULLS LAST, ticket_id BROKEN;'
    }),
    expected: [200],
    attempts: 2,
    diagnosticFile: 'cloudflare-dialect-engine-error.json'
  })).text, 'Dialect engine error cleanup');
  if (failedExecution.passed !== false || failedExecution.evidenceEligible !== false || failedExecution.sandboxDestroyed !== true) {
    throw new Error('Failed real-engine execution did not prove non-eligibility and destroy cleanup');
  }
  if (JSON.stringify(failedExecution).includes('ticket_id BROKEN')) throw new Error('Learner SQL leaked through the engine error response');
  endStage();

  stage('dialect-progress-create');
  const progress = progressPayload(smokeUserId, 0, executions);
  const created = parseJson<{ ok?: boolean; revision?: number; progress?: { evidence?: Record<string, { resultDigest?: string }> } }>((await request('/api/dialect-labs/progress', {
    method: 'PUT', headers, body: JSON.stringify({ progress, baseRevision: 0 }), expected: [200], attempts: 3
  })).text, 'Dialect progress create');
  if (!created.ok || created.revision !== 1) throw new Error('Dialect progress create contract failed');
  for (const [key, execution] of Object.entries(executions)) {
    if (created.progress?.evidence?.[key]?.resultDigest !== execution.resultDigest) throw new Error(`${key} evidence digest did not survive progress create`);
  }
  endStage();

  stage('dialect-progress-round-trip');
  const roundTrip = parseJson<{ revision?: number; progress?: { evidence?: Record<string, { passed?: boolean; independent?: boolean; resultDigest?: string }> } }>((await request('/api/dialect-labs/progress', {
    headers, attempts: 3
  })).text, 'Dialect progress round-trip');
  if (roundTrip.revision !== 1 || Object.keys(roundTrip.progress?.evidence || {}).length !== dialectLabManifests.length * REAL_DIALECTS.length) {
    throw new Error('Dialect progress matrix size/revision mismatch');
  }
  for (const [key, execution] of Object.entries(executions)) {
    const stored = roundTrip.progress?.evidence?.[key];
    if (!stored?.passed || !stored.independent || stored.resultDigest !== execution.resultDigest) throw new Error(`${key} progress round-trip mismatch`);
  }
  const roundTripText = JSON.stringify(roundTrip).toUpperCase();
  if (/SELECT TICKET_ID|FOR UPDATE SKIP LOCKED|GENERATED ALWAYS AS|WITH RECURSIVE/.test(roundTripText)) {
    throw new Error('Learner SQL leaked into dialect progress payload');
  }
  endStage();

  stage('dialect-progress-conflict');
  await request('/api/dialect-labs/progress', {
    method: 'PUT', headers, body: JSON.stringify({ progress, baseRevision: 0 }), expected: [409], attempts: 1,
    diagnosticFile: 'cloudflare-dialect-conflict.json'
  });
  endStage();

  stage('dialect-d1-privacy');
  const d1 = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'sql-academy', '--remote', '--config', 'wrangler.deploy.jsonc',
    '--command', `SELECT payload FROM dialect_lab_progress WHERE user_id = '${smokeUserId}'`, '--yes', '--json'
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync('cloudflare-dialect-d1-redacted.json', d1.replace(/"payload"\s*:\s*"[^"]*"/g, '"payload":"<redacted>"'));
  if (/SELECT TICKET_ID|FOR UPDATE SKIP LOCKED|GENERATED ALWAYS AS|WITH RECURSIVE/i.test(d1)) {
    throw new Error('Learner SQL was persisted in D1 dialect progress');
  }
  endStage();

  stage('dialect-delete-account');
  await deleteSmokeAccount();
  if (!accountDeleted) throw new Error('Dialect smoke account cleanup failed');
  endStage();

  await verifyCascade();

  stage('dialect-revoked-session');
  await request('/api/dialect-labs/progress', { headers, expected: [401], attempts: 2 });
  const revokedCase = dialectLabCase('dialect-null-ordering', 'postgresql');
  if (!revokedCase) throw new Error('Revoked-session reference case is missing');
  await request('/api/dialect-labs/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify({ version: 1, labId: 'dialect-null-ordering', dialect: 'postgresql', sql: revokedCase.referenceSql }),
    expected: [401],
    attempts: 2
  });
  endStage();

  writeJson('cloudflare-dialect-summary.json', {
    labCount: dialectLabManifests.length,
    realContractCount: Object.keys(executions).length,
    engines: {
      postgresql: executions['dialect-null-ordering:postgresql'].engineVersion,
      mysql: executions['dialect-null-ordering:mysql'].engineVersion
    },
    routePropagationRetries: ROUTE_PROPAGATION_ATTEMPTS,
    allPublishedPatternsPassed: true,
    realEngineEvidencePassed: true,
    engineFailureCleanupPassed: true,
    policyAbuseRejected: true,
    progressRoundTrip: true,
    sqlPersisted: false,
    cascadeVerified: true
  });
  console.log(`Dialect lab production smoke passed: ${dialectLabManifests.length} patterns × ${REAL_DIALECTS.length} real engines, failure cleanup, evidence lifecycle, privacy, cascade and revoked session.`);
} catch (error) {
  writeFileSync('cloudflare-dialect-failure.txt', `stage=${stageName}\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  await deleteSmokeAccount();
  throw error;
}
