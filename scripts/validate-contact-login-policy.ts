import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  commercialCapabilities,
  commercialConfigurationErrors,
  configuredContactRegistrationPolicy,
  contactRegistrationPolicyReady,
  contactlessRegistrationAllowed
} from '../worker/commercial-capabilities';
import { handleContactLoginPolicyRequest } from '../worker/contact-login-policy';

const disabledEnv = {} as Cloudflare.Env;
assert.equal(configuredContactRegistrationPolicy(disabledEnv), 'optional');
assert.equal(contactRegistrationPolicyReady(disabledEnv), true);
assert.equal(contactlessRegistrationAllowed(disabledEnv), true);
const disabledCapabilities = commercialCapabilities(disabledEnv);
assert.deepEqual(disabledCapabilities.authentication.contactLogin, {
  passwordRequired: true,
  email: { enabled: false },
  sms: { enabled: false }
});
assert.deepEqual(disabledCapabilities.registration, {
  contactPolicy: 'optional',
  policyReady: true,
  contactlessAllowed: true
});

const incompleteRequired = {
  CONTACT_REGISTRATION_POLICY: 'required-for-new-registration'
} as Cloudflare.Env & { CONTACT_REGISTRATION_POLICY: string };
assert.equal(configuredContactRegistrationPolicy(incompleteRequired), 'required-for-new-registration');
assert.equal(contactRegistrationPolicyReady(incompleteRequired), false);
assert.equal(contactlessRegistrationAllowed(incompleteRequired), false);
assert.ok(commercialConfigurationErrors(incompleteRequired).includes('CONTACT_REGISTRATION_POLICY_INCOMPLETE'));

const configuredRequired = {
  CONTACT_REGISTRATION_POLICY: 'required-for-new-registration',
  FEATURE_EMAIL_VERIFICATION: 'on',
  CONTACT_VERIFICATION_SIGNING_SECRET: 'test-signing-secret-with-at-least-thirty-two-characters',
  EMAIL_VERIFICATION_WEBHOOK_URL: 'https://verification.example.test/email',
  EMAIL_VERIFICATION_WEBHOOK_SECRET: 'email-provider-secret-at-least-sixteen',
  EMAIL_VERIFICATION_EVENT_SECRET: 'email-event-secret-at-least-thirty-two-characters',
  FEATURE_TURNSTILE: 'on',
  TURNSTILE_SECRET_KEY: 'turnstile-secret',
  TURNSTILE_EXPECTED_HOSTNAMES: 'academy.example.test'
} as Cloudflare.Env & Record<string, string>;
assert.equal(contactRegistrationPolicyReady(configuredRequired), true);
assert.deepEqual(commercialCapabilities(configuredRequired).authentication.contactLogin, {
  passwordRequired: true,
  email: { enabled: true },
  sms: { enabled: false }
});
assert.deepEqual(commercialCapabilities(configuredRequired).registration, {
  contactPolicy: 'required-for-new-registration',
  policyReady: true,
  contactlessAllowed: false
});
assert.deepEqual(commercialConfigurationErrors(configuredRequired), []);

const optionalRegister = await handleContactLoginPolicyRequest(new Request('https://academy.test/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'legacy-user' })
}), disabledEnv);
assert.equal(optionalRegister, null, 'Optional policy must preserve legacy contactless registration.');

const unavailableRegister = await handleContactLoginPolicyRequest(new Request('https://academy.test/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}'
}), incompleteRequired);
assert.equal(unavailableRegister?.status, 503);
assert.equal((await unavailableRegister?.json() as { code?: string }).code, 'CONTACT_REGISTRATION_POLICY_UNAVAILABLE');

const requiredRegister = await handleContactLoginPolicyRequest(new Request('https://academy.test/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}'
}), configuredRequired);
assert.equal(requiredRegister?.status, 409);
assert.equal((await requiredRegister?.json() as { code?: string }).code, 'VERIFIED_CONTACT_REQUIRED');

const usernameLogin = await handleContactLoginPolicyRequest(new Request('https://academy.test/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'legacy-user', password: 'a'.repeat(15) })
}), disabledEnv);
assert.equal(usernameLogin, null, 'Username/password login must remain owned by legacy auth.');

const migration19 = readFileSync(new URL('../migrations/0019_verified_contacts.sql', import.meta.url), 'utf8');
const database = new DatabaseSync(':memory:');
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users(
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    deleted_at TEXT
  );
  ${migration19}
`);
const emailDigest = 'a'.repeat(64);
const smsDigest = 'b'.repeat(64);
database.prepare('INSERT INTO users(user_id, username, deleted_at) VALUES(?, ?, NULL)').run('user-00000001', 'alpha');
database.prepare('INSERT INTO users(user_id, username, deleted_at) VALUES(?, ?, NULL)').run('user-00000002', 'beta');
database.prepare(`INSERT INTO verified_contacts(
  contact_id, user_id, channel, destination_digest, masked_destination,
  verified_at, source_challenge_id, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run('contact-email-01', 'user-00000001', 'email', emailDigest, 'a***@example.test', '2026-08-05 00:00:00', 'challenge-email-01', '2026-08-05 00:00:00', '2026-08-05 00:00:00');
database.prepare(`INSERT INTO verified_contacts(
  contact_id, user_id, channel, destination_digest, masked_destination,
  verified_at, source_challenge_id, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run('contact-sms-0001', 'user-00000002', 'sms', smsDigest, '+49******0100', '2026-08-05 00:00:00', 'challenge-sms-0001', '2026-08-05 00:00:00', '2026-08-05 00:00:00');

const lookup = database.prepare(`SELECT u.user_id, u.username FROM verified_contacts c
  JOIN users u ON u.user_id = c.user_id
  WHERE c.channel = ? AND c.destination_digest = ?
  LIMIT 1`);
const emailOwner = lookup.get('email', emailDigest) as { user_id?: unknown; username?: unknown } | undefined;
assert.equal(emailOwner?.user_id, 'user-00000001');
assert.equal(emailOwner?.username, 'alpha');
const smsOwner = lookup.get('sms', smsDigest) as { user_id?: unknown; username?: unknown } | undefined;
assert.equal(smsOwner?.user_id, 'user-00000002');
assert.equal(smsOwner?.username, 'beta');
assert.equal(lookup.get('sms', emailDigest), undefined, 'Channel must be part of contact identity.');
assert.equal(lookup.get('email', 'f'.repeat(64)), undefined, 'Unknown digest must not resolve an account.');
database.prepare('DELETE FROM users WHERE user_id = ?').run('user-00000001');
assert.equal(lookup.get('email', emailDigest), undefined, 'Deleted-account contacts must cascade and stop resolving.');
database.close();

const capabilitiesSource = readFileSync(new URL('../worker/commercial-capabilities.ts', import.meta.url), 'utf8');
for (const marker of [
  'passwordRequired: true',
  "'required-for-new-registration'",
  'contactRegistrationPolicyReady',
  'contactlessRegistrationAllowed'
]) assert.ok(capabilitiesSource.includes(marker), `Capability policy is missing: ${marker}`);

const policySource = readFileSync(new URL('../worker/contact-login-policy.ts', import.meta.url), 'utf8');
for (const marker of [
  'contactDestinationDigest',
  'contactVerificationReady(channel, env)',
  'JOIN users u ON u.user_id = c.user_id',
  'c.channel = ? AND c.destination_digest = ?',
  'failed_login_count',
  'locked_until',
  'INSERT INTO auth_sessions',
  "body.identifierType !== 'email' && body.identifierType !== 'sms'",
  'VERIFIED_CONTACT_REQUIRED',
  'CONTACT_REGISTRATION_POLICY_UNAVAILABLE'
]) assert.ok(policySource.includes(marker), `Contact login policy is missing: ${marker}`);
assert.doesNotMatch(policySource, /send|challenge|verification code/i,
  'Password login must not send or request a verification code.');
assert.doesNotMatch(policySource, /console\.(?:log|error)\([^\n]*(?:identifier|destination|password)/i,
  'Raw identifiers and passwords must never be logged.');

const indexSource = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
assert.ok(indexSource.indexOf('enforceTurnstile(request, env)') < indexSource.indexOf('handleContactLoginPolicyRequest(request, env)'),
  'Turnstile must run before public contact login and required-contact registration policy.');
assert.ok(indexSource.indexOf('handleContactLoginPolicyRequest(request, env)') < indexSource.indexOf('handleAuthRequest(request, env)'),
  'Explicit contact login must run before the legacy username auth fallback.');
assert.match(indexSource, /x-contact-login-contract/);

console.log('Verified-contact password login and required-for-new-registration policy are capability-gated, lockout-safe, privacy-preserving and backward compatible.');
