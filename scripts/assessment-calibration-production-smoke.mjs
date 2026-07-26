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
  writeFileSync('cloudflare-assessment-calibration-stage.txt', `${name}\n`);
  console.log(`::group::Cloudflare assessment calibration smoke · ${name}`);
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

function aggregateFor(payload, taskId) {
  return payload.aggregates?.find(item => item.taskId === taskId) || {
    eligibleAttempts: 0,
    correctCount: 0,
    firstAttemptCorrect: 0,
    technicalErrorAttempts: 0
  };
}

function findCounts(value) {
  const result = {};
  const visit = candidate => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    for (const [key, nested] of Object.entries(candidate)) {
      if (['reports', 'receipts', 'aggregate'].includes(key) && Number.isFinite(Number(nested))) result[key] = Number(nested);
      else visit(nested);
    }
  };
  visit(value);
  return result;
}

function assessmentReport(userId, id = randomUUID()) {
  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.now() - 720_000).toISOString();
  const taskScores = [
    {
      taskId: 'task-001', title: 'Smoke result contract', module: 'sql-thinking', topic: 'contract',
      correct: true, skipped: false, attempts: 1, elapsedSeconds: 120, interviewerUses: 0, score: 100,
      technicalErrors: 0, telemetryEligible: true, telemetryExclusionReason: null,
      abilityBand: 'low', itemVersion: 'assessment-blueprint-v2', reasoningSkill: 'result-contract',
      errorClass: 'contract', expectedSeconds: 150
    },
    {
      taskId: 'task-013', title: 'Smoke aggregation', module: 'aggregates', topic: 'aggregation',
      correct: false, skipped: false, attempts: 2, elapsedSeconds: 310, interviewerUses: 0, score: 0,
      technicalErrors: 0, telemetryEligible: true, telemetryExclusionReason: null,
      abilityBand: 'high', itemVersion: 'assessment-blueprint-v2', reasoningSkill: 'aggregation',
      errorClass: 'aggregation-grain', expectedSeconds: 240
    },
    {
      taskId: 'task-025', title: 'Smoke technical exclusion', module: 'joins', topic: 'technical',
      correct: false, skipped: false, attempts: 1, elapsedSeconds: 12, interviewerUses: 0, score: 0,
      technicalErrors: 1, telemetryEligible: false, telemetryExclusionReason: 'technical-error',
      abilityBand: 'mid', itemVersion: 'assessment-blueprint-v2', reasoningSkill: 'relationships',
      errorClass: 'cardinality', expectedSeconds: 240
    }
  ];
  return {
    version: 1,
    id,
    userId,
    mode: 'quick',
    status: 'completed',
    startedAt,
    completedAt,
    durationSeconds: 720,
    score: 67,
    grade: 'developing',
    accuracy: 33,
    firstAttemptRate: 100,
    independence: 100,
    readinessDelta: 1,
    strengths: ['Контракт результата'],
    weaknesses: ['Агрегации'],
    localDebrief: 'Smoke report with an explicit uncertainty band and privacy-safe item evidence.',
    taskScores,
    moduleScores: [],
    baselineReadiness: 42,
    formId: 'QUICK-assessment-blueprint-v2-F1',
    blueprintVersion: 'assessment-blueprint-v2',
    thresholdVersion: 'assessment-thresholds-v2',
    measurement: {
      version: 1,
      blueprintVersion: 'assessment-blueprint-v2',
      thresholdVersion: 'assessment-thresholds-v2',
      formId: 'QUICK-assessment-blueprint-v2-F1',
      eligibleItems: 2,
      excludedItems: 1,
      calibratedItems: 0,
      accuracyInterval: { low: 12, high: 70, confidence: 90 },
      scoreBand: { low: 48, high: 86 },
      reliability: 'limited',
      explanation: ['Synthetic production smoke report.', 'Technical error is excluded from calibration.']
    }
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
    if (!parseJson(result.text, 'Assessment calibration account delete').ok) throw new Error('Account delete was not ok');
    accountDeleted = true;
  } catch (error) {
    appendFileSync('cloudflare-assessment-calibration-cleanup-error.txt', `${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  }
}

async function verifyD1Lifecycle(beforeEligible) {
  stage('assessment-calibration-d1-lifecycle');
  const stdout = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'sql-academy', '--remote', '--config', 'wrangler.deploy.jsonc',
    '--command', `SELECT
      (SELECT COUNT(*) FROM assessment_reports WHERE user_id = '${smokeUserId}') AS reports,
      (SELECT COUNT(*) FROM assessment_calibration_receipts WHERE user_id = '${smokeUserId}') AS receipts,
      (SELECT eligible_attempts FROM assessment_item_aggregates WHERE task_id = 'task-001' AND blueprint_version = 'assessment-blueprint-v2') AS aggregate`,
    '--yes', '--json'
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync('cloudflare-assessment-calibration-d1.json', stdout);
  const counts = findCounts(parseJson(stdout, 'Assessment calibration D1 lifecycle'));
  if (counts.reports !== 0 || counts.receipts !== 0) throw new Error(`User-scoped assessment rows survived account delete: ${JSON.stringify(counts)}`);
  if (!Number.isFinite(counts.aggregate) || counts.aggregate < beforeEligible + 1) throw new Error(`Anonymous aggregate did not survive account delete: ${JSON.stringify(counts)}`);
  endStage();
}

try {
  stage('assessment-calibration-unauthenticated');
  await request('/api/assessment/calibration', { expected: [401], attempts: 6, diagnosticFile: 'cloudflare-assessment-calibration-unauthorized.json' });
  endStage();

  stage('assessment-calibration-register');
  const username = `acal_${Math.floor(Date.now() / 1000)}_${process.env.GITHUB_RUN_ATTEMPT || '1'}`.slice(0, 32);
  smokePassword = `${randomBytes(28).toString('base64url')}!aA1`;
  const registration = await request('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: smokePassword, displayName: 'Assessment Calibration Smoke', deviceName: 'GitHub Actions calibration lifecycle' }),
    expected: [201], attempts: 3
  });
  const registrationPayload = parseJson(registration.text, 'Assessment calibration registration');
  authToken = String(registrationPayload.session?.token || '');
  recoveryCode = String(registrationPayload.recoveryCodes?.[0] || '');
  smokeUserId = String(registrationPayload.user?.id || '');
  if (!authToken || !recoveryCode || !smokeUserId) throw new Error('Registration did not return required credentials');
  writeJson('cloudflare-assessment-calibration-register-redacted.json', { userId: smokeUserId, username, tokenPresent: true });
  endStage();

  const headers = { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' };

  stage('assessment-calibration-baseline');
  const baseline = parseJson((await request('/api/assessment/calibration', { headers, attempts: 3 })).text, 'Calibration baseline');
  const beforeTask = aggregateFor(baseline, 'task-001');
  const beforeTechnical = aggregateFor(baseline, 'task-025');
  endStage();

  stage('assessment-calibration-report-create');
  reportId = randomUUID();
  const report = assessmentReport(smokeUserId, reportId);
  const created = parseJson((await request('/api/assessment/reports', {
    method: 'POST', headers, body: JSON.stringify(report), expected: [200], attempts: 3
  })).text, 'Assessment report create');
  if (!created.ok || created.idempotent !== false || created.telemetryContributed !== true) throw new Error('Assessment calibration create contract failed');
  endStage();

  stage('assessment-calibration-aggregate-delta');
  const after = parseJson((await request('/api/assessment/calibration', { headers, attempts: 3 })).text, 'Calibration after report');
  const afterTask = aggregateFor(after, 'task-001');
  const afterTechnical = aggregateFor(after, 'task-025');
  if (afterTask.eligibleAttempts !== beforeTask.eligibleAttempts + 1
    || afterTask.correctCount !== beforeTask.correctCount + 1
    || afterTask.firstAttemptCorrect !== beforeTask.firstAttemptCorrect + 1) {
    throw new Error(`Eligible aggregate delta mismatch: ${JSON.stringify({ beforeTask, afterTask })}`);
  }
  if (afterTechnical.eligibleAttempts !== beforeTechnical.eligibleAttempts
    || afterTechnical.technicalErrorAttempts !== beforeTechnical.technicalErrorAttempts + 1) {
    throw new Error(`Technical exclusion aggregate mismatch: ${JSON.stringify({ beforeTechnical, afterTechnical })}`);
  }
  endStage();

  stage('assessment-calibration-idempotent');
  const repeated = parseJson((await request('/api/assessment/reports', {
    method: 'POST', headers, body: JSON.stringify(report), expected: [200], attempts: 2
  })).text, 'Assessment exact replay');
  if (!repeated.ok || repeated.idempotent !== true || repeated.telemetryContributed !== false) throw new Error('Exact assessment replay must be idempotent');
  const repeatedSnapshot = parseJson((await request('/api/assessment/calibration', { headers })).text, 'Calibration after replay');
  if (aggregateFor(repeatedSnapshot, 'task-001').eligibleAttempts !== afterTask.eligibleAttempts) throw new Error('Idempotent replay double-counted telemetry');
  endStage();

  stage('assessment-calibration-debrief-only-update');
  const withDebrief = { ...report, aiDebrief: 'Measurement-aware smoke debrief.' };
  const debriefUpdate = parseJson((await request('/api/assessment/reports', {
    method: 'POST', headers, body: JSON.stringify(withDebrief), expected: [200], attempts: 2
  })).text, 'Assessment debrief update');
  if (!debriefUpdate.ok || debriefUpdate.telemetryContributed !== false) throw new Error('Debrief-only update contract failed');
  endStage();

  stage('assessment-calibration-immutable');
  await request('/api/assessment/reports', {
    method: 'POST', headers, body: JSON.stringify({ ...withDebrief, score: 68 }), expected: [409], attempts: 1,
    diagnosticFile: 'cloudflare-assessment-calibration-immutable.json'
  });
  endStage();

  stage('assessment-calibration-owner-mismatch');
  await request('/api/assessment/reports', {
    method: 'POST', headers, body: JSON.stringify(assessmentReport(randomUUID())), expected: [403], attempts: 1,
    diagnosticFile: 'cloudflare-assessment-calibration-owner-mismatch.json'
  });
  endStage();

  stage('assessment-calibration-history');
  const history = parseJson((await request('/api/assessment/reports', { headers, attempts: 3 })).text, 'Assessment history');
  const stored = history.reports?.find(item => item.id === reportId);
  if (!stored || stored.formId !== report.formId || stored.measurement?.scoreBand?.low !== 48 || stored.aiDebrief !== withDebrief.aiDebrief) {
    throw new Error('Assessment report round-trip mismatch');
  }
  endStage();

  stage('assessment-calibration-delete-account');
  await deleteSmokeAccount();
  if (!accountDeleted) throw new Error('Assessment calibration account cleanup failed');
  endStage();

  await verifyD1Lifecycle(beforeTask.eligibleAttempts);

  stage('assessment-calibration-revoked-session');
  await request('/api/assessment/calibration', { headers, expected: [401], attempts: 2 });
  endStage();

  writeJson('cloudflare-assessment-calibration-summary.json', {
    reportId,
    blueprintVersion: report.blueprintVersion,
    eligibleDelta: 1,
    technicalExcluded: true,
    idempotentReplay: true,
    immutableConflict: true,
    anonymousAggregateSurvivedDeletion: true
  });
  console.log('Assessment calibration production smoke passed: anonymous aggregate delta, technical exclusion, idempotency, immutable report core, owner isolation, cascade cleanup and revoked session.');
} catch (error) {
  writeFileSync('cloudflare-assessment-calibration-failure.txt', `stage=${stageName}\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  await deleteSmokeAccount();
  throw error;
}
