import fs from 'node:fs/promises';

const base = String(process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!base) throw new Error('DEPLOY_URL is required');

const PROGRESS_PATH = '/api/mastery/progress';
const stageFile = 'cloudflare-mastery-stage.txt';
const failureFile = 'cloudflare-mastery-failure.txt';
const username = `mastery_${Date.now().toString(36)}`.slice(0, 30);
const password = `Mastery-${crypto.randomUUID()}-9a!`;
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

function expectMasteryContract(result, label) {
  const contract = result.response.headers.get('x-progress-contract');
  if (contract !== 'mastery-v1') {
    throw new Error(`${label}: expected x-progress-contract=mastery-v1, got ${contract || 'missing'}`);
  }
}

const diagnostic = {
  kind: 'join-cardinality',
  title: 'JOIN размножил или потерял строки',
  explanation: 'Кардинальность связи не соответствует ожидаемой гранулярности результата.',
  nextStep: 'Посчитай строки на join key с обеих сторон и проверь условие ON.',
  atlasId: 'logical-join-multiplication'
};

const progress = {
  version: 4,
  completed: ['task-001'],
  taskStats: {
    'task-001': {
      attempts: 4,
      incorrect: 3,
      hintsUsed: 1,
      solutionViews: 1,
      independentPasses: 1,
      lastIndependentAt: '2026-07-25T18:00:00.000Z',
      errorKinds: { syntax: 1, 'join-cardinality': 2 },
      lastDiagnostic: diagnostic,
      lastAttemptAt: '2026-07-25T18:00:00.000Z',
      completedAt: '2026-07-25T17:00:00.000Z'
    }
  },
  xp: 60,
  streak: 1,
  history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 })),
  lastTask: 'task-001',
  lastStudyDate: '2026-07-25'
};

try {
  await mark('register');
  const registered = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, displayName: 'Mastery smoke', deviceName: 'GitHub Actions' })
  });
  expectStatus(registered, 201, 'register');
  token = String(registered.body?.session?.token || '');
  recoveryCode = String(registered.body?.recoveryCodes?.[0] || '');
  if (!token || !recoveryCode) throw new Error('register: token or recovery code is missing');

  await mark('initial-progress');
  const initial = await request(PROGRESS_PATH);
  expectStatus(initial, 200, 'initial progress');
  expectMasteryContract(initial, 'initial progress');
  if (initial.body?.progress !== null || initial.body?.revision !== 0) {
    throw new Error(`initial progress contract mismatch: ${initial.text}`);
  }

  await mark('put-mastery-evidence');
  const stored = await request(PROGRESS_PATH, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress, baseRevision: 0 })
  });
  expectStatus(stored, 200, 'put mastery evidence');
  expectMasteryContract(stored, 'put mastery evidence');
  if (stored.body?.revision !== 1 || stored.body?.progress?.taskStats?.['task-001']?.independentPasses !== 1) {
    throw new Error(`expected canonical revision 1 response, got ${stored.text}`);
  }

  await mark('get-mastery-evidence');
  const fetched = await request(PROGRESS_PATH);
  expectStatus(fetched, 200, 'get mastery evidence');
  expectMasteryContract(fetched, 'get mastery evidence');
  const stats = fetched.body?.progress?.taskStats?.['task-001'];
  if (fetched.body?.revision !== 1
    || stats?.independentPasses !== 1
    || stats?.solutionViews !== 1
    || stats?.errorKinds?.['join-cardinality'] !== 2
    || stats?.lastDiagnostic?.kind !== 'join-cardinality') {
    throw new Error(`mastery evidence round-trip mismatch: ${fetched.text}`);
  }

  await mark('reject-cached-legacy-overwrite');
  const destructiveLegacy = structuredClone(progress);
  destructiveLegacy.completed = [];
  destructiveLegacy.taskStats = {};
  destructiveLegacy.xp = 0;
  const legacyRejected = await request('/api/progress', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(destructiveLegacy)
  });
  expectStatus(legacyRejected, 428, 'cached legacy overwrite');
  if (legacyRejected.body?.code !== 'PROGRESS_REVISION_REQUIRED') {
    throw new Error(`legacy overwrite did not return the recovery contract: ${legacyRejected.text}`);
  }
  const preservedAfterLegacy = await request(PROGRESS_PATH);
  expectStatus(preservedAfterLegacy, 200, 'preserved after legacy overwrite');
  if (preservedAfterLegacy.body?.revision !== 1
    || preservedAfterLegacy.body?.progress?.taskStats?.['task-001']?.independentPasses !== 1) {
    throw new Error(`legacy overwrite changed canonical progress: ${preservedAfterLegacy.text}`);
  }

  await mark('reject-invalid-diagnostic');
  const invalid = structuredClone(progress);
  invalid.taskStats['task-001'].lastDiagnostic.kind = 'made-up-kind';
  const rejected = await request(PROGRESS_PATH, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress: invalid, baseRevision: 1 })
  });
  expectStatus(rejected, 400, 'invalid diagnostic');
  expectMasteryContract(rejected, 'invalid diagnostic');

  await mark('reject-stale-revision');
  const secondDeviceProgress = structuredClone(progress);
  secondDeviceProgress.completed = ['task-002'];
  secondDeviceProgress.taskStats = {
    'task-002': {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      independentPasses: 1,
      lastIndependentAt: '2026-07-25T19:00:00.000Z',
      lastAttemptAt: '2026-07-25T19:00:00.000Z',
      completedAt: '2026-07-25T19:00:00.000Z'
    }
  };
  secondDeviceProgress.lastTask = 'task-002';
  const conflict = await request(PROGRESS_PATH, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress: secondDeviceProgress, baseRevision: 0 })
  });
  expectStatus(conflict, 409, 'stale revision');
  expectMasteryContract(conflict, 'stale revision');

  await mark('reread-merge-and-update-independent-evidence');
  const reread = await request(PROGRESS_PATH);
  expectStatus(reread, 200, 'reread after conflict');
  const nextProgress = structuredClone(reread.body.progress);
  nextProgress.completed = [...new Set([...nextProgress.completed, ...secondDeviceProgress.completed])].sort();
  nextProgress.taskStats = { ...nextProgress.taskStats, ...secondDeviceProgress.taskStats };
  nextProgress.lastTask = secondDeviceProgress.lastTask;
  const updated = await request(PROGRESS_PATH, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress: nextProgress, baseRevision: reread.body.revision })
  });
  expectStatus(updated, 200, 'update mastery evidence');
  expectMasteryContract(updated, 'update mastery evidence');
  if (updated.body?.revision !== 2
    || !updated.body?.progress?.completed?.includes('task-001')
    || !updated.body?.progress?.completed?.includes('task-002')) {
    throw new Error(`expected canonical merged revision 2, got ${updated.text}`);
  }

  await mark('verify-updated-evidence');
  const verified = await request(PROGRESS_PATH);
  expectStatus(verified, 200, 'verify mastery evidence');
  expectMasteryContract(verified, 'verify mastery evidence');
  if (verified.body?.revision !== 2
    || verified.body?.progress?.taskStats?.['task-001']?.independentPasses !== 1
    || verified.body?.progress?.taskStats?.['task-002']?.independentPasses !== 1) {
    throw new Error(`merged two-device evidence is missing: ${verified.text}`);
  }

  await mark('delete-account');
  const deleted = await request('/api/profile', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: password, recoveryCode, confirm: 'DELETE' })
  });
  expectStatus(deleted, 200, 'delete account');

  await mark('verify-revoked');
  const revoked = await request(PROGRESS_PATH);
  expectStatus(revoked, 401, 'revoked progress session');
  expectMasteryContract(revoked, 'revoked progress session');

  await mark('complete');
  console.log('Mastery progress production smoke passed: canonical revision responses, cached-client fail-closed behavior, two-device conflict recovery and account cleanup.');
} catch (error) {
  await fs.writeFile(failureFile, `stage=${stage}\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  throw error;
}
