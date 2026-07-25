import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';

const deployUrl = process.env.DEPLOY_URL;
if (!deployUrl) throw new Error('DEPLOY_URL is required');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let stageName = 'bootstrap';
let authToken = '';
let recoveryCode = '';
let smokePassword = '';
let smokeUserId = '';
let reportId = '';
let accountDeleted = false;

function stage(name) {
  stageName = name;
  writeFileSync('cloudflare-checkpoint-stage.txt', `${name}\n`);
  console.log(`::group::Cloudflare checkpoint smoke · ${name}`);
}

function endStage() {
  console.log('::endgroup::');
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function request(path, {
  method = 'GET',
  headers = {},
  body,
  expected = [200],
  attempts = 1,
  delayMs = 2500,
  diagnosticFile
} = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${deployUrl}${path}`, {
        method,
        headers,
        body,
        redirect: 'follow'
      });
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
  const status = last?.response?.status ?? 'network error';
  throw new Error(`${method} ${path} did not return ${expected.join('/')} (last: ${status})`);
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
  if (Object.hasOwn(value, 'count') && Number.isFinite(Number(value.count))) {
    return Number(value.count);
  }
  for (const nested of Object.values(value)) {
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
    const payload = parseJson(result.text, 'Checkpoint account delete');
    if (!payload.ok) throw new Error('Checkpoint account delete was not ok');
    accountDeleted = true;
  } catch (error) {
    appendFileSync(
      'cloudflare-checkpoint-cleanup-error.txt',
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`
    );
  }
}

async function verifyCheckpointCascade() {
  stage('checkpoint-d1-cascade');
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const stdout = execFileSync('npx', [
        'wrangler', 'd1', 'execute', 'sql-academy',
        '--remote',
        '--config', 'wrangler.deploy.jsonc',
        '--command', `SELECT COUNT(*) AS count FROM checkpoint_reports WHERE user_id = '${smokeUserId}'`,
        '--yes',
        '--json'
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      writeFileSync('cloudflare-checkpoint-cascade.json', stdout);
      const count = findCount(parseJson(stdout, 'Checkpoint cascade query'));
      if (count === 0) {
        endStage();
        return;
      }
      lastError = new Error(`Checkpoint report still exists (count=${count})`);
    } catch (error) {
      lastError = error;
      appendFileSync(
        'cloudflare-checkpoint-cascade-errors.txt',
        `attempt ${attempt}/8: ${error instanceof Error ? error.stack || error.message : String(error)}\n`
      );
    }
    if (attempt < 8) await sleep(3000);
  }
  endStage();
  throw lastError || new Error('Unable to verify checkpoint cascade cleanup');
}

try {
  stage('checkpoint-unauthenticated');
  await request('/api/checkpoints/reports', {
    expected: [401],
    attempts: 6,
    diagnosticFile: 'cloudflare-checkpoint-unauthorized.json'
  });
  endStage();

  stage('checkpoint-register');
  const username = `cp_${Math.floor(Date.now() / 1000)}_${process.env.GITHUB_RUN_ATTEMPT || '1'}`.slice(0, 32);
  smokePassword = `${randomBytes(28).toString('base64url')}!aA1`;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      password: smokePassword,
      displayName: 'Checkpoint Smoke',
      deviceName: 'GitHub Actions checkpoint lifecycle'
    }),
    expected: [201],
    attempts: 3
  });
  const registrationPayload = parseJson(registration.text, 'Checkpoint registration');
  authToken = String(registrationPayload.session?.token || '');
  recoveryCode = String(registrationPayload.recoveryCodes?.[0] || '');
  smokeUserId = String(registrationPayload.user?.id || '');
  if (!authToken || !recoveryCode || !smokeUserId) {
    throw new Error('Checkpoint registration did not return required credentials');
  }
  writeJson('cloudflare-checkpoint-register-redacted.json', {
    userId: smokeUserId,
    username,
    tokenPresent: Boolean(authToken),
    recoveryCodeCount: Array.isArray(registrationPayload.recoveryCodes)
      ? registrationPayload.recoveryCodes.length
      : 0
  });
  endStage();

  const authorizedHeaders = {
    authorization: `Bearer ${authToken}`,
    'content-type': 'application/json'
  };

  stage('checkpoint-initial-history');
  const initial = await request('/api/checkpoints/reports', {
    headers: { authorization: `Bearer ${authToken}` },
    expected: [200],
    attempts: 3
  });
  const initialPayload = parseJson(initial.text, 'Initial checkpoint history');
  if (!Array.isArray(initialPayload.reports) || initialPayload.reports.length !== 0) {
    throw new Error('New checkpoint account must have empty report history');
  }
  endStage();

  stage('checkpoint-report-post');
  reportId = randomUUID();
  const startedAt = new Date(Date.now() - 420_000).toISOString();
  const completedAt = new Date().toISOString();
  const taskIds = ['task-001', 'task-007', 'task-013', 'task-019', 'task-025'];
  const modules = ['sql-thinking', 'select', 'filtering', 'sorting', 'aggregates'];
  const report = {
    version: 1,
    id: reportId,
    userId: smokeUserId,
    checkpointId: 'checkpoint-foundation',
    status: 'completed',
    startedAt,
    completedAt,
    durationSeconds: 420,
    attemptNumber: 1,
    score: 92,
    bestScore: 92,
    passingScore: 70,
    passed: true,
    accuracy: 100,
    firstAttemptRate: 80,
    independence: 96,
    taskScores: taskIds.map((taskId, index) => ({
      taskId,
      title: `Smoke task ${index + 1}`,
      module: modules[index],
      correct: true,
      skipped: false,
      attempts: index === 4 ? 2 : 1,
      elapsedSeconds: 80 + index,
      score: index === 4 ? 84 : 94
    })),
    moduleScores: modules.map((module, index) => ({
      module,
      title: `Smoke module ${index + 1}`,
      score: index === 4 ? 84 : 94,
      correct: 1,
      total: 1
    })),
    remediationModules: []
  };
  const saved = await request('/api/checkpoints/reports', {
    method: 'POST',
    headers: authorizedHeaders,
    body: JSON.stringify(report),
    expected: [200],
    attempts: 3
  });
  const savedPayload = parseJson(saved.text, 'Checkpoint report POST');
  if (!savedPayload.ok) throw new Error('Checkpoint report POST contract failed');
  writeJson('cloudflare-checkpoint-report-redacted.json', {
    id: report.id,
    checkpointId: report.checkpointId,
    score: report.score,
    passed: report.passed,
    taskScoreCount: report.taskScores.length,
    moduleScoreCount: report.moduleScores.length
  });
  endStage();

  stage('checkpoint-report-get');
  const history = await request('/api/checkpoints/reports', {
    headers: { authorization: `Bearer ${authToken}` },
    expected: [200],
    attempts: 3
  });
  const historyPayload = parseJson(history.text, 'Checkpoint history GET');
  const stored = Array.isArray(historyPayload.reports)
    ? historyPayload.reports.find(item => item.id === reportId)
    : null;
  if (!stored
    || stored.userId !== smokeUserId
    || stored.checkpointId !== 'checkpoint-foundation'
    || stored.score !== 92
    || stored.passed !== true
    || stored.taskScores?.length !== 5) {
    throw new Error('Checkpoint report GET round-trip failed');
  }
  writeJson('cloudflare-checkpoint-history-redacted.json', {
    reportCount: historyPayload.reports.length,
    matchedReport: reportId,
    score: stored.score,
    passed: stored.passed
  });
  endStage();

  stage('checkpoint-owner-mismatch');
  await request('/api/checkpoints/reports', {
    method: 'POST',
    headers: authorizedHeaders,
    body: JSON.stringify({ ...report, id: randomUUID(), userId: randomUUID() }),
    expected: [403],
    attempts: 2,
    diagnosticFile: 'cloudflare-checkpoint-owner-mismatch.json'
  });
  endStage();

  stage('checkpoint-account-delete');
  await deleteSmokeAccount();
  if (!accountDeleted) throw new Error('Checkpoint smoke account was not deleted');
  endStage();

  stage('checkpoint-revoked-session');
  await request('/api/checkpoints/reports', {
    headers: { authorization: `Bearer ${authToken}` },
    expected: [401],
    attempts: 4,
    diagnosticFile: 'cloudflare-checkpoint-revoked-session.json'
  });
  endStage();

  await verifyCheckpointCascade();
  stage('checkpoint-complete');
  writeJson('cloudflare-checkpoint-smoke-summary.json', {
    ok: true,
    deployment: deployUrl,
    checkpointRoundTripVerified: true,
    ownerValidationVerified: true,
    revokedSessionVerified: true,
    cascadeVerified: true
  });
  endStage();
} catch (error) {
  writeJson('cloudflare-checkpoint-smoke-failure.json', {
    ok: false,
    stage: stageName,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  console.error(`Cloudflare checkpoint smoke failed at stage "${stageName}"`, error);
  await deleteSmokeAccount();
  process.exitCode = 1;
}
