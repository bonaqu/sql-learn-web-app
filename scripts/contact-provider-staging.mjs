import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const baseUrl = requiredUrl('CONTACT_STAGING_BASE_URL');
const probeSecret = required('CONTACT_STAGING_PROBE_SECRET', 32, 512);
const destination = required('CONTACT_STAGING_DESTINATION', 3, 320);
const channel = required('CONTACT_STAGING_CHANNEL', 3, 8).toLowerCase();
const timeoutMs = boundedInteger(process.env.CONTACT_STAGING_TIMEOUT_MS, 30_000, 600_000, 300_000);
const pollMs = boundedInteger(process.env.CONTACT_STAGING_POLL_MS, 1_000, 15_000, 5_000);
const evidencePath = resolve(process.env.CONTACT_STAGING_EVIDENCE_PATH || 'artifacts/contact-staging-evidence.json');

if (!['email', 'sms'].includes(channel)) throw new Error('CONTACT_STAGING_CHANNEL must be email or sms');
if (channel === 'email' && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(destination)) {
  throw new Error('CONTACT_STAGING_DESTINATION is not a valid email address');
}
if (channel === 'sms' && !/^\+[1-9]\d{7,14}$/.test(destination)) {
  throw new Error('CONTACT_STAGING_DESTINATION must use E.164 format');
}

function required(name, minLength, maxLength) {
  const value = String(process.env[name] || '').trim();
  if (value.length < minLength || value.length > maxLength) throw new Error(`${name} is missing or invalid`);
  return value;
}

function requiredUrl(name) {
  const value = required(name, 10, 2_000).replace(/\/$/, '');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a clean HTTPS origin or path`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function jsonRequest(path, init = {}, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          ...(init.headers || {})
        },
        redirect: 'error',
        signal: AbortSignal.timeout(12_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return { response, payload };
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        const retryAfter = Math.min(5_000, Math.max(500, (Number(response.headers.get('retry-after')) || attempt) * 1_000));
        await sleep(retryAfter);
        continue;
      }
      throw new Error(`${path} failed with HTTP ${response.status}: ${String(payload.error || 'unknown error').slice(0, 160)}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await sleep(attempt * 750);
    }
  }
  throw lastError || new Error(`${path} failed`);
}

function safeTimeline(payload) {
  const challenge = payload?.challenge || {};
  const delivery = Array.isArray(payload?.delivery) ? payload.delivery : [];
  const security = Array.isArray(payload?.security) ? payload.security : [];
  return {
    contract: 'contact-provider-staging-evidence-v1',
    generatedAt: new Date().toISOString(),
    baseOrigin: new URL(baseUrl).origin,
    channel,
    challenge: {
      id: String(challenge.id || '').slice(0, 80),
      purpose: String(challenge.purpose || '').slice(0, 40),
      maskedDestination: String(challenge.maskedDestination || '').slice(0, 160),
      providerMessageId: String(challenge.providerMessageId || '').slice(0, 200),
      createdAt: challenge.createdAt || null,
      confirmedAt: challenge.confirmedAt || null,
      consumedAt: challenge.consumedAt || null
    },
    delivery: delivery.slice(0, 100).map(event => ({
      provider: String(event.provider || '').slice(0, 24),
      providerMessageId: String(event.provider_message_id || '').slice(0, 200),
      status: String(event.status || '').slice(0, 32),
      errorCode: event.error_code ? String(event.error_code).slice(0, 80) : null,
      occurredAt: event.occurred_at || null,
      receivedAt: event.received_at || null
    })),
    security: security.slice(0, 100).map(event => ({
      eventType: String(event.event_type || '').slice(0, 64),
      occurredAt: event.occurred_at || null
    }))
  };
}

const capabilities = (await jsonRequest('/api/capabilities')).payload;
const capability = channel === 'email'
  ? capabilities?.integrations?.emailVerification?.enabled
  : capabilities?.integrations?.smsVerification?.enabled;
if (capability !== true) throw new Error(`${channel} verification capability is not enabled on staging`);
if (capabilities?.integrations?.turnstile?.enabled === true) {
  throw new Error('Contact staging Worker must disable Turnstile; the browser path is tested separately with action-bound tokens');
}

const challengeResult = await jsonRequest('/api/auth/contact/challenge', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ channel, purpose: 'sensitive-action', destination })
});
const challengeId = String(challengeResult.payload?.challengeId || '');
const maskedDestination = String(challengeResult.payload?.maskedDestination || '');
if (!/^[0-9a-f-]{36}$/i.test(challengeId) || maskedDestination.length < 3) {
  throw new Error('Staging challenge response is incomplete');
}
if (maskedDestination === destination || JSON.stringify(challengeResult.payload).includes(destination)) {
  throw new Error('Staging response leaked the raw destination');
}

const deadline = Date.now() + timeoutMs;
let evidence = null;
let terminal = null;
while (Date.now() < deadline) {
  const timeline = (await jsonRequest('/api/ops/contact-staging/timeline', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${probeSecret}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ challengeId })
  })).payload;
  evidence = safeTimeline(timeline);
  const statuses = evidence.delivery.map(event => event.status);
  if (statuses.includes('delivered')) {
    terminal = 'delivered';
    break;
  }
  const failed = ['bounced', 'complained', 'failed', 'undelivered'].find(status => statuses.includes(status));
  if (failed) {
    terminal = failed;
    break;
  }
  await sleep(pollMs);
}

if (!evidence) throw new Error('No staging delivery timeline was returned');
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify({ ...evidence, acceptance: terminal || 'timeout' }, null, 2)}\n`, { mode: 0o600 });

if (terminal !== 'delivered') {
  throw new Error(`Provider deliverability acceptance failed: ${terminal || 'timeout'}. See masked evidence artifact.`);
}
console.log(`Contact provider staging passed for ${channel}: delivered to ${maskedDestination}. Evidence: ${evidencePath}`);