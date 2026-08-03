import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type GatewayConfig = {
  compatibility_date?: string;
  compatibility_flags?: string[];
  d1_databases?: Array<{ binding?: string; database_id?: string }>;
  vars?: Record<string, string>;
  triggers?: { crons?: string[] };
  observability?: { enabled?: boolean; head_sampling_rate?: number };
  env?: Record<string, {
    vars?: Record<string, string>;
    triggers?: { crons?: string[] };
    d1_databases?: Array<{ binding?: string; database_id?: string }>;
    secrets?: { required?: string[] };
  }>;
};

const config = JSON.parse(read('provider-gateway/wrangler.jsonc')) as GatewayConfig;
const source = read('provider-gateway/src/index.ts');
const contactVerification = read('worker/contact-verification.ts');
const verificationIntegration = read('worker/integrations/verification.ts');
const migration = read('provider-gateway/migrations/0001_delivery_evidence.sql');
const smoke = read('scripts/contact-provider-staging-smoke.mjs');
const workflow = read('.github/workflows/contact-provider-staging.yml');
const runbook = read('docs/contact-provider-support-runbook.md');
const packageJson = read('package.json');

assert.match(config.compatibility_date || '', /^2026-[0-9]{2}-[0-9]{2}$/,
  'Provider gateway compatibility date is missing or stale-shaped.');
assert.ok(config.compatibility_flags?.includes('nodejs_compat'), 'Provider gateway must enable nodejs_compat.');
assert.equal(config.d1_databases?.[0]?.binding, 'DELIVERY_DB', 'Default gateway D1 binding is missing.');
assert.equal(config.vars?.FEATURE_EMAIL_DELIVERY, 'off', 'Email delivery must be off by default.');
assert.equal(config.vars?.FEATURE_SMS_DELIVERY, 'off', 'SMS delivery must be off by default.');
assert.deepEqual(config.triggers?.crons, ['17 3 * * *'], 'Default retention Cron Trigger is missing.');
assert.equal(config.observability?.enabled, true, 'Gateway observability must be enabled.');
assert.equal(config.observability?.head_sampling_rate, 1, 'Staging gateway must retain complete traces.');

const staging = config.env?.staging;
assert.ok(staging, 'Staging environment is missing.');
assert.equal(staging?.vars?.FEATURE_EMAIL_DELIVERY, 'on', 'Staging email capability is not explicit.');
assert.equal(staging?.vars?.FEATURE_SMS_DELIVERY, 'on', 'Staging SMS capability is not explicit.');
assert.equal(staging?.d1_databases?.[0]?.binding, 'DELIVERY_DB', 'Staging D1 binding is missing.');
assert.deepEqual(staging?.triggers?.crons, ['17 3 * * *'], 'Staging retention Cron Trigger is missing.');
for (const requiredSecret of [
  'DELIVERY_WEBHOOK_SECRET',
  'PII_HMAC_SECRET',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN'
]) {
  assert.ok(staging?.secrets?.required?.includes(requiredSecret), `Staging secret ${requiredSecret} is not declared.`);
}

for (const contract of [
  "url.pathname === '/v1/deliver'",
  "url.pathname === '/webhooks/resend'",
  "url.pathname === '/webhooks/twilio'",
  "url.pathname === '/v1/health'",
  "url.pathname.startsWith('/v1/status/')"
]) {
  assert.ok(source.includes(contract), `Missing provider gateway route: ${contract}`);
}
assert.ok(source.includes("'idempotency-key': payload.challengeId"), 'Resend idempotency key is not challenge-bound.');
assert.ok(source.includes("status = 'reserved'"), 'Twilio at-most-once reservation boundary is missing.');
assert.ok(source.includes("request.headers.get('svix-signature')"), 'Resend signature verification is missing.');
assert.ok(source.includes("request.headers.get('svix-timestamp')"), 'Resend replay window is missing.');
assert.ok(source.includes("request.headers.get('x-twilio-signature')"), 'Twilio signature verification is missing.');
assert.ok(source.includes("hash: 'SHA-1'"), 'Twilio HMAC-SHA1 validation contract is missing.');
assert.ok(source.includes("pseudonym(env, `destination:${payload.channel}`"), 'Destination HMAC pseudonym is missing.');
assert.ok(source.includes("typeof candidate.sourceKey !== 'string' || !DIGEST_PATTERN.test(candidate.sourceKey)"),
  'Gateway must reject malformed source abuse keys.');
assert.ok(source.includes("pseudonym(env, 'source', payload.sourceKey)"),
  'Gateway must re-HMAC the upstream source key instead of using its own caller IP.');
assert.ok(!source.includes("request.headers.get('cf-connecting-ip') || 'unknown'"),
  'Gateway must not mistake the calling backend Worker IP for the learner source.');
assert.ok(source.includes("boundedResponseText(response, MAX_PROVIDER_RESPONSE_BYTES)"), 'Provider responses are not bounded.');
assert.ok(source.includes("ctx.waitUntil(purgeExpiredEvidence(env))"), 'Retention purge is not scheduled safely.');
assert.ok(source.includes("datetime(created_at) >= datetime('now', '-24 hours')"), '24-hour health window must parse ISO timestamps.');
assert.ok(source.includes('datetime(received_at) < datetime'), 'Event retention must parse ISO timestamps.');
assert.ok(source.includes('datetime(updated_at) < datetime'), 'Attempt retention must parse ISO timestamps.');
assert.ok(source.includes('datetime(window_start) < datetime'), 'Abuse bucket retention must parse ISO timestamps.');
assert.ok(source.includes("bounceType === 'transient'"), 'Transient Resend bounces must be classified explicitly.');
assert.ok(source.includes("bounceType === 'permanent'"), 'Permanent Resend bounces must be classified explicitly.');
assert.ok(source.includes("'email.bounced.transient': { status: 'delayed', suppressionReason: null }"),
  'Transient bounce must remain retryable rather than suppressed.');
assert.ok(source.includes("'email.bounced.permanent': { status: 'bounced', suppressionReason: 'hard-bounce' }"),
  'Only a permanent bounce may create the hard-bounce suppression.');
assert.ok(!source.includes('console.log(payload)'), 'Delivery payload must not be logged.');
assert.ok(!source.includes('console.log(destination)'), 'Destination must not be logged.');
assert.ok(!source.includes('console.log(code)'), 'Verification code must not be logged.');

assert.ok(source.includes('function allowedPriorStatuses(nextStatus: DeliveryStatus)'),
  'Provider callbacks need monotonic delivery-state transitions.');
assert.ok(source.includes("delivered: ['reserved', 'accepted', 'sent', 'delayed', 'delivered']"),
  'Delivered state must ignore late lower-severity callbacks.');
assert.ok(source.includes("complained: ['reserved', 'accepted', 'sent', 'delayed', 'delivered', 'bounced', 'complained']"),
  'Complaints must remain able to supersede a delivered message.');
assert.ok(source.includes('challenge_id IS NULL'),
  'Early provider callbacks must be retained before an attempt receives its provider message ID.');
assert.ok(source.includes('async function reconcileProviderEvents('),
  'Pending provider callbacks are not reconciled after message-ID persistence.');
assert.ok(source.includes('await reconcileProviderEvents(env, provider, providerMessageId)'),
  'Delivery acceptance does not invoke callback reconciliation.');
assert.ok(source.includes("status = CASE WHEN status = 'reserved' THEN 'accepted' ELSE status END"),
  'Persisting a provider message ID must not downgrade an already reconciled callback state.');
assert.ok(source.includes("'x-verification-message-id': providerMessageId"),
  'The provider-neutral caller must receive the actual accepted provider message ID.');
assert.ok(source.includes('pendingCallbacks: pendingCallbacks?.count || 0'),
  'Aggregate health must expose unmatched callback backlog without PII.');

assert.ok(contactVerification.includes("request.headers.get('cf-connecting-ip') || 'unavailable'"),
  'The main Worker must derive the source key from the trusted edge request.');
assert.ok(contactVerification.includes('sql-academy/contact-source/v1:'),
  'The source key HMAC must be domain-separated from destination/code/ticket uses.');
assert.ok(contactVerification.includes('sourceKey = await sourceKeyForRequest(request, secret)'),
  'Challenge creation must derive a pseudonymous source key.');
assert.ok(contactVerification.includes('sourceKey'),
  'Challenge delivery must carry the pseudonymous source key.');
assert.ok(!contactVerification.includes('source_ip'), 'The main Worker must not persist a raw source IP.');
assert.ok(verificationIntegration.includes("const SOURCE_KEY_PATTERN = /^[0-9a-f]{64}$/"),
  'The private webhook boundary must validate source-key shape.');
assert.ok(verificationIntegration.includes('sourceKey: challenge.sourceKey'),
  'The provider-neutral webhook must transmit the pseudonymous source key.');

for (const forbiddenColumn of ['destination', 'code', 'source_ip', 'email', 'phone']) {
  assert.ok(!new RegExp(`^\\s*${forbiddenColumn}\\s+text\\b`, 'im').test(migration),
    `Raw PII/secret column is forbidden: ${forbiddenColumn}`);
}
for (const requiredColumn of ['destination_hash TEXT', 'source_hash TEXT', 'provider_message_id TEXT', 'provider_event_id TEXT']) {
  assert.ok(migration.includes(requiredColumn), `Missing sanitized evidence column: ${requiredColumn}`);
}
assert.ok(migration.includes('challenge_id TEXT,'), 'Provider events must permit a temporarily unmatched callback.');
assert.ok(migration.includes('PRIMARY KEY (scope, subject_hash, window_start)'), 'Abuse bucket uniqueness is missing.');
assert.ok(migration.includes('contact_delivery_suppressions'), 'Suppression registry is missing.');

assert.ok(workflow.includes('workflow_dispatch:'), 'Real-provider acceptance must remain manually dispatched.');
assert.ok(workflow.includes('environment: contact-provider-staging'), 'Protected staging environment is missing.');
assert.ok(workflow.includes('CONTACT_PROVIDER_STAGING_EMAIL'), 'Staging email destination secret is missing.');
assert.ok(workflow.includes('CONTACT_PROVIDER_STAGING_PHONE'), 'Staging phone destination secret is missing.');
assert.ok(workflow.includes('retention-days: 3'), 'Staging evidence retention must stay short.');
assert.ok(!workflow.includes('pull_request:'), 'Provider delivery must never run automatically on pull requests.');

assert.ok(smoke.includes("const sourceKey = randomBytes(32).toString('hex')"),
  'Staging smoke must exercise the pseudonymous source-key contract.');
assert.ok(smoke.includes('sourceKey,'), 'Staging delivery does not include its synthetic source key.');
assert.ok(smoke.includes("latest.status !== 'delivered'"), 'Staging acceptance does not require delivered status.');
assert.ok(smoke.includes('destinationIncluded: false'), 'Evidence does not declare destination redaction.');
assert.ok(smoke.includes('verificationCodeIncluded: false'), 'Evidence does not declare code redaction.');
assert.ok(smoke.includes('sourceKeyIncluded: false'), 'Evidence does not declare source-key redaction.');
assert.ok(!smoke.includes('console.log(destination)'), 'Staging smoke logs the destination.');
assert.ok(!smoke.includes('console.log(code)'), 'Staging smoke logs the verification code.');
assert.ok(!smoke.includes('console.log(sourceKey)'), 'Staging smoke logs the pseudonymous source key.');

for (const rule of [
  'ask a learner for their password, six-digit verification code or recovery code',
  'manually mark an unverified contact as verified',
  'support must not bypass ownership verification',
  'feature-off rollback',
  'protected real-provider acceptance workflow',
  'HMAC-pseudonymous',
  'The source bucket is not based on the gateway request IP'
]) {
  assert.ok(runbook.toLowerCase().includes(rule.toLowerCase()), `Support runbook rule is missing: ${rule}`);
}

assert.ok(packageJson.includes('validate:provider-gateway'), 'Provider gateway validator is not wired into package scripts.');
assert.ok(packageJson.includes('types:provider-gateway'), 'Provider gateway generated types are not wired into package scripts.');

console.log('Contact provider gateway validated: default-off config, generated types, D1 evidence minimization, signed callbacks, permanent/transient bounce handling, two-stage pseudonymous abuse controls, early-callback reconciliation, monotonic delivery states, ISO-safe scheduled retention, protected real-provider acceptance and support boundaries are present.');

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}
