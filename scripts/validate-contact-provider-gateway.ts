import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(read('provider-gateway/wrangler.jsonc')) as {
  compatibility_date?: string;
  compatibility_flags?: string[];
  d1_databases?: Array<{ binding?: string; database_id?: string }>;
  vars?: Record<string, string>;
  observability?: { enabled?: boolean; head_sampling_rate?: number };
  env?: Record<string, {
    vars?: Record<string, string>;
    d1_databases?: Array<{ binding?: string; database_id?: string }>;
    secrets?: { required?: string[] };
  }>;
};
const source = read('provider-gateway/src/index.ts');
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
assert.equal(config.observability?.enabled, true, 'Gateway observability must be enabled.');
assert.equal(config.observability?.head_sampling_rate, 1, 'Staging gateway must retain complete traces.');

const staging = config.env?.staging;
assert.ok(staging, 'Staging environment is missing.');
assert.equal(staging?.vars?.FEATURE_EMAIL_DELIVERY, 'on', 'Staging email capability is not explicit.');
assert.equal(staging?.vars?.FEATURE_SMS_DELIVERY, 'on', 'Staging SMS capability is not explicit.');
assert.equal(staging?.d1_databases?.[0]?.binding, 'DELIVERY_DB', 'Staging D1 binding is missing.');
for (const secret of [
  'DELIVERY_WEBHOOK_SECRET',
  'PII_HMAC_SECRET',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN'
]) {
  assert.ok(staging?.secrets?.required?.includes(secret), `Staging secret ${secret} is not declared.`);
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
assert.ok(source.includes("pseudonym(env, 'source'"), 'Source HMAC pseudonym is missing.');
assert.ok(source.includes("boundedResponseText(response, MAX_PROVIDER_RESPONSE_BYTES)"), 'Provider responses are not bounded.');
assert.ok(source.includes("ctx.waitUntil(purgeExpiredEvidence(env))"), 'Retention purge is not scheduled safely.');
assert.ok(!source.includes('console.log(payload)'), 'Delivery payload must not be logged.');
assert.ok(!source.includes('console.log(destination)'), 'Destination must not be logged.');
assert.ok(!source.includes('console.log(code)'), 'Verification code must not be logged.');

for (const forbiddenColumn of ['destination TEXT', 'code TEXT', 'source_ip TEXT', 'email TEXT', 'phone TEXT']) {
  assert.ok(!migration.toLowerCase().includes(forbiddenColumn.toLowerCase()),
    `Raw PII/secret column is forbidden: ${forbiddenColumn}`);
}
for (const requiredColumn of ['destination_hash TEXT', 'source_hash TEXT', 'provider_message_id TEXT', 'provider_event_id TEXT']) {
  assert.ok(migration.includes(requiredColumn), `Missing sanitized evidence column: ${requiredColumn}`);
}
assert.ok(migration.includes('PRIMARY KEY (scope, subject_hash, window_start)'), 'Abuse bucket uniqueness is missing.');
assert.ok(migration.includes('contact_delivery_suppressions'), 'Suppression registry is missing.');

assert.ok(workflow.includes('workflow_dispatch:'), 'Real-provider acceptance must remain manually dispatched.');
assert.ok(workflow.includes('environment: contact-provider-staging'), 'Protected staging environment is missing.');
assert.ok(workflow.includes('CONTACT_PROVIDER_STAGING_EMAIL'), 'Staging email destination secret is missing.');
assert.ok(workflow.includes('CONTACT_PROVIDER_STAGING_PHONE'), 'Staging phone destination secret is missing.');
assert.ok(workflow.includes('retention-days: 3'), 'Staging evidence retention must stay short.');
assert.ok(!workflow.includes('pull_request:'), 'Provider delivery must never run automatically on pull requests.');

assert.ok(smoke.includes("latest.status !== 'delivered'"), 'Staging acceptance does not require delivered status.');
assert.ok(smoke.includes('destinationIncluded: false'), 'Evidence does not declare destination redaction.');
assert.ok(smoke.includes('verificationCodeIncluded: false'), 'Evidence does not declare code redaction.');
assert.ok(!smoke.includes('console.log(destination)'), 'Staging smoke logs the destination.');
assert.ok(!smoke.includes('console.log(code)'), 'Staging smoke logs the verification code.');

for (const rule of [
  'ask a learner for their password, six-digit verification code or recovery code',
  'manually mark an unverified contact as verified',
  'no manual bypass',
  'feature-off rollback',
  'protected real-provider acceptance workflow',
  'HMAC-pseudonymous'
]) {
  assert.ok(runbook.toLowerCase().includes(rule.toLowerCase()), `Support runbook rule is missing: ${rule}`);
}

assert.ok(packageJson.includes('validate:provider-gateway'), 'Provider gateway validator is not wired into package scripts.');
assert.ok(packageJson.includes('types:provider-gateway'), 'Provider gateway generated types are not wired into package scripts.');

console.log('Contact provider gateway validated: default-off config, generated types, D1 evidence minimization, signed callbacks, abuse controls, protected real-provider acceptance and support boundaries are present.');

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}
