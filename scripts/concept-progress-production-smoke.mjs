import fs from 'node:fs/promises';

const base = String(process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!base) throw new Error('DEPLOY_URL is required');

const ENDPOINT = '/api/curriculum/progress';
const stageFile = 'cloudflare-concepts-stage.txt';
const failureFile = 'cloudflare-concepts-failure.txt';
const username = `concept_${Date.now().toString(36)}`.slice(0, 30);
const password = `Concept-${crypto.randomUUID()}-8z!`;
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

function answers(count, answeredAt) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    `concept-smoke-${String(index + 1).padStart(3, '0')}`,
    { optionIndex: index % 4, correct: index % 3 !== 0, answeredAt }
  ]));
}

function curriculumProgress(answerCount, updatedAt) {
  return {
    version: 1,
    completedSections: ['sql-thinking-concept'],
    completedLessons: [],
    completedProjects: [],
    answers: answers(answerCount, updatedAt),
    projectDrafts: {},
    bookmark: { lessonId: 'lesson-sql-thinking', sectionId: 'sql-thinking-concept', updatedAt },
    updatedAt
  };
}

try {
  await mark('register');
  const registered = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, displayName: 'Concept smoke', deviceName: 'GitHub Actions' })
  });
  expectStatus(registered, 201, 'register');
  token = String(registered.body?.session?.token || '');
  recoveryCode = String(registered.body?.recoveryCodes?.[0] || '');
  if (!token || !recoveryCode) throw new Error('register: token or recovery code missing');

  await mark('initial-progress');
  const initial = await request(ENDPOINT);
  expectStatus(initial, 200, 'initial curriculum progress');
  if (initial.body?.progress !== null || initial.body?.updatedAt !== null) {
    throw new Error(`unexpected initial curriculum state: ${initial.text}`);
  }

  await mark('put-full-concept-history');
  const now = new Date().toISOString();
  const full = curriculumProgress(144, now);
  const stored = await request(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress: full, baseUpdatedAt: null })
  });
  expectStatus(stored, 200, 'put full concept history');
  const revision = String(stored.body?.updatedAt || '');
  if (!stored.body?.ok || !revision) throw new Error(`missing curriculum update timestamp: ${stored.text}`);

  await mark('verify-full-concept-history');
  const fetched = await request(ENDPOINT);
  expectStatus(fetched, 200, 'get full concept history');
  const fetchedAnswers = fetched.body?.progress?.answers || {};
  if (fetched.body?.updatedAt !== revision
    || Object.keys(fetchedAnswers).length !== 144
    || fetchedAnswers['concept-smoke-001']?.optionIndex !== 0
    || fetchedAnswers['concept-smoke-144']?.optionIndex !== 3) {
    throw new Error(`full concept history round-trip mismatch: ${fetched.text.slice(0, 1200)}`);
  }

  await mark('reject-answer-ceiling');
  const oversized = curriculumProgress(221, new Date(Date.now() + 1000).toISOString());
  const rejected = await request(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress: oversized, baseUpdatedAt: revision })
  });
  expectStatus(rejected, 400, 'answer ceiling');

  await mark('verify-valid-state-preserved');
  const preserved = await request(ENDPOINT);
  expectStatus(preserved, 200, 'preserved concept history');
  if (preserved.body?.updatedAt !== revision
    || Object.keys(preserved.body?.progress?.answers || {}).length !== 144) {
    throw new Error(`rejected payload mutated valid progress: ${preserved.text.slice(0, 1200)}`);
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
  expectStatus(revoked, 401, 'revoked curriculum session');

  await mark('complete');
  console.log('Concept progress production smoke passed: 144-answer round-trip, 221-answer rejection, state preservation and account cleanup.');
} catch (error) {
  await fs.writeFile(failureFile, `stage=${stage}\n${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  throw error;
}
