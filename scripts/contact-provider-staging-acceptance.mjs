import { createHash, randomInt, randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';

const channel = process.env.CONTACT_STAGING_CHANNEL;
const providerUrl = process.env.CONTACT_STAGING_PROVIDER_URL;
const providerSecret = process.env.CONTACT_STAGING_PROVIDER_SECRET;
const destination = process.env.CONTACT_STAGING_DESTINATION;
const receiptUrl = process.env.CONTACT_STAGING_RECEIPT_URL;
const receiptSecret = process.env.CONTACT_STAGING_RECEIPT_SECRET;
const timeoutSeconds = Math.min(Math.max(Number(process.env.CONTACT_STAGING_TIMEOUT_SECONDS) || 180, 30), 600);
const timeoutMs = timeoutSeconds * 1_000;
const pollMs = Math.min(Math.max(Number(process.env.CONTACT_STAGING_POLL_MS) || 5_000, 1_000), 30_000);
const artifactPath = process.env.CONTACT_STAGING_ARTIFACT || 'contact-provider-staging-result.json';
const stagePath = process.env.CONTACT_STAGING_STAGE || 'contact-provider-staging-stage.txt';
const terminalSuccess = new Set(['delivered']);
const terminalFailure = new Set(['bounced', 'complained', 'undeliverable', 'provider-rejected', 'provider-unavailable']);

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function httpsUrl(name, value) {
  const parsed = new URL(required(name, value));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${name} must be a credential-free HTTPS URL`);
  }
  return parsed;
}

function maskDestination(value, selectedChannel) {
  if (selectedChannel === 'email') {
    const separator = value.lastIndexOf('@');
    return separator > 0 ? `${value.slice(0, 1)}***@${value.slice(separator + 1)}` : 'invalid-email';
  }
  return value.length >= 6 ? `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 6))}${value.slice(-4)}` : 'invalid-phone';
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function stage(value) {
  writeFileSync(stagePath, `${value}\n`);
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function boundedText(response) {
  return (await response.text()).slice(0, 1_500);
}

if (channel !== 'email' && channel !== 'sms') throw new Error('CONTACT_STAGING_CHANNEL must be email or sms');
const deliveryEndpoint = httpsUrl('CONTACT_STAGING_PROVIDER_URL', providerUrl);
const statusEndpoint = httpsUrl('CONTACT_STAGING_RECEIPT_URL', receiptUrl);
required('CONTACT_STAGING_PROVIDER_SECRET', providerSecret);
required('CONTACT_STAGING_DESTINATION', destination);
required('CONTACT_STAGING_RECEIPT_SECRET', receiptSecret);
if (providerSecret.length < 16) throw new Error('CONTACT_STAGING_PROVIDER_SECRET is too short');
if (receiptSecret.length < 32) throw new Error('CONTACT_STAGING_RECEIPT_SECRET is too short');
if (channel === 'email' && !/^\S+@\S+\.\S+$/.test(destination)) throw new Error('CONTACT_STAGING_DESTINATION is not an email address');
if (channel === 'sms' && !/^\+[1-9][0-9]{7,14}$/.test(destination)) throw new Error('CONTACT_STAGING_DESTINATION is not E.164');

const challengeId = randomUUID();
const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
const startedAt = new Date().toISOString();
const result = {
  contract: 'contact-provider-staging-result-v1',
  executed: true,
  channel,
  challengeId,
  destinationMasked: maskDestination(destination, channel),
  destinationFingerprint: fingerprint(`${channel}:${destination}`),
  startedAt,
  acceptedAt: null,
  completedAt: null,
  providerMessageFingerprint: null,
  terminalStatus: null,
  receiptEvents: [],
  rawDestinationPersisted: false,
  verificationCodePersisted: false
};

try {
  stage('provider-request');
  const response = await fetch(deliveryEndpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: {
      authorization: `Bearer ${providerSecret}`,
      'content-type': 'application/json; charset=utf-8',
      'idempotency-key': challengeId,
      'x-verification-contract': 'contact-verification-delivery-v1'
    },
    body: JSON.stringify({
      contract: 'contact-verification-delivery-v1',
      challengeId,
      channel,
      destination,
      purpose: 'register',
      code,
      expiresAt
    })
  });
  if (!response.ok) throw new Error(`Provider rejected staging delivery: HTTP ${response.status} ${await boundedText(response)}`);
  const providerMessageId = (response.headers.get('x-verification-message-id') || '').trim();
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(providerMessageId)) {
    throw new Error('Provider did not return a valid x-verification-message-id');
  }
  result.acceptedAt = new Date().toISOString();
  result.providerMessageFingerprint = fingerprint(providerMessageId);

  stage('receipt-poll');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = new URL(statusEndpoint);
    url.searchParams.set('challengeId', challengeId);
    const statusResponse = await fetch(url, {
      headers: { authorization: `Bearer ${receiptSecret}`, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    });
    if (!statusResponse.ok) throw new Error(`Receipt status failed: HTTP ${statusResponse.status} ${await boundedText(statusResponse)}`);
    const payload = await statusResponse.json();
    if (payload?.challengeId !== challengeId || !Array.isArray(payload.events)) {
      throw new Error('Receipt status response has an invalid contract');
    }
    result.receiptEvents = payload.events.map(event => ({
      status: String(event.status || ''),
      reasonCode: event.reasonCode ? String(event.reasonCode).slice(0, 96) : null,
      occurredAt: String(event.occurredAt || '')
    })).slice(-50);
    const terminal = [...result.receiptEvents].reverse().find(event => terminalSuccess.has(event.status) || terminalFailure.has(event.status));
    if (terminal) {
      result.terminalStatus = terminal.status;
      if (terminalFailure.has(terminal.status)) throw new Error(`Delivery ended with ${terminal.status}${terminal.reasonCode ? `:${terminal.reasonCode}` : ''}`);
      result.completedAt = new Date().toISOString();
      stage('delivered');
      writeFileSync(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
      console.log(`Real ${channel} staging acceptance passed for ${result.destinationMasked}; challenge=${challengeId}; status=delivered.`);
      process.exit(0);
    }
    await sleep(pollMs);
  }
  throw new Error(`No terminal delivery receipt within ${timeoutMs} ms`);
} catch (error) {
  result.completedAt = new Date().toISOString();
  stage('failed');
  writeFileSync(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
  appendFileSync('contact-provider-staging-error.txt', `${error instanceof Error ? error.message : String(error)}\n`);
  throw error;
}
