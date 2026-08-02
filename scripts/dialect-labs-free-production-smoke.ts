import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dialectLabCase, type DialectResultValue } from '../src/data/dialect-lab-cases.ts';
import { dialectLabManifests } from '../src/data/dialect-lab-manifests.ts';

const deployUrl = String(process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!deployUrl) throw new Error('DEPLOY_URL is required');

const SERVER_DIALECTS = ['postgresql', 'mysql'] as const;
type ServerDialect = typeof SERVER_DIALECTS[number];

type PreviewPayload = {
  version: 1;
  labId: string;
  dialect: ServerDialect;
  executionMode: 'remote-sandbox';
  verificationMode: string;
  engineVersion: null;
  runnerVersion: null;
  contractDigest: string;
  passed: boolean;
  evidenceEligible: boolean;
  offlinePreview: boolean;
  referenceVerifiedBy: string;
  output: { columns: string[]; rows: DialectResultValue[][] } | null;
  normalizedPlan: string[];
  timeline: string[];
  errors: string[];
  resultDigest: string;
  durationMs: number;
  summary: string;
};

type RequestOptions = {
  expectedStatus?: number | number[];
  attempts?: number;
  delayMs?: number;
  diagnosticFile?: string;
  caseId?: string;
};

type HttpResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
};

const unique = randomBytes(6).toString('hex');
const username = `dialect-free-${unique}`;
const password = `Dialect-free-${randomBytes(12).toString('base64url')}!Aa9`;
const cookieJar = 'cloudflare-dialect-smoke-cookies.txt';
const matrixFile = 'cloudflare-dialect-reference-matrix.json';
const stageFile = 'cloudflare-dialect-stage.txt';
const failureFile = 'cloudflare-dialect-failure.txt';
let stageName = 'initializing';

function stage(name: string) {
  stageName = name;
  writeFileSync(stageFile, `${name}\n`, 'utf8');
}

function sleep(milliseconds: number) {
  execFileSync('sleep', [String(milliseconds / 1000)]);
}

function parseResponse(raw: string): HttpResponse {
  const marker = raw.lastIndexOf('\n__STATUS__:');
  if (marker < 0) throw new Error(`Malformed curl response: ${raw.slice(0, 300)}`);
  const payload = raw.slice(0, marker).trim();
  const trailer = raw.slice(marker + 1).trim().split('\n');
  const statusLine = trailer.find(line => line.startsWith('__STATUS__:'));
  const status = Number(statusLine?.slice('__STATUS__:'.length) || 0);
  const headers: Record<string, string> = {};
  for (const line of trailer) {
    if (!line.startsWith('__HEADER__:')) continue;
    const value = line.slice('__HEADER__:'.length);
    const separator = value.indexOf(':');
    if (separator > 0) headers[value.slice(0, separator).toLowerCase()] = value.slice(separator + 1);
  }
  return { status, body: payload, headers };
}

function curl(method: string, path: string, body?: unknown) {
  const args = [
    '-sS',
    '-b', cookieJar,
    '-c', cookieJar,
    '-X', method,
    `${deployUrl}${path}`,
    '-w', '\n__STATUS__:%{http_code}\n__HEADER__:retry-after:%header{retry-after}\n__HEADER__:cf-ray:%header{cf-ray}\n__HEADER__:x-request-id:%header{x-request-id}'
  ];
  if (body !== undefined) {
    args.push('-H', 'content-type: application/json', '--data', JSON.stringify(body));
  }
  const output = execFileSync('curl', args, { encoding: 'utf8' });
  return parseResponse(output);
}

function writeResponseDiagnostic(path: string, method: string, requestPath: string, response: HttpResponse, caseId?: string) {
  writeFileSync(path, JSON.stringify({
    at: new Date().toISOString(),
    stage: stageName,
    caseId: caseId || null,
    method,
    path: requestPath,
    status: response.status,
    cfRay: response.headers['cf-ray'] || null,
    requestId: response.headers['x-request-id'] || null,
    retryAfter: response.headers['retry-after'] || null,
    body: response.body
  }, null, 2), 'utf8');
}

function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}) {
  const expected = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus ?? 200];
  const attempts = Math.max(1, options.attempts ?? 1);
  const delayMs = Math.max(0, options.delayMs ?? 750);
  let last: HttpResponse | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = curl(method, path, body);
    if (options.diagnosticFile) writeResponseDiagnostic(options.diagnosticFile, method, path, last, options.caseId);
    if (expected.includes(last.status)) {
      const parsed = last.body ? JSON.parse(last.body) as T : ({} as T);
      return { status: last.status, body: parsed, headers: last.headers };
    }
    if (attempt < attempts) sleep(delayMs * attempt);
  }
  const response = last as HttpResponse;
  const identity = options.caseId ? ` for ${options.caseId}` : '';
  const ray = response.headers['cf-ray'] ? ` cf-ray=${response.headers['cf-ray']}` : '';
  throw new Error(`${method} ${path}${identity} returned ${response.status}; expected ${expected.join('/')} ${ray} body=${response.body.slice(0, 1200)}`);
}

function register() {
  return request<{
    user: { username: string };
    recoveryCodes: string[];
  }>('POST', '/api/auth/register', {
    username,
    password,
    displayName: 'Dialect Free Smoke',
    deviceName: 'Production smoke'
  }, {
    expectedStatus: [200, 201],
    attempts: 5,
    delayMs: 1_500,
    diagnosticFile: 'cloudflare-dialect-registration.json'
  }).body;
}

function acknowledgeRecoveryCodes(codes: string[]) {
  const digest = execFileSync('node', ['-e', [
    "const { createHash } = require('node:crypto');",
    'const values = JSON.parse(process.argv[1]);',
    "process.stdout.write(createHash('sha256').update(values.join('|')).digest('hex'));"
  ].join(''), JSON.stringify(codes)], { encoding: 'utf8' });
  request('POST', '/api/auth/recovery/acknowledge', { digest });
}

function login() {
  request('POST', '/api/auth/login', { username, password, deviceName: 'Production smoke' }, {
    attempts: 5,
    delayMs: 1_500,
    diagnosticFile: 'cloudflare-dialect-login.json'
  });
}

function expectArrayRows(actual: DialectResultValue[][], expected: DialectResultValue[][], label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} rows differ: ${JSON.stringify({ actual, expected })}`);
  }
}

function assertPreview(value: PreviewPayload, labId: string, dialect: ServerDialect) {
  const testCase = dialectLabCase(labId, dialect);
  if (!testCase) throw new Error(`Missing case ${labId}:${dialect}`);
  if (value.labId !== labId || value.dialect !== dialect) {
    throw new Error(`Preview identity mismatch: ${JSON.stringify(value)}`);
  }
  if (value.executionMode !== 'remote-sandbox'
    || value.verificationMode !== 'ci-reference-preview'
    || value.engineVersion !== null
    || value.runnerVersion !== null
    || value.passed
    || value.evidenceEligible
    || !value.offlinePreview
    || value.referenceVerifiedBy !== 'docker-ci'
    || !value.errors.includes('CI_REFERENCE_PREVIEW_ONLY')) {
    throw new Error(`${labId}:${dialect} was not an honest CI reference preview: ${JSON.stringify(value)}`);
  }
  if (!value.contractDigest.startsWith('fnv1a-') || !value.resultDigest.startsWith('fnv1a-')) {
    throw new Error(`${labId}:${dialect} preview digest is invalid`);
  }
  if (value.output === null) {
    if (testCase.expectedOutput !== null) throw new Error(`${labId}:${dialect} lost expected tabular output`);
  } else {
    if (testCase.expectedOutput === null) throw new Error(`${labId}:${dialect} returned unexpected tabular output`);
    if (JSON.stringify(value.output.columns) !== JSON.stringify(testCase.expectedOutput.columns)) {
      throw new Error(`${labId}:${dialect} columns differ`);
    }
    expectArrayRows(value.output.rows, testCase.expectedOutput.rows, `${labId}:${dialect}`);
  }
  if (JSON.stringify(value.normalizedPlan) !== JSON.stringify(testCase.expectedPlan)) {
    throw new Error(`${labId}:${dialect} normalized plan differs`);
  }
  if (JSON.stringify(value.timeline) !== JSON.stringify(testCase.expectedTimeline)) {
    throw new Error(`${labId}:${dialect} timeline differs`);
  }
  const serialized = JSON.stringify(value).toUpperCase();
  const forbidden = [testCase.referenceSql.toUpperCase(), 'SELECT TICKET_ID', 'NULLS LAST', 'ON DUPLICATE KEY'];
  for (const token of forbidden) {
    if (token.length >= 12 && serialized.includes(token)) {
      throw new Error(`${labId}:${dialect} preview leaked SQL: ${token.slice(0, 24)}`);
    }
  }
}

try {
  stage('register');
  const registration = register();
  if (registration.user.username !== username || registration.recoveryCodes.length !== 8) {
    throw new Error('Dialect smoke account registration failed');
  }
  stage('acknowledge recovery codes');
  acknowledgeRecoveryCodes(registration.recoveryCodes);

  stage('pre-policy preview');
  const prePolicyCase = dialectLabCase('dialect-null-ordering', 'postgresql');
  if (!prePolicyCase) throw new Error('Missing pre-policy reference case');
  const prePolicy = request<PreviewPayload>('POST', '/api/dialect-labs/execute', {
    labId: prePolicyCase.labId,
    dialect: prePolicyCase.dialect,
    sql: prePolicyCase.referenceSql
  }, {
    attempts: 2,
    delayMs: 1_000,
    caseId: `${prePolicyCase.labId}:${prePolicyCase.dialect}`,
    diagnosticFile: 'cloudflare-dialect-pre-policy.json'
  }).body;
  assertPreview(prePolicy, prePolicyCase.labId, 'postgresql');

  stage('policy rejection');
  const rejected = request<{ error?: string }>('POST', '/api/dialect-labs/execute', {
    labId: prePolicyCase.labId,
    dialect: prePolicyCase.dialect,
    sql: "SELECT PG_SLEEP(1), ticket_id FROM tickets ORDER BY ticket_id;"
  }, {
    expectedStatus: 400,
    attempts: 2,
    delayMs: 1_000,
    caseId: `${prePolicyCase.labId}:${prePolicyCase.dialect}:policy-rejection`,
    diagnosticFile: 'cloudflare-dialect-policy-rejection.json'
  }).body;
  if (!rejected.error?.includes('Запрещённая конструкция')) {
    throw new Error(`Server dialect policy did not reject forbidden SQL: ${JSON.stringify(rejected)}`);
  }

  stage('logout and login');
  request('POST', '/api/auth/logout');
  login();

  stage('all server-dialect CI reference previews');
  const matrix: Record<string, unknown> = {};
  for (const lab of dialectLabManifests) {
    for (const dialect of SERVER_DIALECTS) {
      const testCase = dialectLabCase(lab.id, dialect);
      if (!testCase) throw new Error(`Missing ${lab.id}:${dialect}`);
      const caseId = `${lab.id}:${dialect}`;
      stage(`preview ${caseId}`);
      writeFileSync('cloudflare-dialect-current-case.txt', `${caseId}\n`, 'utf8');
      const safeId = caseId.replace(/[^a-z0-9_-]+/gi, '-');
      const preview = request<PreviewPayload>('POST', '/api/dialect-labs/execute', {
        labId: lab.id,
        dialect,
        sql: testCase.referenceSql
      }, {
        attempts: 2,
        delayMs: 1_000,
        caseId,
        diagnosticFile: `cloudflare-dialect-preview-${safeId}.json`
      }).body;
      assertPreview(preview, lab.id, dialect);
      matrix[caseId] = {
        contractDigest: preview.contractDigest,
        resultDigest: preview.resultDigest,
        verificationMode: preview.verificationMode,
        engineVersion: preview.engineVersion,
        runnerVersion: preview.runnerVersion,
        output: preview.output,
        normalizedPlan: preview.normalizedPlan,
        timeline: preview.timeline,
        errors: preview.errors
      };
    }
  }
  stage('completed');
  writeFileSync(matrixFile, JSON.stringify(matrix, null, 2), 'utf8');
  console.log(`Cloudflare Free dialect reference smoke passed for ${Object.keys(matrix).length} PostgreSQL/MySQL previews with zero false mastery.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeFileSync(failureFile, `stage=${stageName}\n${message}\n`, 'utf8');
  throw error;
} finally {
  try {
    request('POST', '/api/auth/logout', undefined, {
      expectedStatus: [200, 401],
      diagnosticFile: 'cloudflare-dialect-final-logout.json'
    });
  } catch (error) {
    appendFileSync(failureFile, `logout=${error instanceof Error ? error.message : String(error)}\n`, 'utf8');
  }
}
