import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  contactVerificationReady,
  createContactVerificationTicket,
  handleContactVerificationRequest,
  maskVerificationDestination,
  normalizeVerificationDestination,
  verifyContactVerificationTicket,
  type ContactVerificationTicketPayload
} from '../worker/contact-verification';
import { verificationProviderReady } from '../worker/integrations/verification';

assert.equal(normalizeVerificationDestination('email', '  Learner.Test+sql@Example.COM  '), 'learner.test+sql@example.com');
assert.equal(normalizeVerificationDestination('email', 'missing-at.example.com'), null);
assert.equal(normalizeVerificationDestination('email', 'double..dot@example.com'), null);
assert.equal(normalizeVerificationDestination('sms', ' +1 (303) 555-0100 '), '+13035550100');
assert.equal(normalizeVerificationDestination('sms', '303-555-0100'), null);
assert.equal(maskVerificationDestination('email', 'learner@example.com'), 'l***@example.com');
assert.equal(maskVerificationDestination('sms', '+13035550100'), '+1******0100');

const signingEnv = {
  CONTACT_VERIFICATION_SIGNING_SECRET: 'test-signing-secret-with-at-least-thirty-two-characters'
} as Cloudflare.Env;
const now = Date.now();
const payload: ContactVerificationTicketPayload = {
  version: 1,
  challengeId: '00000000-0000-4000-8000-000000000001',
  channel: 'email',
  purpose: 'register',
  destinationDigest: 'a'.repeat(64),
  issuedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 10 * 60_000).toISOString()
};
const ticket = await createContactVerificationTicket(payload, signingEnv);
assert.deepEqual(await verifyContactVerificationTicket(ticket, signingEnv, {
  channel: 'email',
  purpose: 'register',
  destinationDigest: payload.destinationDigest
}, now), payload);
const [encodedTicketPayload, ticketSignature] = ticket.split('.');
const tamperedSignature = `${ticketSignature[0] === 'A' ? 'B' : 'A'}${ticketSignature.slice(1)}`;
assert.equal(await verifyContactVerificationTicket(
  `${encodedTicketPayload}.${tamperedSignature}`,
  signingEnv,
  {},
  now
), null, 'A modified ticket must fail signature verification.');
assert.equal(await verifyContactVerificationTicket(ticket, signingEnv, { channel: 'sms' }, now), null,
  'A ticket must be bound to its expected channel.');
assert.equal(await verifyContactVerificationTicket(ticket, signingEnv, {}, now + 10 * 60_000), null,
  'An expired ticket must not be accepted.');

const disabled = {} as Cloudflare.Env;
assert.equal(verificationProviderReady('email', disabled), false);
assert.equal(contactVerificationReady('email', disabled), false);
const hidden = await handleContactVerificationRequest(
  new Request('https://academy.example.test/api/auth/contact/challenge', {
    method: 'POST',
    body: JSON.stringify({ channel: 'email', purpose: 'register', destination: 'learner@example.com' })
  }),
  disabled
);
assert.ok(hidden);
assert.equal(hidden.status, 404, 'Disabled contact verification endpoints must stay hidden.');

const configured = {
  FEATURE_EMAIL_VERIFICATION: 'on',
  CONTACT_VERIFICATION_SIGNING_SECRET: 'test-signing-secret-with-at-least-thirty-two-characters',
  EMAIL_VERIFICATION_WEBHOOK_URL: 'https://verification.example.test/deliver',
  EMAIL_VERIFICATION_WEBHOOK_SECRET: 'provider-secret-at-least-sixteen'
} as Cloudflare.Env;
assert.equal(verificationProviderReady('email', configured), true);
assert.equal(contactVerificationReady('email', configured), true);
assert.equal(contactVerificationReady('sms', configured), false);
assert.equal(verificationProviderReady('email', {
  ...configured,
  EMAIL_VERIFICATION_WEBHOOK_URL: 'http://verification.example.test/deliver'
} as Cloudflare.Env), false, 'Provider delivery must require HTTPS.');

const migration = readFileSync(new URL('../migrations/0018_contact_verification.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS contact_verification_challenges/);
assert.match(migration, /destination_digest TEXT NOT NULL/);
assert.match(migration, /code_verifier TEXT NOT NULL/);
assert.match(migration, /attempts_remaining INTEGER NOT NULL DEFAULT 5/);
assert.match(migration, /consumed_at TEXT/);
assert.doesNotMatch(migration, /\bdestination\s+TEXT\b/,
  'Raw email addresses or phone numbers must not be persisted in D1.');
assert.doesNotMatch(migration, /\bcode\s+TEXT\b/,
  'Plain verification codes must not be persisted in D1.');

const routeSource = readFileSync(new URL('../worker/contact-verification.ts', import.meta.url), 'utf8');
for (const marker of [
  'crypto.getRandomValues',
  "{ name: 'HMAC', hash: 'SHA-256' }",
  'attempts_remaining = MAX(0, attempts_remaining - 1)',
  'confirmed_at IS NOT NULL AND consumed_at IS NULL',
  "x-contact-verification-contract': 'contact-verification-v1'"
]) assert.ok(routeSource.includes(marker), `Contact verification route is missing: ${marker}`);
assert.doesNotMatch(routeSource, /Math\.random/);
assert.doesNotMatch(routeSource, /console\.(?:log|error)\([^\n]*destination/,
  'Contact destinations must not be written to logs.');

const providerSource = readFileSync(new URL('../worker/integrations/verification.ts', import.meta.url), 'utf8');
assert.match(providerSource, /redirect: 'error'/);
assert.match(providerSource, /idempotency-key/);
assert.doesNotMatch(providerSource, /await response\.(?:text|json)\(/,
  'The provider adapter must not read an unbounded response body.');

const workerSource = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
assert.match(workerSource, /handleContactVerificationRequest/);
assert.match(workerSource, /x-contact-verification-contract/);

const productionConfig = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const typegenConfig = readFileSync(new URL('../wrangler.typegen.jsonc', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/cloudflare.yml', import.meta.url), 'utf8');
for (const source of [productionConfig, typegenConfig, workflow]) {
  for (const secret of [
    'CONTACT_VERIFICATION_SIGNING_SECRET',
    'EMAIL_VERIFICATION_WEBHOOK_URL',
    'EMAIL_VERIFICATION_WEBHOOK_SECRET',
    'SMS_VERIFICATION_WEBHOOK_URL',
    'SMS_VERIFICATION_WEBHOOK_SECRET'
  ]) assert.ok(!source.includes(secret), `${secret} must remain a Cloudflare secret, not deployment configuration.`);
}

console.log('Contact challenge normalization, HMAC tickets, expiry, one-time consumption schema and fail-closed provider readiness are valid.');
