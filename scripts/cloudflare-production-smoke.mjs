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
  writeFileSync('cloudflare-smoke-stage.txt', `${name}\n`);
  console.log(`::group::Cloudflare smoke · ${name}`);
}

function endStage() {
  console.log('::endgroup::');
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function redactRegistration(payload) {
  return {
    user: payload?.user ? {
      id: payload.user.id,
      username: payload.user.username,
      displayName: payload.user.displayName,
      dailyMinutes: payload.user.dailyMinutes,
      locale: payload.user.locale,
      theme: payload.user.theme
    } : null,
    session: payload?.session ? {
      id: payload.session.id,
      expiresAt: payload.session.expiresAt,
      deviceName: payload.session.deviceName,
      revision: payload.session.revision,
      tokenPresent: Boolean(payload.session.token)
    } : null,
    recoveryCodeCount: Array.isArray(payload?.recoveryCodes) ? payload.recoveryCodes.length : 0
  };
}

async function request(path, {
  method = 'GET',
  headers = {},
  body,
  expected = [200],
  attempts = 1,
  delayMs = 3000,
  diagnosticFile
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
      console.warn(`${method} ${path}: attempt ${attempt}/${attempts} failed:`, error);
    }
    if (attempt < attempts) await sleep(delayMs);
  }

  if (last?.text && diagnosticFile) writeFileSync(diagnosticFile, last.text);
  const status = last?.response?.status ?? 'network error';
  throw new Error(`${method} ${path} did not return ${expected.join('/')} after ${attempts} attempts (last: ${status})`);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function findCount(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCount(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (Object.hasOwn(value, 'count') && Number.isFinite(Number(value.count))) return Number(value.count);
  for (const nested of Object.values(value)) {
    const found = findCount(nested);
    if (found !== null) return found;
  }
  return null;
}

async function deleteSmokeAccount() {
  if (!authToken || !smokePassword || !recoveryCode || accountDeleted) return;
  try {
    const result = await request('/api/profile', {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        currentPassword: smokePassword,
        recoveryCode,
        confirm: 'DELETE'
      }),
      expected: [200],
      attempts: 2
    });
    const payload = parseJson(result.text, 'Account delete');
    writeJson('cloudflare-delete.json', payload);
    if (!payload.ok) throw new Error('Account delete response was not ok');
    accountDeleted = true;
  } catch (error) {
    appendFileSync('cloudflare-smoke-cleanup-error.txt', `${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  }
}

async function verifyCascade() {
  stage('d1-cascade');
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const stdout = execFileSync('npx', [
        'wrangler', 'd1', 'execute', 'sql-academy',
        '--remote',
        '--config', 'wrangler.deploy.jsonc',
        '--command', `SELECT COUNT(*) AS count FROM curriculum_progress WHERE user_id = '${smokeUserId}'`,
        '--yes',
        '--json'
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      writeFileSync('cloudflare-curriculum-cascade.json', stdout);
      const count = findCount(parseJson(stdout, 'D1 cascade query'));
      if (count === 0) {
        endStage();
        return;
      }
      lastError = new Error(`Curriculum row still exists (count=${count})`);
    } catch (error) {
      lastError = error;
      appendFileSync(
        'cloudflare-curriculum-cascade-errors.txt',
        `attempt ${attempt}/8: ${error instanceof Error ? error.stack || error.message : String(error)}\n`
      );
    }
    if (attempt < 8) await sleep(3000);
  }
  endStage();
  throw lastError || new Error('Unable to verify curriculum cascade cleanup');
}

try {
  stage('frontend');
  const frontend = await request('/', { expected: [200], attempts: 8, delayMs: 4000, diagnosticFile: 'cloudflare-index.html' });
  if (!frontend.text.includes('<div id="root"></div>')) throw new Error('Frontend root marker is missing');
  endStage();

  stage('health');
  let health = null;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await request('/api/health', { expected: [200], attempts: 1, diagnosticFile: 'cloudflare-health.json' });
    health = parseJson(result.text, 'Health endpoint');
    if (health.ok
      && health.d1
      && health.kv
      && health.ai
      && health.progressVersion === 4
      && health.curriculumVersion === 1) break;
    console.warn(`Health schema not propagated yet (attempt ${attempt}/12)`, health);
    if (attempt < 12) await sleep(5000);
  }
  if (!health?.ok || health.progressVersion !== 4 || health.curriculumVersion !== 1) {
    throw new Error(`Unhealthy or stale deployment: ${JSON.stringify(health)}`);
  }
  endStage();

  stage('unauthenticated-contracts');
  await request('/api/auth/session', { expected: [401], attempts: 8, diagnosticFile: 'cloudflare-unauthorized.json' });
  await request('/api/curriculum/progress', { expected: [401], attempts: 8, diagnosticFile: 'cloudflare-curriculum-unauthorized.json' });
  endStage();

  stage('register');
  const smokeUsername = `smoke_${Math.floor(Date.now() / 1000)}_${process.env.GITHUB_RUN_ATTEMPT || '1'}`.slice(0, 32);
  smokePassword = `${randomBytes(28).toString('base64url')}!aA1`;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: smokeUsername,
      password: smokePassword,
      displayName: 'Deployment Smoke',
      deviceName: 'GitHub Actions'
    }),
    expected: [201],
    attempts: 3,
    delayMs: 3000
  });
  const registrationPayload = parseJson(registration.text, 'Registration');
  authToken = String(registrationPayload.session?.token || '');
  recoveryCode = String(registrationPayload.recoveryCodes?.[0] || '');
  smokeUserId = String(registrationPayload.user?.id || '');
  if (!authToken || !recoveryCode || !smokeUserId) throw new Error('Registration did not return session, recovery code and user ID');
  writeJson('cloudflare-register-redacted.json', redactRegistration(registrationPayload));
  endStage();

  const authorizedHeaders = { authorization: `Bearer ${authToken}` };

  stage('authenticated-session');
  const session = await request('/api/auth/session', { headers: authorizedHeaders, expected: [200], attempts: 3 });
  const sessionPayload = parseJson(session.text, 'Authenticated session');
  writeJson('cloudflare-session.json', sessionPayload);
  if (sessionPayload.user?.username !== smokeUsername || !sessionPayload.session?.id) {
    throw new Error('Authenticated session contract failed');
  }
  endStage();

  stage('task-progress');
  const taskProgress = await request('/api/user/progress', { headers: authorizedHeaders, expected: [200], attempts: 3 });
  const taskProgressPayload = parseJson(taskProgress.text, 'Task progress');
  writeJson('cloudflare-progress.json', taskProgressPayload);
  if (taskProgressPayload.revision !== 0 || taskProgressPayload.progress !== null) {
    throw new Error('Unexpected initial task progress');
  }
  endStage();

  stage('curriculum-initial');
  const curriculumInitial = await request('/api/curriculum/progress', {
    headers: authorizedHeaders,
    expected: [200],
    attempts: 6,
    delayMs: 3000
  });
  const initialPayload = parseJson(curriculumInitial.text, 'Initial curriculum');
  writeJson('cloudflare-curriculum-initial.json', initialPayload);
  if (initialPayload.progress !== null || initialPayload.updatedAt !== null) {
    throw new Error('Unexpected initial curriculum progress');
  }
  endStage();

  stage('curriculum-round-trip');
  const now = new Date().toISOString();
  const curriculumProgress = {
    version: 1,
    completedSections: ['sql-thinking-concept'],
    completedLessons: [],
    completedProjects: [],
    answers: {
      'check-sql-thinking': { optionIndex: 1, correct: true, answeredAt: now }
    },
    projectDrafts: {
      'project-incident-command': {
        sql: 'SELECT service, COUNT(*) FROM tickets GROUP BY service;',
        notes: 'Deployment smoke draft',
        completedDeliverables: ['incident-base'],
        updatedAt: now
      }
    },
    bookmark: { lessonId: 'lesson-sql-thinking', sectionId: 'sql-thinking-concept', updatedAt: now },
    updatedAt: now
  };
  writeJson('cloudflare-curriculum-payload-redacted.json', { progress: curriculumProgress, baseUpdatedAt: null });
  const curriculumPut = await request('/api/curriculum/progress', {
    method: 'PUT',
    headers: { ...authorizedHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ progress: curriculumProgress, baseUpdatedAt: null }),
    expected: [200],
    attempts: 3
  });
  const putPayload = parseJson(curriculumPut.text, 'Curriculum PUT');
  writeJson('cloudflare-curriculum-put.json', putPayload);
  if (!putPayload.ok || !putPayload.updatedAt) throw new Error('Curriculum PUT contract failed');

  const curriculumGet = await request('/api/curriculum/progress', {
    headers: authorizedHeaders,
    expected: [200],
    attempts: 3
  });
  const getPayload = parseJson(curriculumGet.text, 'Curriculum GET');
  writeJson('cloudflare-curriculum-get.json', getPayload);
  if (getPayload.updatedAt !== putPayload.updatedAt
    || getPayload.progress?.version !== 1
    || getPayload.progress?.projectDrafts?.['project-incident-command']?.notes !== 'Deployment smoke draft'
    || getPayload.progress?.answers?.['check-sql-thinking']?.correct !== true) {
    throw new Error('Curriculum round-trip contract failed');
  }
  endStage();

  stage('curriculum-conflict');
  const curriculumConflict = await request('/api/curriculum/progress', {
    method: 'PUT',
    headers: { ...authorizedHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ progress: curriculumProgress, baseUpdatedAt: null }),
    expected: [409],
    attempts: 2
  });
  const conflictPayload = parseJson(curriculumConflict.text, 'Curriculum conflict');
  writeJson('cloudflare-curriculum-conflict.json', conflictPayload);
  if (!conflictPayload.progress || !conflictPayload.updatedAt || !String(conflictPayload.error || '').includes('another device')) {
    throw new Error('Curriculum conflict contract failed');
  }
  endStage();

  stage('account-delete');
  await deleteSmokeAccount();
  if (!accountDeleted) throw new Error('Smoke account was not deleted');
  endStage();

  stage('revoked-session');
  await request('/api/curriculum/progress', {
    headers: authorizedHeaders,
    expected: [401],
    attempts: 4,
    diagnosticFile: 'cloudflare-curriculum-revoked-session.json'
  });
  endStage();

  await verifyCascade();
  stage('complete');
  writeJson('cloudflare-smoke-summary.json', {
    ok: true,
    deployment: deployUrl,
    progressVersion: 4,
    curriculumVersion: 1,
    curriculumConflictVerified: true,
    accountCascadeVerified: true
  });
  endStage();
} catch (error) {
  writeJson('cloudflare-smoke-failure.json', {
    ok: false,
    stage: stageName,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  console.error(`Cloudflare production smoke failed at stage "${stageName}"`, error);
  await deleteSmokeAccount();
  process.exitCode = 1;
}
