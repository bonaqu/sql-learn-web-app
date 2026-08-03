import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const gatewayUrl = required('CONTACT_PROVIDER_STAGING_URL').replace(/\/$/, '');
const gatewaySecret = required('CONTACT_PROVIDER_STAGING_SECRET');
const channel = required('CONTACT_PROVIDER_STAGING_CHANNEL');
const destination = required('CONTACT_PROVIDER_STAGING_DESTINATION');
const evidencePath = process.env.CONTACT_PROVIDER_EVIDENCE_PATH || '/tmp/contact-provider-evidence.json';
const timeoutMs = boundedNumber(process.env.CONTACT_PROVIDER_TIMEOUT_MS, 180_000, 30_000, 600_000);

if (!['email', 'sms'].includes(channel)) throw new Error('CONTACT_PROVIDER_STAGING_CHANNEL must be email or sms.');

const challengeId = randomUUID();
const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
const sourceKey = randomBytes(32).toString('hex');
const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

const accepted = await requestJson(`${gatewayUrl}/v1/deliver`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${gatewaySecret}`,
    'content-type': 'application/json; charset=utf-8'
  },
  body: JSON.stringify({
    contract: 'contact-verification-delivery-v1',
    challengeId,
    channel,
    destination,
    purpose: 'sensitive-action',
    code,
    sourceKey,
    expiresAt
  })
});

if (accepted.status !== 'accepted' && accepted.status !== 'sent' && accepted.status !== 'delivered') {
  throw new Error(`Provider gateway did not accept the staging challenge: ${accepted.status || accepted.error || 'unknown'}`);
}

const startedAt = Date.now();
let latest = accepted;
while (latest.status !== 'delivered' && Date.now() - startedAt < timeoutMs) {
  await new Promise(resolve => setTimeout(resolve, 5_000));
  latest = await requestJson(`${gatewayUrl}/v1/status/${encodeURIComponent(challengeId)}`, {
    headers: { authorization: `Bearer ${gatewaySecret}` }
  });
  if (['bounced', 'complained', 'suppressed', 'failed', 'undelivered'].includes(latest.status)) break;
}

const evidence = {
  contract: 'contact-provider-staging-evidence-v1',
  channel,
  provider: typeof latest.provider === 'string' ? latest.provider : null,
  status: typeof latest.status === 'string' ? latest.status : 'unknown',
  errorCode: typeof latest.errorCode === 'string' ? latest.errorCode : null,
  acceptedAt: typeof accepted.updatedAt === 'string' ? accepted.updatedAt : null,
  deliveredAt: typeof latest.deliveredAt === 'string' ? latest.deliveredAt : null,
  checkedAt: new Date().toISOString(),
  destinationIncluded: false,
  verificationCodeIncluded: false,
  sourceKeyIncluded: false
};

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence));

if (latest.status !== 'delivered') {
  throw new Error(`Real-provider staging acceptance did not reach delivered status: ${latest.status || 'unknown'}`);
}

function required(name) {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

async function requestJson(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!response.ok) {
      throw new Error(`Gateway request failed with HTTP ${response.status}: ${body.error || 'sanitized error unavailable'}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}
