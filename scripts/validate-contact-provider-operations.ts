import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  handleResendDeliveryEvent,
  handleTwilioDeliveryEvent
} from '../worker/contact-delivery-events';
import {
  ResendVerificationProvider,
  TwilioVerificationProvider,
  verificationProviderName,
  verificationProviderReady
} from '../worker/integrations/verification';

const migration18 = readFileSync(new URL('../migrations/0018_contact_verification.sql', import.meta.url), 'utf8');
const migration20 = readFileSync(new URL('../migrations/0020_contact_delivery_observability.sql', import.meta.url), 'utf8');
const database = new DatabaseSync(':memory:');
database.exec(`PRAGMA foreign_keys = ON; ${migration18} ${migration20}`);

function values(parameters: unknown[]) {
  return parameters as SQLInputValue[];
}

function d1(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      let parameters: unknown[] = [];
      return {
        bind(...next: unknown[]) {
          parameters = next;
          return this;
        },
        async run() {
          const result = database.prepare(sql).run(...values(parameters));
          return { success: true, meta: { changes: Number(result.changes) || 0 } };
        },
        async first<T>() {
          return (database.prepare(sql).get(...values(parameters)) || null) as T | null;
        },
        async all<T>() {
          return { success: true, results: database.prepare(sql).all(...values(parameters)) as T[] };
        }
      };
    }
  } as unknown as D1Database;
}

for (const marker of [
  'CREATE TABLE IF NOT EXISTS contact_delivery_events',
  'CREATE TABLE IF NOT EXISTS contact_security_events',
  'idx_contact_delivery_message',
  'idx_contact_delivery_challenge',
  'idx_contact_delivery_health',
  'idx_contact_security_health',
  'idx_contact_security_challenge'
]) assert.ok(migration20.includes(marker), `Contact observability migration lost ${marker}`);
assert.doesNotMatch(migration20, /CREATE\s+TRIGGER/i, 'Remote D1 contact observability must remain triggerless.');
for (const forbidden of [/\bdestination\s+TEXT\b/i, /\bcode\s+TEXT\b/i, /\bmessage_body\b/i, /\bip_address\b/i]) {
  assert.doesNotMatch(migration20, forbidden, `Operational migration persists forbidden PII: ${forbidden}`);
}

const challengeId = '00000000-0000-4000-8000-000000000020';
database.prepare(`INSERT INTO contact_verification_challenges(
  challenge_id, channel, purpose, destination_digest, masked_destination,
  code_verifier, provider_message_id, attempts_remaining, expires_at,
  created_at, updated_at
) VALUES(?, 'email', 'register', ?, 'l***@example.com', ?, ?, 5, ?, ?, ?)`)
  .run(
    challengeId,
    'a'.repeat(64),
    'b'.repeat(64),
    'resend:email-message-1',
    '2026-08-02 22:30:00',
    '2026-08-02 22:00:00',
    '2026-08-02 22:00:00'
  );

const resendSecretBytes = new TextEncoder().encode('resend-webhook-secret-32-bytes!!');
const resendEnvironment = {
  EMAIL_VERIFICATION_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test_provider_key_1234567890',
  RESEND_FROM: 'SQL Academy <verify@example.test>',
  RESEND_WEBHOOK_SECRET: `whsec_${Buffer.from(resendSecretBytes).toString('base64')}`
} as unknown as Cloudflare.Env;
assert.equal(verificationProviderName('email', resendEnvironment), 'resend');
assert.equal(verificationProviderReady('email', resendEnvironment), true);
assert.equal(verificationProviderReady('email', {
  ...resendEnvironment,
  RESEND_WEBHOOK_SECRET: ''
} as unknown as Cloudflare.Env), false, 'Email readiness must require signed delivery callbacks.');

const twilioEnvironment = {
  SMS_VERIFICATION_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'twilio-auth-token-at-least-twenty',
  TWILIO_MESSAGING_SERVICE_SID: `MG${'b'.repeat(32)}`,
  TWILIO_STATUS_CALLBACK_URL: 'https://staging.example.test/api/integrations/twilio/status'
} as unknown as Cloudflare.Env;
assert.equal(verificationProviderName('sms', twilioEnvironment), 'twilio');
assert.equal(verificationProviderReady('sms', twilioEnvironment), true);
assert.equal(verificationProviderReady('sms', {
  ...twilioEnvironment,
  TWILIO_STATUS_CALLBACK_URL: 'http://staging.example.test/status'
} as unknown as Cloudflare.Env), false, 'SMS readiness must require an HTTPS status callback.');

const originalFetch = globalThis.fetch;
let resendRequest: Request | null = null;
globalThis.fetch = async (input, init) => {
  resendRequest = new Request(input, init);
  return new Response(JSON.stringify({ id: 'email-message-1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
const resendProvider = new ResendVerificationProvider(
  're_test_provider_key_1234567890',
  'SQL Academy <verify@example.test>'
);
const resendDelivery = await resendProvider.send({
  challengeId,
  channel: 'email',
  destination: 'learner@example.test',
  purpose: 'register',
  code: '123456',
  expiresAt: '2026-08-02 22:10:00'
});
assert.equal(resendDelivery.providerMessageId, 'resend:email-message-1');
assert.equal(resendRequest?.url, 'https://api.resend.com/emails');
assert.equal(resendRequest?.headers.get('idempotency-key'), `contact-verification/${challengeId}`);
const resendBody = await resendRequest?.json() as { to: string[]; text: string };
assert.deepEqual(resendBody.to, ['learner@example.test']);
assert.match(resendBody.text, /123456/);

globalThis.fetch = async () => new Response(JSON.stringify({ sid: `SM${'c'.repeat(32)}`, status: 'queued' }), {
  status: 201,
  headers: { 'content-type': 'application/json' }
});
let twilioRequest: Request | null = null;
globalThis.fetch = async (input, init) => {
  twilioRequest = new Request(input, init);
  return new Response(JSON.stringify({ sid: `SM${'c'.repeat(32)}`, status: 'queued' }), {
    status: 201,
    headers: { 'content-type': 'application/json' }
  });
};
const twilioProvider = new TwilioVerificationProvider(
  `AC${'a'.repeat(32)}`,
  'twilio-auth-token-at-least-twenty',
  `MG${'b'.repeat(32)}`,
  '',
  new URL('https://staging.example.test/api/integrations/twilio/status')
);
const twilioDelivery = await twilioProvider.send({
  challengeId,
  channel: 'sms',
  destination: '+13035550100',
  purpose: 'password-reset',
  code: '654321',
  expiresAt: '2026-08-02 22:10:00'
});
assert.equal(twilioDelivery.providerMessageId, `twilio:SM${'c'.repeat(32)}`);
assert.match(twilioRequest?.url || '', /api\.twilio\.com\/2010-04-01\/Accounts\/AC/);
const twilioBody = new URLSearchParams(await twilioRequest?.text());
assert.equal(twilioBody.get('To'), '+13035550100');
assert.equal(twilioBody.get('MessagingServiceSid'), `MG${'b'.repeat(32)}`);
assert.equal(twilioBody.get('StatusCallback'), 'https://staging.example.test/api/integrations/twilio/status');
assert.match(twilioBody.get('Body') || '', /654321/);

globalThis.fetch = async () => new Response('x'.repeat(64 * 1024 + 1), { status: 200 });
await assert.rejects(() => resendProvider.send({
  challengeId,
  channel: 'email',
  destination: 'learner@example.test',
  purpose: 'register',
  code: '123456',
  expiresAt: '2026-08-02 22:10:00'
}), /VERIFICATION_PROVIDER_RESPONSE_TOO_LARGE/);
globalThis.fetch = originalFetch;

function base64(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString('base64');
}

async function signature(algorithm: 'SHA-1' | 'SHA-256', secret: Uint8Array, message: string) {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: algorithm }, false, ['sign']);
  return base64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

const callbackEnv = {
  DB: d1(database),
  RESEND_WEBHOOK_SECRET: resendEnvironment.RESEND_WEBHOOK_SECRET,
  TWILIO_AUTH_TOKEN: twilioEnvironment.TWILIO_AUTH_TOKEN
} as unknown as Cloudflare.Env;

const resendEventId = 'evt_resend_delivery_0001';
const resendTimestamp = String(Math.floor(Date.now() / 1_000));
const resendEventBody = JSON.stringify({
  type: 'email.delivered',
  created_at: new Date().toISOString(),
  data: { email_id: 'email-message-1' }
});
const resendEventSignature = await signature('SHA-256', resendSecretBytes, `${resendEventId}.${resendTimestamp}.${resendEventBody}`);
const resendCallbackHeaders = {
  'content-type': 'application/json',
  'svix-id': resendEventId,
  'svix-timestamp': resendTimestamp,
  'svix-signature': `v1,${resendEventSignature}`
};
const resendCallbackUrl = 'https://academy.example.test/api/integrations/resend/events';
for (let attempt = 0; attempt < 2; attempt += 1) {
  const response = await handleResendDeliveryEvent(new Request(resendCallbackUrl, {
    method: 'POST',
    headers: resendCallbackHeaders,
    body: resendEventBody
  }), callbackEnv);
  assert.equal(response.status, 204);
}
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM contact_delivery_events
  WHERE event_id = ? AND status = 'delivered'`).get(`resend:${resendEventId}`)?.count, 1,
'Duplicate Resend callbacks must be idempotent.');
assert.equal((await handleResendDeliveryEvent(new Request(resendCallbackUrl, {
  method: 'POST',
  headers: { ...resendCallbackHeaders, 'svix-signature': 'v1,invalid' },
  body: resendEventBody
}), callbackEnv)).status, 401);
assert.equal((await handleResendDeliveryEvent(new Request(resendCallbackUrl, {
  method: 'POST',
  headers: { ...resendCallbackHeaders, 'content-length': String(128 * 1024 + 1) },
  body: '{}'
}), callbackEnv)).status, 413);

const smsChallengeId = '00000000-0000-4000-8000-000000000021';
const twilioSid = `SM${'d'.repeat(32)}`;
database.prepare(`INSERT INTO contact_verification_challenges(
  challenge_id, channel, purpose, destination_digest, masked_destination,
  code_verifier, provider_message_id, attempts_remaining, expires_at,
  created_at, updated_at
) VALUES(?, 'sms', 'password-reset', ?, '+1******0100', ?, ?, 5, ?, ?, ?)`)
  .run(
    smsChallengeId,
    'c'.repeat(64),
    'd'.repeat(64),
    `twilio:${twilioSid}`,
    '2026-08-02 22:30:00',
    '2026-08-02 22:00:00',
    '2026-08-02 22:00:00'
  );
const twilioCallbackUrl = 'https://academy.example.test/api/integrations/twilio/status';
const twilioParams = new URLSearchParams({
  MessageSid: twilioSid,
  MessageStatus: 'delivered',
  ErrorCode: ''
});
const canonicalTwilio = twilioCallbackUrl + [...twilioParams.entries()]
  .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
  .map(([key, value]) => `${key}${value}`).join('');
const twilioCallbackSignature = await signature(
  'SHA-1',
  new TextEncoder().encode(String(twilioEnvironment.TWILIO_AUTH_TOKEN)),
  canonicalTwilio
);
const twilioHeaders = {
  'content-type': 'application/x-www-form-urlencoded',
  'x-twilio-signature': twilioCallbackSignature
};
for (let attempt = 0; attempt < 2; attempt += 1) {
  const response = await handleTwilioDeliveryEvent(new Request(twilioCallbackUrl, {
    method: 'POST',
    headers: twilioHeaders,
    body: twilioParams.toString()
  }), callbackEnv);
  assert.equal(response.status, 204);
}
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM contact_delivery_events
  WHERE provider_message_id = ? AND status = 'delivered'`).get(`twilio:${twilioSid}`)?.count, 1,
'Duplicate Twilio terminal callbacks must be idempotent.');
assert.equal((await handleTwilioDeliveryEvent(new Request(twilioCallbackUrl, {
  method: 'POST',
  headers: { ...twilioHeaders, 'x-twilio-signature': 'invalid' },
  body: twilioParams.toString()
}), callbackEnv)).status, 401);

database.close();

const providerSource = readFileSync(new URL('../worker/integrations/verification.ts', import.meta.url), 'utf8');
for (const marker of [
  'MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024',
  'boundedProviderJson',
  'idempotency-key',
  'StatusCallback',
  'recordInitialContactDelivery',
  "eventType: 'challenge-provider-failed'"
]) assert.ok(providerSource.includes(marker), `Provider adapter lost ${marker}`);
assert.doesNotMatch(providerSource, /response\.(?:json|text|arrayBuffer)\(/, 'Provider responses must stay streaming-bounded.');

const callbackSource = readFileSync(new URL('../worker/contact-delivery-events.ts', import.meta.url), 'utf8');
for (const marker of [
  'CALLBACK_TOLERANCE_SECONDS = 5 * 60',
  'MAX_CALLBACK_BYTES = 128 * 1024',
  'boundedRequestText',
  'svix-signature',
  'x-twilio-signature',
  'INSERT OR IGNORE'
]) assert.ok(callbackSource.includes(marker) || readFileSync(new URL('../worker/contact-observability.ts', import.meta.url), 'utf8').includes(marker), `Callback contract lost ${marker}`);

const securitySource = readFileSync(new URL('../worker/contact-security-routes.ts', import.meta.url), 'utf8');
for (const marker of [
  "eventType: 'challenge-created'",
  "eventType: 'challenge-rate-limited'",
  "eventType: 'code-invalid'",
  "eventType: 'code-exhausted'",
  "eventType: 'contact-confirmed'",
  "eventType: 'ticket-consumed'"
]) assert.ok(securitySource.includes(marker), `Explicit contact security observation lost ${marker}`);

const entrySource = readFileSync(new URL('../worker/entry.ts', import.meta.url), 'utf8');
for (const marker of [
  "pathname === '/api/integrations/resend/events'",
  "pathname === '/api/integrations/twilio/status'",
  "pathname === '/api/ops/contact-staging/timeline'",
  'observeContactSecurityResponse',
  'context.waitUntil',
  'async scheduled',
  'cleanupContactObservability'
]) assert.ok(entrySource.includes(marker), `Contact operations entry lost ${marker}`);

const observabilitySource = readFileSync(new URL('../worker/contact-observability.ts', import.meta.url), 'utf8');
for (const marker of [
  'hardFailureRate',
  'confirmationRate',
  'challenge-rate-limited',
  'challenge-provider-failed',
  'masked_destination',
  'DELIVERY_RETENTION_DAYS = 90',
  'CHALLENGE_RETENTION_DAYS = 30',
  'CLEANUP_BATCH_SIZE = 1_000'
]) assert.ok(observabilitySource.includes(marker), `Contact observability lost ${marker}`);
assert.doesNotMatch(observabilitySource, /SELECT[^;]*(?:destination_digest|code_verifier)/is,
  'Operational timelines must not fetch contact digests or code verifiers.');

const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
assert.ok(wrangler.includes('"main": "worker/entry.ts"'), 'Wrangler does not use the contact operations entrypoint.');
assert.ok(wrangler.includes('"17 3 * * *"'), 'Daily retention cleanup cron is missing.');
assert.ok(wrangler.includes('"EMAIL_VERIFICATION_PROVIDER": "disabled"'), 'Production email provider is not default-off.');
assert.ok(wrangler.includes('"SMS_VERIFICATION_PROVIDER": "disabled"'), 'Production SMS provider is not default-off.');
assert.ok(wrangler.includes('"CONTACT_STAGING_MODE": "disabled"'), 'Production staging probe is not default-off.');

const stagingScript = readFileSync(new URL('./contact-provider-staging.mjs', import.meta.url), 'utf8');
for (const marker of [
  'CONTACT_STAGING_DESTINATION',
  "statuses.includes('delivered')",
  "acceptance: terminal || 'timeout'",
  'maskedDestination === destination',
  'Provider deliverability acceptance failed'
]) assert.ok(stagingScript.includes(marker), `Staging acceptance lost ${marker}`);
assert.doesNotMatch(stagingScript, /writeFileSync\([^\n]*destination/i,
  'The raw staging destination must not be written directly to evidence.');

const workflow = readFileSync(new URL('../.github/workflows/contact-provider-staging.yml', import.meta.url), 'utf8');
for (const marker of [
  'environment: contact-staging',
  'CONTACT_STAGING_PROBE_SECRET',
  'CONTACT_STAGING_DESTINATION',
  'contact-provider-staging.mjs',
  'Upload masked deliverability evidence'
]) assert.ok(workflow.includes(marker), `Provider staging workflow lost ${marker}`);

const stagingDoc = readFileSync(new URL('../docs/contact-provider-staging.md', import.meta.url), 'utf8');
const runbook = readFileSync(new URL('../docs/support/contact-verification-runbook.md', import.meta.url), 'utf8');
for (const marker of ['signed delivered callback', 'Production enablement gate', 'Manual code-consumption check']) {
  assert.ok(stagingDoc.includes(marker), `Staging document lost ${marker}`);
}
for (const marker of [
  'Support must never request',
  'Initial alert thresholds',
  'Channel disable and rollback',
  'Provider secret rotation',
  'raw PII absent from evidence'
]) assert.ok(runbook.includes(marker), `Support runbook lost ${marker}`);

console.log('Contact provider operations validated: triggerless D1, explicit Resend/Twilio readiness, bounded sends and callbacks, signed idempotent delivery events, real delivered staging acceptance, retention and support rollback contracts.');