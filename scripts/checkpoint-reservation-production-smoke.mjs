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
let accountDeleted = false;

function stage(name) {
  stageName = name;
  writeFileSync('cloudflare-checkpoint-reservation-stage.txt', `${name}\n`);
  console.log(`::group::Cloudflare checkpoint reservation smoke · ${name}`);
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
  if (Object.hasOwn(value, 'count') && Number.isFinite(Number(value.count))) return Number(value.count);
  for (const nested of Object.values(value)) {
    const count = findCount(nested);
    if (count !== null) return count;
  }
  return null;
}

function validReservation(value, attemptNumber) {
  return value
    && value.version === 1
    && typeof value.reservationId === 'string'
    && typeof value.reportId === 'string'
    && value.checkpointId === 'checkpoint-foundation'
    && value.attemptNumber === attemptNumber
    && value.status === 'active'
    && typeof value.startedAt === 'string'
    && typeof value.deadlineAt === 'string'
    && typeof value.expiresAt === 'string';
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
      body: JSON.stringify({ currentPassword: smokePassword, recoveryCode, confirm: 'DELETE' }),
      expected: [200],
      attempts: 2
    });
    const payload = parseJson(result.text, 'Checkpoint reservation account delete');
    if (!payload.ok) throw new Error('Checkpoint reservation account delete was not ok');
    accountDeleted = true;
  } catch (error) {
    appendFileSync(
      'cloudflare-checkpoint-reservation-cleanup-error.txt',
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`
    );
  }
}

async function verifyCascade() {
  stage('checkpoint-reservation-d1-cascade');
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const command = `SELECT
        (SELECT COUNT(*) FROM checkpoint_reports WHERE user_id = '${smokeUserId}') AS reports,
        (SELECT COUNT(*) FROM checkpoint_attempt_reservations WHERE user_id = '${smokeUserId}') AS reservations`;
      const stdout = execFileSync('npx', [
        'wrangler', 'd1', 'execute', 'sql-academy',
        '--remote', '--config', 'wrangler.deploy.jsonc', '--command', command, '--yes', '--json'
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      writeFileSync('cloudflare-checkpoint-reservation-cascade.json', stdout);
      const parsed = parseJson(stdout, 'Checkpoint reservation cascade query');
      const counts = [];
      const visit = value => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        if (Object.hasOwn(value, 'reports') && Object.hasOwn(value, 'reservations')) counts.push(value);
        Object.values(value).forEach(visit);
      };
      visit(parsed);
      const row = counts[0];
      if (row && Number(row.reports) === 0 && Number(row.reservations) === 0) {
        endStage();
        return;
      }
      lastError = new Error(`Checkpoint reservation evidence still exists: ${JSON.stringify(row || parsed).slice(0, 500)}`);
    } catch (error) {
      lastError = error;
      appendFileSync(
        'cloudflare-checkpoint-reservation-cascade-errors.txt',
        `attempt ${attempt}/8: ${error instanceof Error ? error.stack || error.message : String(error)}\n`
      );
    }
    if (attempt < 8) await sleep(3000);
  }
  endStage();
  throw lastError || new Error('Unable to verify checkpoint reservation cascade cleanup');
}

try {
  stage('checkpoint-reservation-register');
  const username = `cpr_${Math.floor(Date.now() / 1000)}_${process.env.GITHUB_RUN_ATTEMPT || '1'}`.slice(0, 32);
  smokePassword = `${randomBytes(28).toString('base64url')}!aA1`;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      password: smokePassword,
      displayName: 'Checkpoint Reservation Smoke',
      deviceName: 'GitHub Actions reservation lifecycle'
    }),
    expected: [201],
    attempts: 3
  });
  const registrationPayload = parseJson(registration.text, 'Checkpoint reservation registration');
  authToken = String(registrationPayload.session?.token || '');
  recoveryCode = String(registrationPayload.recoveryCodes?.[0] || '');
  smokeUserId = String(registrationPayload.user?.id || '');
  if (!authToken || !recoveryCode || !smokeUserId) throw new Error('Registration credentials are incomplete');
  writeJson('cloudflare-checkpoint-reservation-register-redacted.json', {
    userId: smokeUserId,
    username,
    tokenPresent: Boolean(authToken)
  });
  endStage();

  const headers = {
    authorization: `Bearer ${authToken}`,
    'content-type': 'application/json'
  };
  const firstRequestId = randomUUID();

  stage('checkpoint-reservation-first');
  const firstResponse = await request('/api/checkpoints/reservations', {
    method: 'POST',
    headers,
    body: JSON.stringify({ checkpointId: 'checkpoint-foundation', clientRequestId: firstRequestId }),
    expected: [200],
    attempts: 3
  });
  const first = parseJson(firstResponse.text, 'First checkpoint reservation');
  if (!first.created || first.replayed || first.activeElsewhere || !validReservation(first.reservation, 1)) {
    throw new Error('First checkpoint reservation contract failed');
  }
  endStage();

  stage('checkpoint-reservation-replay');
  const replayResponse = await request('/api/checkpoints/reservations', {
    method: 'POST',
    headers,
    body: JSON.stringify({ checkpointId: 'checkpoint-foundation', clientRequestId: firstRequestId }),
    expected: [200]
  });
  const replay = parseJson(replayResponse.text, 'Checkpoint reservation replay');
  if (replay.created || !replay.replayed
    || replay.reservation?.reservationId !== first.reservation.reservationId
    || replay.reservation?.reportId !== first.reservation.reportId
    || replay.reservation?.attemptNumber !== 1) {
    throw new Error('Reservation replay did not return the original identity');
  }
  endStage();

  stage('checkpoint-reservation-active-conflict');
  const conflictResponse = await request('/api/checkpoints/reservations', {
    method: 'POST',
    headers,
    body: JSON.stringify({ checkpointId: 'checkpoint-foundation', clientRequestId: randomUUID() }),
    expected: [409]
  });
  const conflict = parseJson(conflictResponse.text, 'Checkpoint active conflict');
  if (conflict.code !== 'CHECKPOINT_ATTEMPT_ACTIVE'
    || conflict.reservation?.reservationId !== first.reservation.reservationId
    || conflict.reservation?.attemptNumber !== 1) {
    throw new Error('Active reservation conflict did not return the original reservation');
  }
  endStage();

  stage('checkpoint-reservation-complete');
  const completedAt = new Date().toISOString();
  const taskIds = ['task-001', 'task-007', 'task-013', 'task-019', 'task-025'];
  const modules = ['sql-thinking', 'select', 'filtering', 'sorting', 'aggregates'];
  const report = {
    version: 1,
    id: first.reservation.reportId,
    userId: smokeUserId,
    checkpointId: 'checkpoint-foundation',
    status: 'completed',
    startedAt: first.reservation.startedAt,
    completedAt,
    durationSeconds: Math.max(1, Math.round((Date.parse(completedAt) - Date.parse(first.reservation.startedAt)) / 1000)),
    attemptNumber: first.reservation.attemptNumber,
    score: 92,
    bestScore: 92,
    passingScore: 70,
    passed: true,
    accuracy: 100,
    firstAttemptRate: 100,
    independence: 100,
    taskScores: taskIds.map((taskId, index) => ({
      taskId,
      title: `Reservation smoke task ${index + 1}`,
      module: modules[index],
      correct: true,
      skipped: false,
      attempts: 1,
      elapsedSeconds: 60,
      score: 92
    })),
    moduleScores: modules.map((module, index) => ({
      module,
      title: `Reservation smoke module ${index + 1}`,
      score: 92,
      correct: 1,
      total: 1
    })),
    remediationModules: [],
    coordination: 'cloud',
    reservationId: first.reservation.reservationId
  };
  const completeResponse = await request('/api/checkpoints/reports', {
    method: 'POST',
    headers,
    body: JSON.stringify(report),
    expected: [200],
    attempts: 3
  });
  const completed = parseJson(completeResponse.text, 'Coordinated checkpoint completion');
  if (!completed.ok || completed.replayed || !completed.coordinated
    || completed.receipt?.reportId !== report.id
    || !/^[a-f0-9]{64}$/i.test(completed.receipt?.payloadDigest || '')) {
    throw new Error('Coordinated checkpoint completion receipt contract failed');
  }
  endStage();

  stage('checkpoint-reservation-next-number');
  const secondResponse = await request('/api/checkpoints/reservations', {
    method: 'POST',
    headers,
    body: JSON.stringify({ checkpointId: 'checkpoint-foundation', clientRequestId: randomUUID() }),
    expected: [200],
    attempts: 3
  });
  const second = parseJson(secondResponse.text, 'Second checkpoint reservation');
  if (!second.created || second.replayed || !validReservation(second.reservation, 2)) {
    throw new Error('Second checkpoint reservation did not receive attempt number 2');
  }
  endStage();

  stage('checkpoint-reservation-account-delete');
  await deleteSmokeAccount();
  if (!accountDeleted) throw new Error('Checkpoint reservation smoke account was not deleted');
  endStage();

  await verifyCascade();
  stage('checkpoint-reservation-complete-smoke');
  writeJson('cloudflare-checkpoint-reservation-smoke-summary.json', {
    ok: true,
    deployment: deployUrl,
    firstAttemptNumber: 1,
    secondAttemptNumber: 2,
    replayVerified: true,
    activeConflictVerified: true,
    coordinatedCompletionVerified: true,
    cascadeVerified: true
  });
  endStage();
} catch (error) {
  writeJson('cloudflare-checkpoint-reservation-smoke-failure.json', {
    ok: false,
    stage: stageName,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  console.error(`Cloudflare checkpoint reservation smoke failed at stage "${stageName}"`, error);
  await deleteSmokeAccount();
  process.exitCode = 1;
}
