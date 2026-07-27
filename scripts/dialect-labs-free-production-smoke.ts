import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dialectLabCase, type DialectResultValue } from '../src/data/dialect-lab-cases.ts';
import { dialectLabManifests } from '../src/data/dialect-lab-manifests.ts';

const deployUrl = String(process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!deployUrl) throw new Error('DEPLOY_URL is required');

const SERVER_DIALECTS = ['postgresql', 'mysql'] as const;
type ServerDialect = typeof SERVER_DIALECTS[number];

type PreviewPayload = {
  version: 1;
  labId: string;
  dialect: ServerDialect;
  executionMode: 'remote-sandbox';
  verificationMode: string;
  engineVersion: null;
  runnerVersion: null;
  sandboxDestroyed: false;
  passed: false;
  evidenceEligible: false;
  offlinePreview: true;
  ciVerifiedReference: true;
  durationMs: number;
  errors: string[];
  output: { columns: string[]; rows: DialectResultValue[][] } | null;
  normalizedPlan: string[];
  timeline: string[];
  resultDigest: string;
};

type RegistrationPayload = {
  session?: { token?: string };
  recoveryCodes?: string[];
  user?: { id?: string };
};

let stageName = 'bootstrap';
let authToken = '';
let recoveryCode = '';
let smokePassword = '';
let smokeUserId = '';
let accountDeleted = false;

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function stage(name: string) {
  stageName = name;
  writeFileSync('cloudflare-dialect-stage.txt', `${name}\n`);
  console.log(`::group::Cloudflare free dialect smoke · ${name}`);
}

function endStage() {
  console.log('::endgroup::');
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
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
    method = 'GET',
    headers = {},
    body,
    expected = [200],
    attempts = 1,
    delayMs = 3_000,
    diagnosticFile
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

function outputMatches(actual: PreviewPayload['output'], expected: {
  columns: readonly string[];
  rows: readonly (readonly DialectResultValue[])[];
}) {
  if (!actual || actual.columns.length !== expected.columns.length || actual.rows.length !== expected.rows.length) return false;
  if (!actual.columns.every((column, index) => column.toLowerCase() === expected.columns[index].toLowerCase())) return false;
  return actual.rows.every((row, rowIndex) => row.length === expected.rows[rowIndex].length
    && row.every((cell, columnIndex) => cellsEqual(cell, expected.rows[rowIndex][columnIndex])));
}

function assertPreview(value: PreviewPayload, labId: string, dialect: ServerDialect) {
  if (value.labId !== labId || value.dialect !== dialect || value.executionMode !== 'remote-sandbox') {
    throw new Error(`${labId}:${dialect} returned the wrong identity contract`);
  }
  if (value.verificationMode !== 'ci-reference-preview-v1'
    || value.passed !== false
    || value.evidenceEligible !== false
    || value.offlinePreview !== true
    || value.ciVerifiedReference !== true
    || value.engineVersion !== null
    || value.runnerVersion !== null
    || value.sandboxDestroyed !== false) {
    throw new Error(`${labId}:${dialect} was not an honest free-tier preview: ${JSON.stringify(value)}`);
  }
  if (!/^fnv1a-[a-f0-9]{8}$/.test(value.resultDigest)) throw new Error(`${labId}:${dialect} preview digest is invalid`);
  const labCase = dialectLabCase(labId, dialect);
  if (!labCase || !outputMatches(value.output, labCase.expected)) {
    throw new Error(`${labId}:${dialect} preview output differs from the CI-verified reference`);
  }
}

function previewEvidence(labId: string, dialect: ServerDialect, preview: PreviewPayload) {
  return {
    version: 1,
    labId,
    dialect,
    manifestVersion: 1,
    executionMode: 'remote-sandbox',
    passed: false,
    evidenceEligible: false,
    independent: false,
    attempts: 1,
    bestDurationMs: null,
    resultDigest: preview.resultDigest,
    completedAt: null,
    lastAttemptAt: new Date().toISOString()
  };
}

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
  stage('dialect-free-d1-cascade');
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const stdout = execFileSync('npx', [
        'wrangler', 'd1', 'execute', 'sql-academy', '--remote', '--config', 'wrangler.deploy.jsonc',
        '--command', `SELECT COUNT(*) AS count FROM dialect_lab_progress WHERE user_id = '${smokeUserId}'`, '--yes', '--json'
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      writeFileSync('cloudflare-dialect-cascade.json', stdout);
      const count = findCount(parseJson<unknown>(stdout, 'Dialect D1 cascade query'));
      if (count === 0) {
        endStage();
        return;
      }
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
  stage('dialect-free-unauthenticated');
  await request('/api/dialect-labs/progress', { expected: [401], attempts: 8, delayMs: 4_000 });
  await request('/api/dialect-labs/execute', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', expected: [401], attempts: 8, delayMs: 4_000
  });
  endStage();

  stage('dialect-free-register');
  const username = `dialfree_${Math.floor(Date.now() / 1000)}_${process.env.GITHUB_RUN_ATTEMPT || '1'}`.slice(0, 32);
  smokePassword = `${randomBytes(28).toString('base64url')}!aA1`;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: smokePassword, displayName: 'Dialect Free Smoke', deviceName: 'GitHub Actions free-tier dialect lifecycle' }),
    expected: [201],
    attempts: 3
  });
  const registrationPayload = parseJson<RegistrationPayload>(registration.text, 'Dialect registration');
  authToken = String(registrationPayload.session?.token || '');
  recoveryCode = String(registrationPayload.recoveryCodes?.[0] || '');
  smokeUserId = String(registrationPayload.user?.id || '');
  if (!authToken || !recoveryCode || !smokeUserId) throw new Error('Registration did not return required credentials');
  endStage();

  const headers = { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' };

  stage('dialect-free-policy');
  await request('/api/dialect-labs/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify({ version: 1, labId: 'dialect-null-ordering', dialect: 'postgresql', sql: 'SELECT PG_SLEEP(10);' }),
    expected: [400],
    diagnosticFile: 'cloudflare-dialect-policy-rejection.json'
  });
  endStage();

  stage('dialect-free-all-reference-previews');
  const previews: Record<string, PreviewPayload> = {};
  for (const lab of dialectLabManifests) {
    for (const dialect of SERVER_DIALECTS) {
      const labCase = dialectLabCase(lab.id, dialect);
      if (!labCase) throw new Error(`${lab.id}:${dialect} source case is missing`);
      const response = await request('/api/dialect-labs/execute', {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: 1, labId: lab.id, dialect, sql: labCase.referenceSql }),
        expected: [200]
      });
      const preview = parseJson<PreviewPayload>(response.text, `${lab.id}:${dialect} preview`);
      assertPreview(preview, lab.id, dialect);
      previews[`${lab.id}:${dialect}`] = preview;
    }
  }
  writeJson('cloudflare-dialect-preview-matrix.json', {
    allPublishedPatternsPreviewed: true,
    patterns: dialectLabManifests.length,
    serverCases: Object.keys(previews).length,
    evidenceEligible: false,
    productionMode: 'cloudflare-free-reference-preview'
  });
  endStage();

  stage('dialect-free-progress-roundtrip');
  const evidence = Object.fromEntries(Object.entries(previews).map(([key, preview]) => [
    key,
    previewEvidence(preview.labId, preview.dialect, preview)
  ]));
  const progress = {
    version: 1,
    userId: smokeUserId,
    revision: 0,
    evidence,
    updatedAt: new Date().toISOString()
  };
  const stored = parseJson<{ revision?: number; progress?: { evidence?: Record<string, { passed?: boolean }> } }>((await request('/api/dialect-labs/progress', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ progress, baseRevision: 0 }),
    expected: [200]
  })).text, 'Preview progress write');
  if (stored.revision !== 1 || Object.values(stored.progress?.evidence || {}).some(item => item.passed === true)) {
    throw new Error('Preview progress round-trip created passing evidence');
  }
  const payloadCheck = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'sql-academy', '--remote', '--config', 'wrangler.deploy.jsonc',
    '--command', `SELECT COUNT(*) AS count FROM dialect_lab_progress WHERE user_id = '${smokeUserId}' AND (UPPER(payload) LIKE '%SELECT %' OR UPPER(payload) LIKE '%NULLS LAST%')`, '--yes', '--json'
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync('cloudflare-dialect-privacy.json', payloadCheck);
  if (findCount(parseJson<unknown>(payloadCheck, 'Dialect privacy query')) !== 0) throw new Error('Learner SQL leaked into D1 progress');
  endStage();

  stage('dialect-free-delete-account');
  await deleteSmokeAccount();
  if (!accountDeleted) throw new Error('Smoke account was not deleted');
  endStage();

  await verifyCascade();

  stage('dialect-free-revoked');
  await request('/api/dialect-labs/progress', { headers, expected: [401] });
  endStage();

  writeJson('cloudflare-dialect-free-result.json', {
    ok: true,
    productionMode: 'cloudflare-free-reference-preview',
    patterns: dialectLabManifests.length,
    serverCases: dialectLabManifests.length * SERVER_DIALECTS.length,
    masteryEvidenceCreated: false,
    accountDeleted: true
  });
  console.log('Cloudflare Free dialect smoke passed: 22 CI-reference previews, zero false mastery, D1 privacy and account cascade.');
} catch (error) {
  await deleteSmokeAccount();
  writeFileSync('cloudflare-dialect-failure.txt', `stage=${stageName}\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  throw error;
}
