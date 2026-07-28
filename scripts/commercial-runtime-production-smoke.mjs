import { writeFileSync } from 'node:fs';

const deployUrl = String(process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!deployUrl) throw new Error('DEPLOY_URL is required');

const stageFile = 'cloudflare-commercial-stage.txt';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const expectedBoolean = (name, fallback = false) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
};

function stage(name) {
  writeFileSync(stageFile, `${name}\n`);
  console.log(`::group::Cloudflare commercial runtime · ${name}`);
}
function endStage() {
  console.log('::endgroup::');
}

async function request(path, { headers = {}, expected = [200], attempts = 5 } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${deployUrl}${path}`, { headers, redirect: 'follow' });
      const text = await response.text();
      last = { response, text };
      if (expected.includes(response.status)) return last;
      console.warn(`${path}: attempt ${attempt}/${attempts}, HTTP ${response.status}`);
    } catch (error) {
      last = { error };
      console.warn(`${path}: attempt ${attempt}/${attempts} failed`, error);
    }
    if (attempt < attempts) await sleep(3_000);
  }
  throw new Error(`${path} did not return ${expected.join('/')} (last ${last?.response?.status || 'network error'})`);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

stage('commercial-capabilities');
const capabilitiesResult = await request('/api/capabilities');
const capabilitiesPayload = parseJson(capabilitiesResult.text, 'Capabilities');
const capabilities = capabilitiesPayload.capabilities;
if (!capabilities
  || capabilities.version !== 1
  || capabilities.usernamePassword !== true
  || capabilities.recoveryCodes !== true) {
  throw new Error(`Capability base contract failed: ${JSON.stringify(capabilitiesPayload)}`);
}
for (const [environmentName, capabilityName] of [
  ['EXPECT_EMAIL_VERIFICATION', 'emailVerification'],
  ['EXPECT_SMS_VERIFICATION', 'smsVerification'],
  ['EXPECT_TURNSTILE', 'turnstile'],
  ['EXPECT_ADMIN_CONSOLE', 'adminConsole']
]) {
  const expected = expectedBoolean(environmentName);
  if (capabilities[capabilityName] !== expected) {
    throw new Error(`${capabilityName} expected ${expected}, received ${capabilities[capabilityName]}`);
  }
}
for (const header of ['x-content-type-options', 'x-frame-options', 'content-security-policy', 'strict-transport-security']) {
  if (!capabilitiesResult.response.headers.get(header)) throw new Error(`Capabilities response is missing ${header}`);
}
writeFileSync('cloudflare-commercial-capabilities.json', `${JSON.stringify(capabilitiesPayload, null, 2)}\n`);
endStage();

stage('commercial-cors');
const allowedOrigin = String(process.env.EXPECTED_ALLOWED_ORIGIN || '').trim();
if (!allowedOrigin) throw new Error('EXPECTED_ALLOWED_ORIGIN is required');
const allowed = await request('/api/capabilities', { headers: { origin: allowedOrigin } });
if (allowed.response.headers.get('access-control-allow-origin') !== allowedOrigin) {
  throw new Error('Configured production origin did not receive an exact CORS response');
}
const rejected = await request('/api/capabilities', {
  headers: { origin: 'https://commercial-smoke-rejected.invalid' },
  expected: [403]
});
if (rejected.response.headers.has('access-control-allow-origin')) {
  throw new Error('Rejected origin received an access-control-allow-origin header');
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
  productName: capabilitiesPayload.productName || null,
  environment: capabilitiesPayload.environment || null,
  capabilities,
  allowedOrigin,
  disabledAdminHidden: !expectedAdmin
}, null, 2)}\n`);
endStage();
