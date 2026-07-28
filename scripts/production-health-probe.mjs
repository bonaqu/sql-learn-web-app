import { writeFileSync } from 'node:fs';

const rawUrl = String(process.env.PRODUCTION_HEALTH_URL || '').trim();
if (!rawUrl) throw new Error('PRODUCTION_HEALTH_URL is required');

const input = new URL(rawUrl);
if (input.protocol !== 'https:' && input.hostname !== '127.0.0.1' && input.hostname !== 'localhost') {
  throw new Error('PRODUCTION_HEALTH_URL must use HTTPS outside localhost');
}
const base = input.pathname.startsWith('/api/')
  ? new URL('/', input)
  : new URL(input.pathname.endsWith('/') ? input.pathname : `${input.pathname}/`, input);

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function getJson(path, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(new URL(path.replace(/^\//, ''), base), {
        headers: { accept: 'application/json', 'user-agent': 'sql-academy-production-health/1' },
        redirect: 'follow',
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 200)}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${path} returned invalid JSON`);
      }
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(2_000 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error(`${path} failed`);
}

const health = await getJson('/api/health');
if (!health?.ok || !health?.d1 || !health?.kv || health.progressVersion !== 4 || health.curriculumVersion !== 1) {
  throw new Error(`Health contract failed: ${JSON.stringify(health)}`);
}

const capabilityPayload = await getJson('/api/capabilities');
const capabilities = capabilityPayload?.capabilities;
if (!capabilities || capabilities.version !== 1 || capabilities.usernamePassword !== true || capabilities.recoveryCodes !== true) {
  throw new Error(`Capability contract failed: ${JSON.stringify(capabilityPayload)}`);
}

for (const [environmentName, capabilityName] of [
  ['EXPECT_EMAIL_VERIFICATION', 'emailVerification'],
  ['EXPECT_SMS_VERIFICATION', 'smsVerification'],
  ['EXPECT_TURNSTILE', 'turnstile'],
  ['EXPECT_ADMIN_CONSOLE', 'adminConsole']
]) {
  const expectedRaw = process.env[environmentName];
  if (expectedRaw === undefined || expectedRaw === '') continue;
  const expected = String(expectedRaw).toLowerCase() === 'true';
  if (capabilities[capabilityName] !== expected) {
    throw new Error(`${capabilityName} expected ${expected} but received ${capabilities[capabilityName]}`);
  }
}

const result = {
  ok: true,
  checkedAt: new Date().toISOString(),
  origin: base.origin,
  productName: capabilityPayload.productName || null,
  environment: capabilityPayload.environment || null,
  health: {
    d1: Boolean(health.d1),
    kv: Boolean(health.kv),
    ai: Boolean(health.ai),
    progressVersion: health.progressVersion,
    curriculumVersion: health.curriculumVersion
  },
  capabilities
};
writeFileSync('production-health-result.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
