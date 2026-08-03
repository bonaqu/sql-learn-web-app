import { createHmac, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const REQUIRED_TERMINAL_STATUS = 'delivered';
const DEFAULT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 4_000;
const EVIDENCE_PATH = process.env.CONTACT_STAGING_EVIDENCE_PATH || 'contact-provider-staging-evidence.json';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function optional(name) {
  return String(process.env[name] || '').trim();
}

function baseUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('STAGING_URL_MUST_USE_HTTPS');
  }
  return parsed.href.replace(/\/$/, '');
}

function addMask(value) {
  if (value && process.env.GITHUB_ACTIONS) process.stdout.write(`::add-mask::${value}\n`);
}

async function responseJson(response, maximum = 32_768) {
  const text = await response.text();
  if (Buffer.byteLength(text) > maximum) throw new Error('STAGING_RESPONSE_TOO_LARGE');
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

async function checkedJson(url, init, label) {
  const response = await fetch(url, { redirect: 'error', ...init });
  const body = await responseJson(response);
  if (!response.ok) throw new Error(`${label}_${response.status}`);
  return body;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function channels() {
  const raw = required('CONTACT_STAGING_CHANNELS').toLowerCase();
  if (raw === 'both') return ['email', 'sms'];
  const values = raw.split(',').map(value => value.trim()).filter(Boolean);
  if (!values.length || values.some(value => !['email', 'sms'].includes(value))) {
    throw new Error('CONTACT_STAGING_CHANNELS_INVALID');
  }
  return [...new Set(values)];
}

function normalizeResendStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'delivered') return 'delivered';
  if (status === 'bounced' || status === 'suppressed') return 'bounced';
  if (status === 'complained') return 'complained';
  if (status === 'delivery_delayed') return 'deferred';
  if (status === 'failed') return 'failed';
  return 'accepted';
}

function normalizeTwilioStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'delivered' || status === 'read') return 'delivered';
  if (status === 'undelivered' || status === 'failed' || status === 'canceled') return 'failed';
  if (status === 'queued' || status === 'sending' || status === 'scheduled') return 'deferred';
  return 'accepted';
}

async function providerStatus(channel, providerMessageId) {
  if (channel === 'email') {
    const payload = await checkedJson(
      `https://api.resend.com/emails/${encodeURIComponent(providerMessageId)}`,
      { headers: { authorization: `Bearer ${required('RESEND_API_KEY')}` } },
      'RESEND_STATUS'
    );
    return normalizeResendStatus(payload.last_event);
  }
  const accountSid = required('TWILIO_ACCOUNT_SID');
  const authToken = required('TWILIO_AUTH_TOKEN');
  const authorization = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const payload = await checkedJson(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(providerMessageId)}.json`,
    { headers: { authorization: `Basic ${authorization}` } },
    'TWILIO_STATUS'
  );
  return normalizeTwilioStatus(payload.status);
}

async function waitForDelivered(channel, providerMessageId, timeoutMs) {
  const startedAt = Date.now();
  let status = 'accepted';
  while (Date.now() - startedAt < timeoutMs) {
    status = await providerStatus(channel, providerMessageId);
    if (status === REQUIRED_TERMINAL_STATUS) return { status, latencyMs: Date.now() - startedAt };
    if (['bounced', 'complained', 'failed'].includes(status)) {
      throw new Error(`${channel.toUpperCase()}_DELIVERY_${status.toUpperCase()}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${channel.toUpperCase()}_DELIVERY_TIMEOUT_${status.toUpperCase()}`);
}

function deliveryEventSecret(channel) {
  return required(channel === 'email'
    ? 'EMAIL_VERIFICATION_EVENT_SECRET'
    : 'SMS_VERIFICATION_EVENT_SECRET');
}

async function recordDeliveryEvent(appUrl, channel, capture, terminalStatus) {
  const eventId = `staging-${randomUUID()}`;
  const occurredAt = new Date().toISOString();
  const body = JSON.stringify({
    contract: 'contact-verification-delivery-event-v1',
    eventId,
    challengeId: capture.challengeId,
    channel,
    provider: capture.provider,
    providerMessageId: capture.providerMessageId,
    status: terminalStatus,
    occurredAt
  });
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac('sha256', deliveryEventSecret(channel))
    .update(`${timestamp}.${body}`).digest('hex');
  await checkedJson(`${appUrl}/api/provider/contact-delivery/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-verification-event-id': eventId,
      'x-verification-event-timestamp': timestamp,
      'x-verification-signature': `sha256=${signature}`
    },
    body
  }, 'DELIVERY_EVENT');
}

async function acceptChannel(channel, configuration) {
  const destination = required(channel === 'email'
    ? 'CONTACT_STAGING_EMAIL_DESTINATION'
    : 'CONTACT_STAGING_SMS_DESTINATION');
  addMask(destination);
  const challengeHeaders = { 'content-type': 'application/json; charset=utf-8' };
  if (configuration.turnstileToken) challengeHeaders['cf-turnstile-response'] = configuration.turnstileToken;
  const startedAt = Date.now();
  const challenge = await checkedJson(`${configuration.appUrl}/api/auth/contact/challenge`, {
    method: 'POST',
    headers: challengeHeaders,
    body: JSON.stringify({ channel, purpose: 'register', destination })
  }, `${channel.toUpperCase()}_CHALLENGE`);
  if (typeof challenge.challengeId !== 'string') throw new Error(`${channel.toUpperCase()}_CHALLENGE_ID_MISSING`);
  addMask(challenge.challengeId);

  let capture;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const response = await fetch(`${configuration.adapterUrl}/capture/${encodeURIComponent(challenge.challengeId)}`, {
      headers: { authorization: `Bearer ${configuration.captureSecret}` },
      redirect: 'error'
    });
    if (response.ok) {
      capture = await responseJson(response);
      break;
    }
    if (response.status !== 404) throw new Error(`${channel.toUpperCase()}_CAPTURE_${response.status}`);
    await sleep(1_000);
  }
  if (!capture || capture.challengeId !== challenge.challengeId
    || capture.channel !== channel
    || typeof capture.providerMessageId !== 'string'
    || typeof capture.code !== 'string') throw new Error(`${channel.toUpperCase()}_CAPTURE_INVALID`);
  for (const value of [capture.providerMessageId, capture.code]) addMask(value);

  const delivery = await waitForDelivered(channel, capture.providerMessageId, configuration.timeoutMs);
  await recordDeliveryEvent(configuration.appUrl, channel, capture, delivery.status);
  const confirmation = await checkedJson(`${configuration.appUrl}/api/auth/contact/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ challengeId: challenge.challengeId, code: capture.code })
  }, `${channel.toUpperCase()}_CONFIRM`);
  if (confirmation.verified !== true || typeof confirmation.ticket !== 'string') {
    throw new Error(`${channel.toUpperCase()}_CONFIRMATION_INVALID`);
  }
  addMask(confirmation.ticket);
  return {
    channel,
    provider: capture.provider,
    terminalStatus: delivery.status,
    providerLatencyMs: delivery.latencyMs,
    endToEndLatencyMs: Date.now() - startedAt,
    codeConfirmed: true,
    checkedAt: new Date().toISOString()
  };
}

const configuration = {
  appUrl: baseUrl(required('CONTACT_STAGING_APP_URL')),
  adapterUrl: baseUrl(required('CONTACT_STAGING_ADAPTER_URL')),
  captureSecret: required('CONTACT_STAGING_CAPTURE_SECRET'),
  turnstileToken: optional('CONTACT_STAGING_TURNSTILE_TOKEN'),
  timeoutMs: Math.min(Math.max(Number(optional('CONTACT_STAGING_TIMEOUT_MS')) || DEFAULT_TIMEOUT_MS, 30_000), 600_000)
};
for (const value of [configuration.captureSecret, configuration.turnstileToken]) addMask(value);
for (const name of [
  'RESEND_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'EMAIL_VERIFICATION_EVENT_SECRET',
  'SMS_VERIFICATION_EVENT_SECRET'
]) addMask(optional(name));

const capabilities = await checkedJson(`${configuration.appUrl}/api/capabilities`, {}, 'CAPABILITIES');
const requestedChannels = channels();
for (const channel of requestedChannels) {
  const key = channel === 'email' ? 'emailVerification' : 'smsVerification';
  if (capabilities?.integrations?.[key]?.enabled !== true) throw new Error(`${channel.toUpperCase()}_CAPABILITY_DISABLED`);
}

const results = [];
for (const channel of requestedChannels) results.push(await acceptChannel(channel, configuration));
writeFileSync(EVIDENCE_PATH, `${JSON.stringify({
  contract: 'contact-provider-staging-evidence-v1',
  appOrigin: new URL(configuration.appUrl).origin,
  requiredTerminalStatus: REQUIRED_TERMINAL_STATUS,
  results
}, null, 2)}\n`);
console.log(`Contact provider staging acceptance passed for ${results.map(result => result.channel).join(', ')}; redacted evidence: ${EVIDENCE_PATH}`);
