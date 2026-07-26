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
  writeFileSync('cloudflare-capstone-stage.txt', `${name}\n`);
  console.log(`::group::Cloudflare capstone smoke · ${name}`);
}

function endStage() {
  console.log('::endgroup::');
}

function parseJson(text, label) {
  try { return JSON.parse(text); } catch { throw new Error(`${label} returned invalid JSON`); }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

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

function passedReport(userId, id = randomUUID()) {
  const startedAt = new Date(Date.now() - 1_200_000).toISOString();
  const completedAt = new Date().toISOString();
  const fileDefinitions = [
    { id: 'incident-base.sql', title: '01 · base.sql', weight: 25 },
    { id: 'incident-metrics.sql', title: '02 · metrics.sql', weight: 30 },
    { id: 'incident-ranking.sql', title: '03 · ranking.sql', weight: 30 }
  ];
  const datasets = [
    { id: 'public-base', title: 'Public training dataset', hidden: false },
    { id: 'hidden-edge-cases', title: 'Hidden edge cases', hidden: true },
    { id: 'hidden-order-ties', title: 'Hidden stable-order ties', hidden: true }
  ];
  const checks = fileDefinitions.flatMap(file => datasets.map(dataset => ({
    id: `${file.id}:${dataset.id}`,
    fileId: file.id,
    datasetId: dataset.id,
    kind: dataset.hidden ? 'hidden-data' : 'result-contract',
    title: `${file.title} · ${dataset.title}`,
    passed: true,
    score: file.weight / datasets.length,
    maxScore: file.weight / datasets.length,
    message: dataset.hidden ? 'Hidden edge cases пройдены.' : 'Public result contract совпал.',
    remediation: null,
    hidden: dataset.hidden
  })));
  checks.push({
    id: 'project-incident-command:reflection',
    fileId: null,
    datasetId: null,
    kind: 'reflection',
    title: 'Операционное объяснение',
    passed: true,
    score: 15,
    maxScore: 15,
    message: 'Self-reflection фиксирует ключевые ограничения результата.',
    remediation: null,
    hidden: false
  });
  const submissionFiles = {
    'incident-base.sql': 'SELECT ticket_id, service, status, engineer_id AS engineer_name, CASE WHEN status = \'Closed\' THEN \'met\' ELSE \'open\' END AS sla_state FROM tickets ORDER BY ticket_id;',
    'incident-metrics.sql': 'SELECT service, 0 AS backlog_count, COUNT(*) AS closed_count, 0 AS breach_count, 0.0 AS breach_rate FROM tickets GROUP BY service ORDER BY service;',
    'incident-ranking.sql': 'SELECT service, 0 AS breach_count, 0 AS backlog_count, ROW_NUMBER() OVER (ORDER BY service) AS risk_rank FROM tickets GROUP BY service ORDER BY risk_rank, service;'
  };
  return {
    version: 1,
    id,
    userId,
    projectId: 'project-incident-command',
    status: 'passed',
    startedAt,
    completedAt,
    durationSeconds: 1200,
    attemptNumber: 1,
    score: 100,
    bestScore: 100,
    passingScore: 80,
    passed: true,
    provenance: 'independent',
    independence: 100,
    guidanceUses: 0,
    solutionViews: 0,
    files: fileDefinitions.map(file => ({
      fileId: file.id,
      title: file.title,
      kind: 'query',
      passed: true,
      score: file.weight,
      maxScore: file.weight,
      checks: datasets.map(dataset => `${file.id}:${dataset.id}`)
    })),
    submissionFiles,
    checks,
    reflection: 'Гранулярность — одна строка на обращение. Знаменатель breach rate включает closed. Open tickets остаются backlog. Tie-breaker обеспечивает детерминированный порядок результата.',
    remediation: []
  };
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
    if (!parseJson(result.text, 'Capstone account delete').ok) throw new Error('Capstone account delete was not ok');
    accountDeleted = true;
  } catch (error) {
    appendFileSync('cloudflare-capstone-cleanup-error.txt', `${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  }
}

async function verifyCascade() {
  stage('capstone-d1-cascade');
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const stdout = execFileSync('npx', [
        'wrangler', 'd1', 'execute', 'sql-academy', '--remote', '--config', 'wrangler.deploy.jsonc',
        '--command', `SELECT COUNT(*) AS count FROM capstone_reports WHERE user_id = '${smokeUserId}'`, '--yes', '--json'
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      writeFileSync('cloudflare-capstone-cascade.json', stdout);
      const count = findCount(parseJson(stdout, 'Capstone cascade query'));
      if (count === 0) { endStage(); return; }
      lastError = new Error(`Capstone report still exists (count=${count})`);
    } catch (error) {
      lastError = error;
      appendFileSync('cloudflare-capstone-cascade-errors.txt', `attempt ${attempt}/8: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    }
    if (attempt < 8) await sleep(3000);
  }
  endStage();
  throw lastError || new Error('Unable to verify capstone cascade cleanup');
}

try {
  stage('capstone-unauthenticated');
  await request('/api/capstones/reports', { expected: [401], attempts: 6, diagnosticFile: 'cloudflare-capstone-unauthorized.json' });
  endStage();

  stage('capstone-register');
  const username = `cap_${Math.floor(Date.now() / 1000)}_${process.env.GITHUB_RUN_ATTEMPT || '1'}`.slice(0, 32);
  smokePassword = `${randomBytes(28).toString('base64url')}!aA1`;
  const registration = await request('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: smokePassword, displayName: 'Capstone Smoke', deviceName: 'GitHub Actions capstone lifecycle' }),
    expected: [201], attempts: 3
  });
  const registrationPayload = parseJson(registration.text, 'Capstone registration');
  authToken = String(registrationPayload.session?.token || '');
  recoveryCode = String(registrationPayload.recoveryCodes?.[0] || '');
  smokeUserId = String(registrationPayload.user?.id || '');
  if (!authToken || !recoveryCode || !smokeUserId) throw new Error('Capstone registration did not return required credentials');
  writeJson('cloudflare-capstone-register-redacted.json', { userId: smokeUserId, username, tokenPresent: true });
  endStage();

  const headers = { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' };
  stage('capstone-initial-history');
  const initial = parseJson((await request('/api/capstones/reports', { headers, attempts: 3 })).text, 'Initial capstone history');
  if (!Array.isArray(initial.reports) || initial.reports.length !== 0) throw new Error('New capstone account must have empty history');
  endStage();

  stage('capstone-report-create');
  reportId = randomUUID();
  const report = passedReport(smokeUserId, reportId);
  const created = parseJson((await request('/api/capstones/reports', {
    method: 'POST', headers, body: JSON.stringify({ report }), expected: [201], attempts: 3
  })).text, 'Capstone create');
  if (!created.ok || created.idempotent !== false) throw new Error('Capstone report create contract failed');
  endStage();

  stage('capstone-report-round-trip');
  const history = parseJson((await request('/api/capstones/reports', { headers, attempts: 3 })).text, 'Capstone history');
  const stored = history.reports?.find(item => item.id === reportId);
  if (!stored || stored.score !== 100 || Object.keys(stored.submissionFiles || {}).length !== 3 || stored.checks?.length !== 10) {
    throw new Error('Capstone report round-trip mismatch');
  }
  endStage();

  stage('capstone-report-idempotent');
  const repeated = parseJson((await request('/api/capstones/reports', {
    method: 'POST', headers, body: JSON.stringify({ report }), expected: [200], attempts: 2
  })).text, 'Capstone idempotent replay');
  if (!repeated.ok || repeated.idempotent !== true) throw new Error('Exact capstone replay must be idempotent');
  endStage();

  stage('capstone-report-immutable');
  const mutated = { ...report, score: 99, bestScore: 100 };
  await request('/api/capstones/reports', {
    method: 'POST', headers, body: JSON.stringify({ report: mutated }), expected: [409], attempts: 1,
    diagnosticFile: 'cloudflare-capstone-immutable.json'
  });
  endStage();

  stage('capstone-owner-mismatch');
  const foreign = passedReport(randomUUID());
  await request('/api/capstones/reports', {
    method: 'POST', headers, body: JSON.stringify({ report: foreign }), expected: [403], attempts: 1,
    diagnosticFile: 'cloudflare-capstone-owner-mismatch.json'
  });
  endStage();

  stage('capstone-delete-account');
  await deleteSmokeAccount();
  if (!accountDeleted) throw new Error('Capstone smoke account cleanup failed');
  endStage();

  await verifyCascade();

  stage('capstone-revoked-session');
  await request('/api/capstones/reports', { headers, expected: [401], attempts: 2 });
  endStage();

  writeJson('cloudflare-capstone-summary.json', {
    projectId: report.projectId,
    score: report.score,
    fileCount: report.files.length,
    checkCount: report.checks.length,
    immutableConflict: true,
    cascadeVerified: true
  });
  console.log('Capstone production smoke passed: immutable report, round-trip, idempotency, owner isolation, cascade cleanup and revoked session.');
} catch (error) {
  writeFileSync('cloudflare-capstone-failure.txt', `stage=${stageName}\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  await deleteSmokeAccount();
  throw error;
}
