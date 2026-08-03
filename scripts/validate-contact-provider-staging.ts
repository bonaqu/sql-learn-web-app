import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import adapter from '../provider-adapter/staging-worker.mjs';

class TestKv {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();

  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.values.set(key, value);
    this.ttls.set(key, Number(options?.expirationTtl) || 0);
  }

  async get(key: string) {
    return this.values.get(key) || null;
  }
}

const kv = new TestKv();
const providerCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  providerCalls.push({ url: String(input), init });
  return new Response(JSON.stringify({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}) as typeof fetch;

try {
  const env = {
    CONTACT_STAGING_STATE: kv,
    STAGING_CAPTURE_ENABLED: 'on',
    STAGING_CAPTURE_SECRET: 'staging-capture-secret-at-least-thirty-two-characters',
    EMAIL_INBOUND_WEBHOOK_SECRET: 'email-inbound-webhook-secret',
    SMS_INBOUND_WEBHOOK_SECRET: 'sms-inbound-webhook-secret',
    RESEND_API_KEY: 're_test_provider_acceptance',
    RESEND_FROM: 'SQL Academy <verify@example.test>'
  };
  const challengeId = '00000000-0000-4000-8000-000000000030';
  const requestBody = {
    contract: 'contact-verification-delivery-v1',
    challengeId,
    channel: 'email',
    destination: 'learner@example.test',
    purpose: 'register',
    code: '123456',
    expiresAt: new Date(Date.now() + 600_000).toISOString()
  };

  const unauthorized = await adapter.fetch(new Request('https://adapter.example.test/deliver', {
    method: 'POST',
    headers: {
      authorization: 'Bearer incorrect-inbound-webhook-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  }), env);
  assert.equal(unauthorized.status, 404);
  assert.equal(providerCalls.length, 0);

  const invalidDestination = await adapter.fetch(new Request('https://adapter.example.test/deliver', {
    method: 'POST',
    headers: {
      authorization: 'Bearer email-inbound-webhook-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ ...requestBody, destination: 'not-an-email' })
  }), env);
  assert.equal(invalidDestination.status, 400);
  assert.equal(providerCalls.length, 0);

  const delivery = await adapter.fetch(new Request('https://adapter.example.test/deliver', {
    method: 'POST',
    headers: {
      authorization: 'Bearer email-inbound-webhook-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  }), env);
  assert.equal(delivery.status, 202);
  assert.equal(delivery.headers.get('x-verification-message-id'), '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794');
  assert.equal(delivery.headers.get('x-verification-provider'), 'resend');
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].url, 'https://api.resend.com/emails');
  const providerHeaders = new Headers(providerCalls[0].init?.headers);
  assert.equal(providerHeaders.get('idempotency-key'), challengeId);
  assert.equal(providerHeaders.get('authorization'), 'Bearer re_test_provider_acceptance');
  assert.equal(kv.ttls.get(`challenge:${challengeId}`), 3_600);

  const hiddenCapture = await adapter.fetch(new Request(`https://adapter.example.test/capture/${challengeId}`), {
    ...env,
    STAGING_CAPTURE_ENABLED: 'off'
  });
  assert.equal(hiddenCapture.status, 404);

  const unauthorizedCapture = await adapter.fetch(new Request(`https://adapter.example.test/capture/${challengeId}`, {
    headers: { authorization: 'Bearer incorrect-capture-secret-at-least-thirty-two-characters' }
  }), env);
  assert.equal(unauthorizedCapture.status, 404);

  const capture = await adapter.fetch(new Request(`https://adapter.example.test/capture/${challengeId}`, {
    headers: { authorization: 'Bearer staging-capture-secret-at-least-thirty-two-characters' }
  }), env);
  assert.equal(capture.status, 200);
  const captureBody = await capture.json() as { code: string; providerMessageId: string };
  assert.equal(captureBody.code, '123456');
  assert.equal(captureBody.providerMessageId, '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794');
} finally {
  globalThis.fetch = originalFetch;
}

const adapterSource = readFileSync(new URL('../provider-adapter/staging-worker.mjs', import.meta.url), 'utf8');
for (const marker of [
  'https://api.resend.com/emails',
  'https://api.twilio.com/2010-04-01/Accounts/',
  "'idempotency-key': challenge.challengeId",
  'CONTACT_STAGING_STATE.put',
  "expirationTtl: 3_600",
  'STAGING_CAPTURE_ENABLED',
  'PROVIDER_RESPONSE_BYTES',
  'PROVIDER_TIMEOUT_MS',
  'async function secretMatches(',
  'async function providerFetch(',
  'normalizeEmail(body.destination)',
  'normalizePhone(body.destination)',
  "expiresAtMs > Date.now() + 15 * 60_000"
]) assert.ok(adapterSource.includes(marker), `Staging adapter is missing: ${marker}`);
assert.doesNotMatch(adapterSource, /bearer\(request\)\s*!==?\s*expectedSecret/,
  'Staging adapter secrets must not use direct string equality.');
assert.doesNotMatch(adapterSource, /console\.(?:log|error)\([^\n]*(?:destination|providerMessageId|challengeId|code: body\.code)/,
  'Staging adapter must not log a destination, code, challenge ID or provider message ID.');

const acceptanceSource = readFileSync(new URL('./contact-provider-staging-acceptance.mjs', import.meta.url), 'utf8');
for (const marker of [
  "const REQUIRED_TERMINAL_STATUS = 'delivered'",
  '::add-mask::',
  'api.resend.com/emails/',
  'api.twilio.com/2010-04-01/Accounts/',
  'contact-verification-delivery-event-v1',
  '/api/auth/contact/confirm',
  'contact-provider-staging-evidence-v1',
  'REQUEST_TIMEOUT_MS',
  'async function fetchWithTimeout(',
  "['127.0.0.1', 'localhost', '::1']",
  '{ mode: 0o600 }'
]) assert.ok(acceptanceSource.includes(marker), `Acceptance runner is missing: ${marker}`);
const evidenceBlock = acceptanceSource.slice(acceptanceSource.indexOf("contract: 'contact-provider-staging-evidence-v1'"));
for (const forbidden of ['destination', 'code:', 'ticket', 'challengeId', 'providerMessageId']) {
  assert.ok(!evidenceBlock.includes(forbidden), `Redacted evidence includes forbidden field: ${forbidden}`);
}

const workflow = readFileSync(new URL('../.github/workflows/contact-provider-staging.yml', import.meta.url), 'utf8');
for (const marker of [
  'workflow_dispatch:',
  'environment: contact-provider-staging',
  'CONTACT_STAGING_EMAIL_DESTINATION',
  'CONTACT_STAGING_SMS_DESTINATION',
  'RESEND_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'EMAIL_VERIFICATION_EVENT_SECRET',
  'SMS_VERIFICATION_EVENT_SECRET',
  'contact-provider-staging-evidence.json',
  'if: success()',
  'retention-days: 3'
]) assert.ok(workflow.includes(marker), `Staging workflow is missing: ${marker}`);
assert.ok(!workflow.includes('push:'), 'Real-provider acceptance must never run automatically on a production push.');
assert.ok(!workflow.includes('| tee'), 'Masked workflow commands must never be copied into an artifact with tee.');
assert.ok(!workflow.includes('contact-provider-staging.log'), 'Provider staging artifacts must contain only redacted JSON evidence.');
assert.ok(!workflow.includes('if-no-files-found: ignore'), 'A successful acceptance must fail if redacted evidence is missing.');

const runbook = readFileSync(new URL('../docs/contact-provider-staging-runbook.md', import.meta.url), 'utf8');
for (const marker of [
  'Production activation is blocked',
  'SPF and DKIM',
  'DMARC',
  'X-Twilio-Signature',
  'CONTACT_DELIVERY_RATE_LOW',
  'Support must never ask for',
  'disable only the affected channel feature flag',
  'confirmed but unused challenges: 24 hours'
]) assert.ok(runbook.includes(marker), `Provider runbook is missing: ${marker}`);

console.log('Contact provider staging validated: real Resend/Twilio HTTP adapters, constant-time staging secrets, bounded external requests, protected delivered-only acceptance, evidence-only short-retention artifacts and operational support controls.');
