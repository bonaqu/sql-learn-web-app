import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { handlePublicCommercialRequest } from '../worker/commercial-routes';
import { withSecurityHeaders } from '../worker/http-security';
import {
  adminAllowedUserIds,
  commercialCapabilities,
  commercialConfigurationErrors,
  configuredOrigins,
  requestOriginAllowed
} from '../worker/runtime-config';
import { publicAuthTurnstileAction } from '../worker/turnstile';

function env(overrides: Record<string, unknown> = {}) {
  return overrides as unknown as Cloudflare.Env;
}

const disabled = env({
  FEATURE_EMAIL_VERIFICATION: 'off',
  FEATURE_SMS_VERIFICATION: 'off',
  FEATURE_TURNSTILE: 'off',
  FEATURE_ADMIN_CONSOLE: 'off'
});
assert.deepEqual(commercialCapabilities(disabled), {
  version: 1,
  usernamePassword: true,
  recoveryCodes: true,
  emailVerification: false,
  smsVerification: false,
  turnstile: false,
  adminConsole: false
});
assert.deepEqual(commercialConfigurationErrors(disabled), []);

const incomplete = env({
  FEATURE_EMAIL_VERIFICATION: 'on',
  EMAIL_PROVIDER: 'webhook',
  FEATURE_SMS_VERIFICATION: 'on',
  FEATURE_TURNSTILE: 'on',
  TURNSTILE_SECRET_KEY: 'secret-value',
  FEATURE_ADMIN_CONSOLE: 'on'
});
assert.equal(commercialCapabilities(incomplete).emailVerification, false);
assert.equal(commercialCapabilities(incomplete).smsVerification, false);
assert.equal(commercialCapabilities(incomplete).turnstile, false);
assert.equal(commercialCapabilities(incomplete).adminConsole, false);
assert.deepEqual(commercialConfigurationErrors(incomplete).sort(), [
  'ADMIN_ALLOWLIST_EMPTY',
  'EMAIL_VERIFICATION_INCOMPLETE',
  'SMS_VERIFICATION_INCOMPLETE',
  'TURNSTILE_INCOMPLETE'
]);
const hiddenIncompleteAdmin = handlePublicCommercialRequest(
  new Request('https://api.example.com/api/admin/health'),
  incomplete
);
assert(hiddenIncompleteAdmin);
assert.equal(hiddenIncompleteAdmin.status, 404);

const configured = env({
  FEATURE_EMAIL_VERIFICATION: 'on',
  EMAIL_PROVIDER: 'buyer-webhook',
  EMAIL_PROVIDER_ENDPOINT: 'https://mail.example.com/verify',
  EMAIL_API_KEY: 'email-secret',
  EMAIL_FROM: 'academy@example.com',
  FEATURE_SMS_VERIFICATION: 'on',
  SMS_PROVIDER: 'buyer-webhook',
  SMS_PROVIDER_ENDPOINT: 'https://sms.example.com/verify',
  SMS_API_KEY: 'sms-secret',
  SMS_FROM: 'SQL Academy',
  FEATURE_TURNSTILE: 'on',
  TURNSTILE_SECRET_KEY: 'turnstile-secret',
  TURNSTILE_EXPECTED_HOSTNAMES: 'academy.example.com',
  FEATURE_ADMIN_CONSOLE: 'on',
  ADMIN_ALLOWED_USER_IDS: 'user_12345678,user_abcdefgh',
  ALLOWED_ORIGINS: 'https://academy.example.com,https://admin.example.com,not-a-url'
});
assert.deepEqual(commercialCapabilities(configured), {
  version: 1,
  usernamePassword: true,
  recoveryCodes: true,
  emailVerification: true,
  smsVerification: true,
  turnstile: true,
  adminConsole: true
});
assert.deepEqual(commercialConfigurationErrors(configured), []);
assert.equal(adminAllowedUserIds(configured).has('user_12345678'), true);
assert.equal(configuredOrigins(configured).has('https://academy.example.com'), true);
assert.equal(configuredOrigins(configured).has('not-a-url'), false);
assert.equal(requestOriginAllowed(new Request('https://api.example.com/api/health', {
  headers: { origin: 'https://academy.example.com' }
}), configured), 'https://academy.example.com');
assert.equal(requestOriginAllowed(new Request('https://api.example.com/api/health', {
  headers: { origin: 'https://evil.example.net' }
}), configured), false);

assert.equal(publicAuthTurnstileAction(new Request('https://api.example.com/api/auth/register', { method: 'POST' })), 'register');
assert.equal(publicAuthTurnstileAction(new Request('https://api.example.com/api/auth/login', { method: 'POST' })), 'login');
assert.equal(publicAuthTurnstileAction(new Request('https://api.example.com/api/auth/password/reset', { method: 'POST' })), 'password-reset');
assert.equal(publicAuthTurnstileAction(new Request('https://api.example.com/api/auth/session')), null);

const capabilitiesResponse = handlePublicCommercialRequest(
  new Request('https://api.example.com/api/capabilities'),
  disabled
);
assert(capabilitiesResponse);
assert.equal(capabilitiesResponse.status, 200);
const payload = await capabilitiesResponse.json() as { capabilities?: { turnstile?: boolean } };
assert.equal(payload.capabilities?.turnstile, false);

const hiddenAdmin = handlePublicCommercialRequest(
  new Request('https://api.example.com/api/admin/health'),
  disabled
);
assert(hiddenAdmin);
assert.equal(hiddenAdmin.status, 404);

const secured = withSecurityHeaders(new Response('ok'), new Request('https://api.example.com/'));
assert.equal(secured.headers.get('x-frame-options'), 'DENY');
assert.match(secured.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
assert.match(secured.headers.get('strict-transport-security') || '', /max-age=31536000/);

const deploymentWorkflow = readFileSync('.github/workflows/cloudflare.yml', 'utf8');
const productionSmoke = readFileSync('scripts/commercial-runtime-production-smoke.mjs', 'utf8');
for (const required of [
  "ALLOWED_ORIGINS: ${{ vars.ALLOWED_ORIGINS || 'https://bonaqu.github.io' }}",
  'PRODUCT_NAME: process.env.PRODUCT_NAME',
  'FEATURE_TURNSTILE: process.env.FEATURE_TURNSTILE',
  'node scripts/commercial-runtime-production-smoke.mjs',
  'cloudflare-commercial-stage.txt'
]) {
  assert(deploymentWorkflow.includes(required), `Cloudflare deployment is missing commercial runtime wiring: ${required}`);
}
for (const required of [
  "expected: [expectedAdmin ? 401 : 404]",
  "origin: 'https://commercial-smoke-rejected.invalid'",
  "capabilities.usernamePassword !== true",
  "capabilities.recoveryCodes !== true",
  "'strict-transport-security'"
]) {
  assert(productionSmoke.includes(required), `Commercial production smoke is missing: ${required}`);
}
for (const forbidden of ['EMAIL_API_KEY:', 'SMS_API_KEY:', 'TURNSTILE_SECRET_KEY:']) {
  assert(!deploymentWorkflow.includes(forbidden), `Secret must not be written to deployment config: ${forbidden}`);
}

console.log('Commercial runtime validation passed: default-off completeness, CORS, hidden admin, Turnstile actions, security headers and production deployment wiring.');
