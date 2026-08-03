import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commercialCapabilities, commercialConfigurationErrors } from '../worker/commercial-capabilities';

const disabled = commercialCapabilities({} as Cloudflare.Env);
assert.equal(disabled.integrations.emailVerification.enabled, false);
assert.equal(disabled.integrations.smsVerification.enabled, false);
assert.deepEqual(disabled.integrations.turnstile, { enabled: false });

const contactConfigured = commercialCapabilities({
  FEATURE_EMAIL_VERIFICATION: 'on',
  CONTACT_VERIFICATION_SIGNING_SECRET: 'contact-signing-secret-with-more-than-thirty-two-characters',
  EMAIL_VERIFICATION_WEBHOOK_URL: 'https://provider.example.test/email',
  EMAIL_VERIFICATION_WEBHOOK_SECRET: 'provider-secret-with-sixteen-characters'
} as Cloudflare.Env);
assert.equal(contactConfigured.integrations.emailVerification.enabled, true);
assert.equal(contactConfigured.integrations.smsVerification.enabled, false);

const turnstileConfigured = {
  FEATURE_TURNSTILE: 'on',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: 'turnstile-secret',
  TURNSTILE_EXPECTED_HOSTNAMES: 'academy.example.test'
} as Cloudflare.Env;
assert.deepEqual(commercialCapabilities(turnstileConfigured).integrations.turnstile, {
  enabled: true,
  siteKey: '1x00000000000000000000AA'
});
assert.deepEqual(commercialConfigurationErrors(turnstileConfigured), []);
assert.ok(commercialConfigurationErrors({
  ...turnstileConfigured,
  TURNSTILE_SITE_KEY: ''
} as Cloudflare.Env).includes('TURNSTILE_INCOMPLETE'));

const client = readFileSync(new URL('../src/lib/contact-auth.ts', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../src/components/VerifiedContactPortal.tsx', import.meta.url), 'utf8');
const fetchLayer = readFileSync(new URL('../src/lib/api-fetch.ts', import.meta.url), 'utf8');
const turnstile = readFileSync(new URL('../src/lib/turnstile-client.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/verified-contact.css', import.meta.url), 'utf8');

for (const path of [
  '/api/capabilities',
  '/api/auth/contact/challenge',
  '/api/auth/contact/confirm',
  '/api/auth/contact/register',
  '/api/auth/contact/password/reset',
  '/api/auth/contact/contacts'.replace('/contact/contacts', '/contacts'),
  '/api/auth/contact/attach'
]) assert.ok(client.includes(path), `Contact client is missing ${path}`);

for (const marker of [
  'integrations.emailVerification.enabled',
  'integrations.smsVerification.enabled',
  "purposeFor(operation)",
  "sql-academy-registration-pending",
  'response.recoveryCodes.length !== 8',
  'listVerifiedContacts()',
  'attachVerifiedContact(ticket, currentPassword)',
  'resetPasswordWithVerifiedContact(ticket, password)',
  'Ticket хранится только в памяти этой формы',
  'data-testid="verified-contact-guest-actions"',
  'data-testid="verified-contact-security-card"'
]) assert.ok(portal.includes(marker), `Verified-contact portal is missing ${marker}`);

assert.ok(!portal.includes('localStorage.setItem'), 'Raw contact flow must not persist form state in localStorage');
assert.ok(!/sessionStorage\.setItem\([^\n]+(?:destination|ticket|code)/i.test(portal),
  'Raw destination, ticket or verification code must not be persisted in sessionStorage');
assert.ok(portal.includes("sessionStorage.setItem(PENDING_REGISTRATION_KEY"),
  'Verified registration must reuse the mandatory recovery-code handoff');

for (const [path, action] of [
  ['/api/auth/register', 'register'],
  ['/api/auth/login', 'login'],
  ['/api/auth/password/reset', 'password-reset'],
  ['/api/auth/contact/challenge', 'contact-challenge'],
  ['/api/auth/contact/register', 'contact-register'],
  ['/api/auth/contact/password/reset', 'contact-password-reset']
]) {
  assert.ok(fetchLayer.includes(`['${path}', '${action}']`), `Turnstile action mapping is missing ${path}`);
}
assert.ok(fetchLayer.includes("headers.set('cf-turnstile-response'"), 'Public auth requests do not receive a Turnstile token');
assert.ok(fetchLayer.includes("url.pathname === '/api/auth/contact/confirm'"), 'Contact confirmation is not classified as a public auth request');

for (const marker of [
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  "execution: 'execute'",
  "appearance: 'interaction-only'",
  "action,",
  'TOKEN_TIMEOUT_MS',
  "'error-callback'",
  "'expired-callback'",
  'api.remove(widgetId)'
]) assert.ok(turnstile.includes(marker), `Turnstile SPA client is missing ${marker}`);

assert.ok(main.includes('<VerifiedContactPortal />'), 'Verified contact portal is not mounted outside AuthGate');
assert.ok(main.includes("import './verified-contact.css'"), 'Verified contact responsive styles are not loaded');
assert.ok(css.includes('@media(max-width:640px)'), 'Verified contact flow has no mobile layout contract');
assert.ok(css.includes('.turnstile-challenge-shell'), 'Turnstile interaction state has no visible status shell');

console.log('Capability-gated contact UI validated: hidden-by-default registration, binding and recovery, mandatory recovery-code handoff, memory-only verification state and action-bound Turnstile tokens.');
