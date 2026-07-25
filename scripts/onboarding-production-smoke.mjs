import fs from 'node:fs/promises';

const base = String(process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!base) throw new Error('DEPLOY_URL is required');

const ENDPOINT = '/api/onboarding/profile';
const stageFile = 'cloudflare-onboarding-stage.txt';
const failureFile = 'cloudflare-onboarding-failure.txt';
const username = `onboard_${Date.now().toString(36)}`.slice(0, 30);
const password = `Onboard-${crypto.randomUUID()}-8z!`;
let token = '';
let recoveryCode = '';
let stage = 'register';

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
  if (result.response.status !== status) {
    throw new Error(`${label}: expected ${status}, got ${result.response.status}: ${result.text.slice(0, 800)}`);
  }
}

function expectContract(result, label) {
  const contract = result.response.headers.get('x-onboarding-contract');
  if (contract !== 'onboarding-v1') throw new Error(`${label}: missing onboarding-v1 contract header`);
}

function profile(overrides = {}) {
  return {
    version: 1,
    goal: 'support',
    experience: 'regular',
    dailyMinutes: 25,
    studyDays: ['MO', 'WE', 'FR'],
    pace: 'steady',
    placement: {
      status: 'pending',
      reportId: null,
      score: null,
      level: null,
      recommendedTrack: 'support',
      strongModuleIds: [],
      focusModuleIds: [],
      completedAt: null
    },
    firstWeekPlan: [],
    recoveryRule: 'Не удваивать следующую сессию после пропуска.',
    completedAt: null,
    updatedAt: '2026-07-25T18:00:00.000Z',
    ...overrides
  };
}

try {
  await mark('register');
  const registered = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, displayName: 'Onboarding smoke', deviceName: 'GitHub Actions' })
  });
  expectStatus(registered, 201, 'register');
  token = String(registered.body?.session?.token || '');
  recoveryCode = String(registered.body?.recoveryCodes?.[0] || '');
  if (!token || !recoveryCode) throw new Error('register: token or recovery code missing');

  await mark('initial-profile');
  const initial = await request(ENDPOINT);
  expectStatus(initial, 200, 'initial onboarding profile');
  expectContract(initial, 'initial onboarding profile');
  if (initial.body?.profile !== null || initial.body?.revision !== 0) throw new Error(`unexpected initial profile: ${initial.text}`);

  await mark('put-pending-profile');
  const pending = profile();
  const stored = await request(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: pending, baseRevision: 0 })
  });
  expectStatus(stored, 200, 'put pending profile');
  expectContract(stored, 'put pending profile');
  if (stored.body?.revision !== 1) throw new Error(`expected revision 1: ${stored.text}`);

  await mark('reject-invalid-profile');
  const invalid = profile({ studyDays: ['MO'] });
  const rejected = await request(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: invalid, baseRevision: 1 })
  });
  expectStatus(rejected, 400, 'invalid onboarding profile');
  expectContract(rejected, 'invalid onboarding profile');

  await mark('reject-stale-revision');
  const conflict = await request(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: pending, baseRevision: 0 })
  });
  expectStatus(conflict, 409, 'stale onboarding revision');
  expectContract(conflict, 'stale onboarding revision');

  await mark('put-completed-placement');
  const completedAt = '2026-07-25T19:00:00.000Z';
  const completed = profile({
    placement: {
      status: 'completed',
      reportId: 'diagnostic-production-smoke',
      score: 78,
      level: 'working',
      recommendedTrack: 'support',
      strongModuleIds: ['select', 'filtering'],
      focusModuleIds: ['joins', 'windows'],
      completedAt
    },
    firstWeekPlan: [
      { id: 'week-1-mo', day: 'MO', minutes: 25, kind: 'orientation', title: 'Контракт результата', detail: 'Описать grain и решить independent task.', moduleId: null },
      { id: 'week-2-we', day: 'WE', minutes: 25, kind: 'practice', title: 'Independent practice: JOIN', detail: 'Решить без hints и solution.', moduleId: 'joins' },
      { id: 'week-3-fr', day: 'FR', minutes: 25, kind: 'review', title: 'Retrieval review', detail: 'Воспроизвести модель по памяти и повторить ошибочную задачу.', moduleId: null }
    ],
    completedAt,
    updatedAt: completedAt
  });
  const updated = await request(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: completed, baseRevision: 1 })
  });
  expectStatus(updated, 200, 'put completed placement');
  expectContract(updated, 'put completed placement');
  if (updated.body?.revision !== 2) throw new Error(`expected revision 2: ${updated.text}`);

  await mark('verify-completed-profile');
  const fetched = await request(ENDPOINT);
  expectStatus(fetched, 200, 'get completed profile');
  expectContract(fetched, 'get completed profile');
  const week = fetched.body?.profile?.firstWeekPlan || [];
  if (fetched.body?.revision !== 2
    || fetched.body?.profile?.placement?.score !== 78
    || fetched.body?.profile?.placement?.recommendedTrack !== 'support'
    || week.length !== 3
    || !week.some(item => item.kind === 'practice')
    || !week.some(item => item.kind === 'review')) {
    throw new Error(`completed onboarding round-trip mismatch: ${fetched.text}`);
  }

  await mark('delete-account');
  const deleted = await request('/api/profile', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: password, recoveryCode, confirm: 'DELETE' })
  });
  expectStatus(deleted, 200, 'delete account');

  await mark('verify-revoked');
  const revoked = await request(ENDPOINT);
  expectStatus(revoked, 401, 'revoked onboarding session');

  await mark('complete');
  console.log('Onboarding production smoke passed: revisions, placement evidence, practice, retention and account cleanup.');
} catch (error) {
  await fs.writeFile(failureFile, `stage=${stage}\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  throw error;
}
