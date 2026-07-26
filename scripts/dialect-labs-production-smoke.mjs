import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';

const deployUrl = process.env.DEPLOY_URL;
if (!deployUrl) throw new Error('DEPLOY_URL is required');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let stageName = 'bootstrap';
let authToken = '';
let recoveryCode = '';
let smokePassword = '';
let smokeUserId = '';
let accountDeleted = false;

function stage(name) {
  stageName = name;
  writeFileSync('cloudflare-dialect-stage.txt', `${name}\n`);
  console.log(`::group::Cloudflare dialect lab smoke · ${name}`);
}
function endStage() { console.log('::endgroup::'); }
function parseJson(text, label) {
  try { return JSON.parse(text); } catch { throw new Error(`${label} returned invalid JSON`); }
}
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

async function request(path, {
  method = 'GET', headers = {}, body, expected = [200], attempts = 1, delayMs = 2500, diagnosticFile
} = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${deployUrl}${path}`, { method, headers, body, redirect: 'follow' });
      const text = await response.text();
      last = { response, text };
      if (expected.includes(response.status)) {
        if (diagnosticFile) writeFileSync(diagnosticFile, text);
        return last;
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

function findCount(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const count = findCount(item);
      if (count !== null) return count;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (Object.hasOwn(value, 'count') && Number.isFinite(Number(value.count))) return Number(value.count);
  for (const nested of Object.values(value)) {
    const count = findCount(nested);
    if (count !== null) return count;
  }
  return null;
}

function progressPayload(userId, revision, digest) {
  const now = new Date().toISOString();
  return {
    version: 1,
    userId,
    revision,
    evidence: {
      'dialect-null-ordering:postgresql': {
        version: 1,
        labId: 'dialect-null-ordering',
        dialect: 'postgresql',
        manifestVersion: 1,
        executionMode: 'remote-sandbox',
        passed: true,
        evidenceEligible: true,
        independent: true,
        attempts: 1,
        bestDurationMs: 12,
        resultDigest: digest,
        completedAt: now,
        lastAttemptAt: now
      }
    },
    updatedAt: now
  };
}

async function deleteSmokeAccount() {
  if (!authToken || !smokePassword || !recoveryCode || accountDeleted) return;
  try {
    const result = await request('/api/profile', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: smokePassword, recoveryCode, confirm: 'DELETE' }),
      expected: [200], attempts: 2
    });
    if (!parseJson(result.text, 'Dialect account delete').ok) throw new Error('Account delete was not ok');
    accountDeleted = true;
  } catch (error) {
    appendFileSync('cloudflare-dialect-cleanup-error.txt', `${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  }
}

async function verifyCascade() {
  stage('dialect-d1-cascade');
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const stdout = execFileSync('npx', [
        'wrangler', 'd1', 'execute', 'sql-academy', '--remote', '--config', 'wrangler.deploy.jsonc',
        '--command', `SELECT COUNT(*) AS count FROM dialect_lab_progress WHERE user_id = '${smokeUserId}'`, '--yes', '--json'
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      writeFileSync('cloudflare-dialect-cascade.json', stdout);
      const count = findCount(parseJson(stdout, 'Dialect D1 cascade query'));
      if (count === 0) { endStage(); return; }
      lastError = new Error(`Dialect progress row survived account delete (count=${count})`);
    } catch (error) {
      lastError = error;
      appendFileSync('cloudflare-dialect-cascade-errors.txt', `attempt ${attempt}/8: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    }
    if (attempt < 8) await sleep(3000);
  }
  endStage();
  throw lastError || new Error('Unable to verify dialect progress cascade');
}

try {
  stage('dialect-unauthenticated');
  await request('/api/dialect-labs/progress', { expected: [401], attempts: 6, diagnosticFile: 'cloudflare-dialect-unauthorized.json' });
  await request('/api/dialect-labs/execute', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', expected: [401], attempts: 2
  });
  endStage();

  stage('dialect-register');
  const username = `dial_${Math.floor(Date.now() / 1000)}_${process.env.GITHUB_RUN_ATTEMPT || '1'}`.slice(0, 32);
  smokePassword = `${randomBytes(28).toString('base64url')}!aA1`;
  const registration = await request('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: smokePassword, displayName: 'Dialect Lab Smoke', deviceName: 'GitHub Actions dialect lifecycle' }),
    expected: [201], attempts: 3
  });
  const registrationPayload = parseJson(registration.text, 'Dialect registration');
  authToken = String(registrationPayload.session?.token || '');
  recoveryCode = String(registrationPayload.recoveryCodes?.[0] || '');
  smokeUserId = String(registrationPayload.user?.id || '');
  if (!authToken || !recoveryCode || !smokeUserId) throw new Error('Registration did not return required credentials');
  writeJson('cloudflare-dialect-register-redacted.json', { userId: smokeUserId, username, tokenPresent: true });
  endStage();

  const headers = { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' };

  stage('dialect-initial-progress');
  const initial = parseJson((await request('/api/dialect-labs/progress', { headers, attempts: 3 })).text, 'Initial dialect progress');
  if (initial.progress !== null || initial.revision !== 0) throw new Error('New account must have empty dialect progress');
  endStage();

  stage('dialect-policy-abuse');
  await request('/api/dialect-labs/execute', {
    method: 'POST', headers,
    body: JSON.stringify({ version: 1, labId: 'dialect-null-ordering', dialect: 'postgresql', sql: 'SELECT SLEEP(10);' }),
    expected: [400], attempts: 1, diagnosticFile: 'cloudflare-dialect-policy-rejection.json'
  });
  endStage();

  stage('dialect-incomplete-contract');
  const incomplete = parseJson((await request('/api/dialect-labs/execute', {
    method: 'POST', headers,
    body: JSON.stringify({ version: 1, labId: 'dialect-null-ordering', dialect: 'postgresql', sql: 'SELECT ticket_id, closed_at FROM tickets ORDER BY closed_at, ticket_id;' }),
    expected: [200], attempts: 2
  })).text, 'Incomplete dialect contract');
  if (incomplete.passed !== false || incomplete.evidenceEligible !== false || !Array.isArray(incomplete.errors) || incomplete.errors.length === 0) {
    throw new Error('Incomplete semantic contract unexpectedly passed');
  }
  endStage();

  stage('dialect-remote-contract');
  const referenceSql = 'SELECT ticket_id, closed_at FROM tickets ORDER BY closed_at NULLS LAST, ticket_id;';
  const executed = parseJson((await request('/api/dialect-labs/execute', {
    method: 'POST', headers,
    body: JSON.stringify({ version: 1, labId: 'dialect-null-ordering', dialect: 'postgresql', sql: referenceSql }),
    expected: [200], attempts: 3
  })).text, 'Dialect remote contract');
  if (!executed.passed || !executed.evidenceEligible || executed.offlinePreview || executed.executionMode !== 'remote-sandbox') {
    throw new Error(`Remote contract sandbox did not produce eligible evidence: ${JSON.stringify(executed)}`);
  }
  if (!/^fnv1a-[a-f0-9]{8}$/.test(String(executed.resultDigest || ''))) throw new Error('Remote contract digest is invalid');
  writeJson('cloudflare-dialect-execution-redacted.json', {
    labId: executed.labId,
    dialect: executed.dialect,
    passed: executed.passed,
    resultDigest: executed.resultDigest,
    rowCount: executed.output?.rows?.length || 0,
    sqlStored: false
  });
  endStage();

  stage('dialect-progress-create');
  const progress = progressPayload(smokeUserId, 0, executed.resultDigest);
  const created = parseJson((await request('/api/dialect-labs/progress', {
    method: 'PUT', headers, body: JSON.stringify({ progress, baseRevision: 0 }), expected: [200], attempts: 3
  })).text, 'Dialect progress create');
  if (!created.ok || created.revision !== 1 || created.progress?.evidence?.['dialect-null-ordering:postgresql']?.resultDigest !== executed.resultDigest) {
    throw new Error('Dialect progress create contract failed');
  }
  endStage();

  stage('dialect-progress-round-trip');
  const roundTrip = parseJson((await request('/api/dialect-labs/progress', { headers, attempts: 3 })).text, 'Dialect progress round-trip');
  const stored = roundTrip.progress?.evidence?.['dialect-null-ordering:postgresql'];
  if (roundTrip.revision !== 1 || !stored?.passed || !stored?.independent || stored.resultDigest !== executed.resultDigest) {
    throw new Error('Dialect progress round-trip mismatch');
  }
  if (JSON.stringify(roundTrip).toLowerCase().includes('select ticket_id')) throw new Error('Learner SQL leaked into dialect progress payload');
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
  if (/SELECT\s+ticket_id/i.test(d1) || /NULLS\s+LAST/i.test(d1)) throw new Error('Learner SQL was persisted in D1 dialect progress');
  endStage();

  stage('dialect-delete-account');
  await deleteSmokeAccount();
  if (!accountDeleted) throw new Error('Dialect smoke account cleanup failed');
  endStage();

  await verifyCascade();

  stage('dialect-revoked-session');
  await request('/api/dialect-labs/progress', { headers, expected: [401], attempts: 2 });
  await request('/api/dialect-labs/execute', {
    method: 'POST', headers, body: JSON.stringify({ version: 1, labId: 'dialect-null-ordering', dialect: 'postgresql', sql: referenceSql }),
    expected: [401], attempts: 2
  });
  endStage();

  writeJson('cloudflare-dialect-summary.json', {
    labId: 'dialect-null-ordering',
    dialect: 'postgresql',
    contractSandboxPassed: true,
    policyAbuseRejected: true,
    progressRoundTrip: true,
    sqlPersisted: false,
    cascadeVerified: true
  });
  console.log('Dialect lab production smoke passed: authenticated contract sandbox, policy rejection, progress conflict, privacy, cascade cleanup and revoked session.');
} catch (error) {
  writeFileSync('cloudflare-dialect-failure.txt', `stage=${stageName}\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  await deleteSmokeAccount();
  throw error;
}
