import { writeFileSync } from 'node:fs';

const deployUrl = String(process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!deployUrl) throw new Error('DEPLOY_URL is required');
const stageFile = 'cloudflare-commercial-stage.txt';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const expectedBoolean = (name, fallback = false) => {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : String(raw).toLowerCase() === 'true';
};
function stage(name) { writeFileSync(stageFile, `${name}\n`); console.log(`::group::Cloudflare commercial runtime · ${name}`); }
function endStage() { console.log('::endgroup::'); }

async function request(path, { method = 'GET', headers = {}, body, expected = [200], attempts = 5 } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${deployUrl}${path}`, { method, headers, body, redirect: 'follow' });
      const text = await response.text();
      last = { response, text };
      if (expected.includes(response.status)) return last;
    } catch (error) { last = { error }; }
    if (attempt < attempts) await sleep(3_000);
  }
  throw new Error(`${path} did not return ${expected.join('/')} (last ${last?.response?.status || 'network error'})`);
}
function parseJson(text, label) { try { return JSON.parse(text); } catch { throw new Error(`${label} returned invalid JSON`); } }

stage('commercial-capabilities');
const result = await request('/api/capabilities');
const capabilities = parseJson(result.text, 'Capabilities');
if (capabilities.contract !== 'commercial-capabilities-v1'
  || capabilities.authentication?.usernamePassword !== true
  || capabilities.authentication?.recoveryCodes !== true) {
  throw new Error(`Capability base contract failed: ${JSON.stringify(capabilities)}`);
}
for (const [environmentName, name] of [
  ['EXPECT_EMAIL_VERIFICATION', 'emailVerification'],
  ['EXPECT_SMS_VERIFICATION', 'smsVerification'],
  ['EXPECT_TURNSTILE', 'turnstile'],
  ['EXPECT_ADMIN_CONSOLE', 'adminConsole']
]) {
  const expected = expectedBoolean(environmentName);
  const actual = capabilities.integrations?.[name]?.enabled;
  if (actual !== expected) throw new Error(`${name} expected ${expected}, received ${actual}`);
}
for (const header of ['x-commercial-capabilities-contract', 'x-content-type-options', 'x-frame-options', 'content-security-policy', 'strict-transport-security']) {
  if (!result.response.headers.get(header)) throw new Error(`Capabilities response is missing ${header}`);
}
writeFileSync('cloudflare-commercial-capabilities.json', `${JSON.stringify(capabilities, null, 2)}\n`);
endStage();

stage('commercial-cors');
const allowedOrigin = String(process.env.EXPECTED_ALLOWED_ORIGIN || '').trim();
if (!allowedOrigin) throw new Error('EXPECTED_ALLOWED_ORIGIN is required');
const allowed = await request('/api/capabilities', { headers: { origin: allowedOrigin } });
if (allowed.response.headers.get('access-control-allow-origin') !== allowedOrigin) throw new Error('Configured production origin did not receive exact CORS');
const rejected = await request('/api/capabilities', { headers: { origin: 'https://commercial-smoke-rejected.invalid' }, expected: [403] });
if (rejected.response.headers.has('access-control-allow-origin')) throw new Error('Rejected origin received an allow-origin header');
endStage();

stage('commercial-contact-boundary');
const expectedEmail = expectedBoolean('EXPECT_EMAIL_VERIFICATION');
const expectedSms = expectedBoolean('EXPECT_SMS_VERIFICATION');
let disabledContactHidden = false;
if (!expectedEmail && !expectedSms) {
  const challenge = await request('/api/auth/contact/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel: 'email', purpose: 'register', destination: 'smoke@example.invalid' }),
    expected: [404]
  });
  const confirmation = await request('/api/auth/contact/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: '00000000-0000-4000-8000-000000000001', code: '000000' }),
    expected: [404]
  });
  const challengePayload = parseJson(challenge.text, 'Contact challenge boundary');
  const confirmationPayload = parseJson(confirmation.text, 'Contact confirmation boundary');
  if (challengePayload.error !== 'Not found' || confirmationPayload.error !== 'Not found') {
    throw new Error('Disabled verified-contact surface was not hidden');
  }
  disabledContactHidden = true;
}
endStage();

stage('commercial-admin-boundary');
const expectedAdmin = expectedBoolean('EXPECT_ADMIN_CONSOLE');
const admin = await request('/api/admin/health', { expected: [expectedAdmin ? 401 : 404] });
const adminPayload = parseJson(admin.text, 'Admin boundary');
if (!expectedAdmin && adminPayload.error !== 'Not found') throw new Error('Disabled admin surface was not hidden');
endStage();

stage('commercial-complete');
writeFileSync('cloudflare-commercial-summary.json', `${JSON.stringify({
  ok: true,
  capabilities,
  allowedOrigin,
  disabledContactHidden,
  disabledAdminHidden: !expectedAdmin
}, null, 2)}\n`);
endStage();
