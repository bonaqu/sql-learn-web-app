import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';

const base = String(process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!base) throw new Error('DEPLOY_URL is required');

const stageFile = 'cloudflare-learning-analytics-stage.txt';
const failureFile = 'cloudflare-learning-analytics-failure.txt';
const username = `analytics_${Date.now().toString(36)}`.slice(0, 30);
const password = `Analytics-${crypto.randomUUID()}-8z!`;
let token = '';
let recoveryCode = '';
let userId = '';
let deleted = false;
let stage = 'unauthenticated';

function weekStart() {
  const date = new Date();
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return copy.toISOString().slice(0, 10);
}

async function mark(next) {
  stage = next;
  await fs.writeFile(stageFile, `${next}\n`);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, text };
}

function expectStatus(result, status, label) {
  if (result.response.status !== status) throw new Error(`${label}: expected ${status}, got ${result.response.status}: ${result.text.slice(0, 800)}`);
  if (result.response.headers.get('x-learning-analytics-contract') !== 'learning-analytics-v1' && status !== 401) {
    throw new Error(`${label}: missing learning-analytics-v1 contract header`);
  }
}

function snapshot(extraRow = {}) {
  return {
    version: 1,
    periodStart: weekStart(),
    courseVersion: 3,
    rows: [{
      moduleId: 'sql-thinking',
      opened: 2,
      attempted: 2,
      understood: 1,
      independent: 1,
      retained: 0,
      lapses: 1,
      remediations: 1,
      remediationSuccesses: 1,
      studyMinutesBucket: 15,
      overload: 1,
      stalled: 0,
      reviewDebt: 0,
      topDiagnosticKind: 'result-shape',
      ...extraRow
    }],
    experiments: { 'remediation-copy-v1': 'control' }
  };
}

async function deleteAccount() {
  if (!token || !recoveryCode || deleted) return;
  const result = await request('/api/profile', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: password, recoveryCode, confirm: 'DELETE' })
  });
  if (result.response.status === 200) deleted = true;
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

function d1Count(table) {
  const stdout = execFileSync('npx', [
    'wrangler', 'd1', 'execute', 'sql-academy', '--remote', '--config', 'wrangler.deploy.jsonc',
    '--command', `SELECT COUNT(*) AS count FROM ${table} WHERE user_id = '${userId}'`, '--yes', '--json'
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return findCount(JSON.parse(stdout));
}

try {
  await mark('unauthenticated');
  token = '';
  expectStatus(await request('/api/learning-analytics/preferences'), 401, 'unauthenticated preference');

  await mark('register');
  const registered = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, displayName: 'Analytics smoke', deviceName: 'GitHub Actions' })
  });
  if (registered.response.status !== 201) throw new Error(`register failed: ${registered.text}`);
  token = String(registered.body?.session?.token || '');
  recoveryCode = String(registered.body?.recoveryCodes?.[0] || '');
  userId = String(registered.body?.user?.id || '');
  if (!token || !recoveryCode || !userId) throw new Error('registration credentials missing');

  await mark('default-off');
  const initial = await request('/api/learning-analytics/preferences');
  expectStatus(initial, 200, 'initial preference');
  if (initial.body?.sharing !== 'off') throw new Error(`analytics must default off: ${initial.text}`);

  await mark('reject-without-opt-in');
  const blocked = await request('/api/learning-analytics/snapshot', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: snapshot() })
  });
  expectStatus(blocked, 403, 'snapshot without opt-in');

  await mark('enable-opt-in');
  const enabled = await request('/api/learning-analytics/preferences', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sharing: 'coarse-opt-in' })
  });
  expectStatus(enabled, 200, 'enable opt-in');
  if (enabled.body?.sharing !== 'coarse-opt-in') throw new Error(`opt-in did not persist: ${enabled.text}`);

  await mark('reject-sql-field');
  const rejected = await request('/api/learning-analytics/snapshot', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: snapshot({ sql: 'SELECT * FROM users' }) })
  });
  expectStatus(rejected, 400, 'forbidden SQL field');

  await mark('write-snapshot');
  const stored = await request('/api/learning-analytics/snapshot', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: snapshot() })
  });
  expectStatus(stored, 200, 'write snapshot');
  if (stored.body?.rows !== 1) throw new Error(`snapshot row count mismatch: ${stored.text}`);

  await mark('export-round-trip');
  const exported = await request('/api/learning-analytics/export');
  expectStatus(exported, 200, 'analytics export');
  const exportedText = JSON.stringify(exported.body).toUpperCase();
  if (exported.body?.sharing !== 'coarse-opt-in' || exported.body?.snapshots?.length !== 1) throw new Error(`export mismatch: ${exported.text}`);
  if (exportedText.includes('SELECT * FROM USERS') || exportedText.includes(username.toUpperCase())) throw new Error('private identity or SQL leaked into analytics export');

  await mark('cohort-suppression');
  const report = await request('/api/learning-analytics/report');
  expectStatus(report, 200, 'cohort report');
  if (report.body?.minimumCohort !== 5 || report.body?.rows?.length !== 0 || report.body?.suppressedRows < 1) {
    throw new Error(`small cohort was not suppressed: ${report.text}`);
  }

  await mark('opt-out-delete');
  const disabled = await request('/api/learning-analytics/preferences', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sharing: 'off' })
  });
  expectStatus(disabled, 200, 'disable analytics');
  const emptyExport = await request('/api/learning-analytics/export');
  expectStatus(emptyExport, 200, 'export after opt-out');
  if (emptyExport.body?.sharing !== 'off' || emptyExport.body?.snapshots?.length !== 0) throw new Error(`opt-out did not delete snapshots: ${emptyExport.text}`);

  await mark('recreate-for-cascade');
  expectStatus(await request('/api/learning-analytics/preferences', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sharing: 'coarse-opt-in' })
  }), 200, 're-enable analytics');
  expectStatus(await request('/api/learning-analytics/snapshot', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: snapshot() })
  }), 200, 'recreate snapshot');

  await mark('delete-account');
  await deleteAccount();
  if (!deleted) throw new Error('account cleanup failed');

  await mark('verify-cascade');
  if (d1Count('learning_analytics_preferences') !== 0 || d1Count('learning_analytics_snapshots') !== 0) {
    throw new Error('analytics rows survived account deletion');
  }

  await mark('verify-revoked');
  expectStatus(await request('/api/learning-analytics/export'), 401, 'revoked analytics session');

  await mark('complete');
  await fs.writeFile('cloudflare-learning-analytics-summary.json', JSON.stringify({
    defaultOff: true,
    explicitOptIn: true,
    sqlFieldRejected: true,
    smallCohortSuppressed: true,
    optOutDeleted: true,
    cascadeVerified: true,
    revokedSessionVerified: true
  }, null, 2));
  console.log('Learning analytics production smoke passed: default-off, SQL-free snapshots, k=5 suppression, export, opt-out deletion and account cascade.');
} catch (error) {
  await fs.writeFile(failureFile, `stage=${stage}\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  await deleteAccount();
  throw error;
}
