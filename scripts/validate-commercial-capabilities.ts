import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleHiddenAdminBoundary } from '../worker/admin-health';
import {
  commercialCapabilities,
  commercialConfigurationErrors,
  handleCommercialCapabilitiesRequest
} from '../worker/commercial-capabilities';
import { withSecurityHeaders } from '../worker/http-security';
import { publicAuthTurnstileAction } from '../worker/turnstile';

const disabled = commercialCapabilities({} as Cloudflare.Env);
assert.equal(disabled.contract, 'commercial-capabilities-v1');
assert.equal(disabled.authentication.usernamePassword, true);
assert.equal(disabled.authentication.recoveryCodes, true);
assert.deepEqual(disabled.integrations, {
  emailVerification: { enabled: false },
  smsVerification: { enabled: false },
  turnstile: { enabled: false },
  adminConsole: { enabled: false },
  adminAlerts: { enabled: false }
});

const incomplete = {
  FEATURE_EMAIL_VERIFICATION: 'on',
  FEATURE_SMS_VERIFICATION: 'ON',
  FEATURE_TURNSTILE: 'on',
  TURNSTILE_SECRET_KEY: 'secret-value',
  FEATURE_ADMIN_CONSOLE: 'on'
} as Cloudflare.Env;
assert.deepEqual(commercialCapabilities(incomplete).integrations, disabled.integrations,
  'Incomplete configuration must keep every optional capability disabled.');
assert.deepEqual(commercialConfigurationErrors(incomplete).sort(), [
  'ADMIN_ALLOWLIST_EMPTY',
  'EMAIL_VERIFICATION_INCOMPLETE',
  'SMS_VERIFICATION_INCOMPLETE',
  'TURNSTILE_INCOMPLETE'
]);
assert.equal(handleHiddenAdminBoundary(new Request('https://academy.example.test/api/admin/health'), incomplete)?.status, 404);
assert.equal(handleHiddenAdminBoundary(new Request('https://academy.example.test/api/admin/alerts'), incomplete)?.status, 404);

const configured = {
  FEATURE_EMAIL_VERIFICATION: 'on',
  FEATURE_SMS_VERIFICATION: 'on',
  CONTACT_VERIFICATION_SIGNING_SECRET: 'test-signing-secret-with-at-least-thirty-two-characters',
  EMAIL_VERIFICATION_WEBHOOK_URL: 'https://verification.example.test/email',
  EMAIL_VERIFICATION_WEBHOOK_SECRET: 'email-provider-secret-at-least-sixteen',
  EMAIL_VERIFICATION_EVENT_SECRET: 'email-event-secret-at-least-thirty-two-characters',
  SMS_VERIFICATION_WEBHOOK_URL: 'https://verification.example.test/sms',
  SMS_VERIFICATION_WEBHOOK_SECRET: 'sms-provider-secret-at-least-sixteen',
  SMS_VERIFICATION_EVENT_SECRET: 'sms-event-secret-at-least-thirty-two-characters',
  FEATURE_TURNSTILE: 'on',
  TURNSTILE_SECRET_KEY: 'turnstile-secret',
  TURNSTILE_EXPECTED_HOSTNAMES: 'academy.example.com',
  FEATURE_ADMIN_CONSOLE: 'on',
  ADMIN_ALLOWED_USER_IDS: 'user_12345678'
} as Cloudflare.Env;
assert.deepEqual(commercialCapabilities(configured).integrations, {
  emailVerification: { enabled: true },
  smsVerification: { enabled: true },
  turnstile: { enabled: true },
  adminConsole: { enabled: true },
  adminAlerts: { enabled: false }
});
assert.deepEqual(commercialConfigurationErrors(configured), []);
assert.equal(handleHiddenAdminBoundary(new Request('https://academy.example.test/api/admin/health'), configured), null);
assert.equal(handleHiddenAdminBoundary(new Request('https://academy.example.test/api/admin/alerts'), configured), null);

const alertConfigured = {
  ...configured,
  DB: {},
  SETTINGS: {},
  FEATURE_ADMIN_ALERTS: 'on',
  ADMIN_ALERT_CRON: '17 * * * *',
  ADMIN_ALERT_COOLDOWN_MINUTES: '60',
  ADMIN_ALERT_WEBHOOK_URL: 'https://alerts.example.test/sql-academy',
  ADMIN_ALERT_WEBHOOK_SECRET: 'buyer-owned-alert-secret-at-least-thirty-two-characters'
} as unknown as Cloudflare.Env;
assert.equal(commercialCapabilities(alertConfigured).integrations.adminAlerts.enabled, true);
assert.deepEqual(commercialConfigurationErrors(alertConfigured), []);

const missingDeliveryEvents = {
  ...configured,
  EMAIL_VERIFICATION_EVENT_SECRET: ''
} as Cloudflare.Env;
assert.equal(commercialCapabilities(missingDeliveryEvents).integrations.emailVerification.enabled, false,
  'Outbound-only email configuration must remain hidden without signed delivery events.');
assert.deepEqual(commercialConfigurationErrors(missingDeliveryEvents), ['EMAIL_VERIFICATION_INCOMPLETE']);

const response = handleCommercialCapabilitiesRequest(new Request('https://academy.example.test/api/capabilities'), {} as Cloudflare.Env);
assert.ok(response);
assert.equal(response.status, 200);
assert.equal(response.headers.get('x-commercial-capabilities-contract'), 'commercial-capabilities-v1');
assert.equal(response.headers.get('cache-control'), 'public, max-age=60, must-revalidate');
assert.deepEqual(await response.json(), disabled);

const rejectedMethod = handleCommercialCapabilitiesRequest(
  new Request('https://academy.example.test/api/capabilities', { method: 'POST' }),
  {} as Cloudflare.Env
);
assert.ok(rejectedMethod);
assert.equal(rejectedMethod.status, 405);
assert.equal(rejectedMethod.headers.get('allow'), 'GET, OPTIONS');
assert.equal(handleCommercialCapabilitiesRequest(new Request('https://academy.example.test/api/health'), {} as Cloudflare.Env), null);

assert.equal(publicAuthTurnstileAction(new Request('https://academy.example.test/api/auth/register', { method: 'POST' })), 'register');
assert.equal(publicAuthTurnstileAction(new Request('https://academy.example.test/api/auth/login', { method: 'POST' })), 'login');
assert.equal(publicAuthTurnstileAction(new Request('https://academy.example.test/api/auth/password/reset', { method: 'POST' })), 'password-reset');
assert.equal(publicAuthTurnstileAction(new Request('https://academy.example.test/api/auth/contact/challenge', { method: 'POST' })), 'contact-challenge');
assert.equal(publicAuthTurnstileAction(new Request('https://academy.example.test/api/auth/contact/register', { method: 'POST' })), 'contact-register');
assert.equal(publicAuthTurnstileAction(new Request('https://academy.example.test/api/auth/contact/password/reset', { method: 'POST' })), 'contact-password-reset');
assert.equal(publicAuthTurnstileAction(new Request('https://academy.example.test/api/auth/contact/attach', { method: 'POST' })), null);
assert.equal(publicAuthTurnstileAction(new Request('https://academy.example.test/api/auth/session')), null);

const secured = withSecurityHeaders(new Response('ok'), new Request('https://academy.example.test/'));
assert.equal(secured.headers.get('x-frame-options'), 'DENY');
assert.match(secured.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
assert.match(secured.headers.get('strict-transport-security') || '', /max-age=31536000/);

const workerSource = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
assert.match(workerSource, /env\.ALLOWED_ORIGINS/);
assert.doesNotMatch(workerSource, /const\s+ALLOWED_ORIGINS\s*=\s*new Set/,
  'Owner-facing origins must come from deployment configuration, not source code.');
assert.match(workerSource, /handleContactVerificationRequest/);
assert.match(workerSource, /handleContactAccountRequest/);
assert.ok(workerSource.indexOf('handleContactAccountRequest(request, env)') < workerSource.indexOf('handleAuthRequest(request, env)'),
  'Verified-contact account routes must be evaluated before the generic auth fallback.');
assert.match(workerSource, /x-contact-account-contract/);
assert.match(workerSource, /handleContactDeliveryEventRequest/);
assert.ok(workerSource.indexOf('handleContactDeliveryEventRequest(request, env)') < workerSource.indexOf('enforceTurnstile(request, env)'),
  'Provider callbacks must run before browser Turnstile enforcement.');
assert.match(workerSource, /enforceTurnstile/);
assert.match(workerSource, /handleAdminHealthRequest/);
assert.match(workerSource, /withSecurityHeaders/);

const productionConfig = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const typegenConfig = readFileSync(new URL('../wrangler.typegen.jsonc', import.meta.url), 'utf8');
for (const config of [productionConfig, typegenConfig]) {
  assert.match(config, /"main": "worker\/entrypoint\.ts"/);
  assert.match(config, /"ALLOWED_ORIGINS"/);
  assert.match(config, /"FEATURE_EMAIL_VERIFICATION": "off"/);
  assert.match(config, /"FEATURE_SMS_VERIFICATION": "off"/);
  assert.match(config, /"FEATURE_TURNSTILE": "off"/);
  assert.match(config, /"FEATURE_ADMIN_CONSOLE": "off"/);
  assert.match(config, /"FEATURE_ADMIN_ALERTS": "off"/);
  assert.match(config, /"ADMIN_ALERT_CRON": ""/);
  assert.match(config, /"ADMIN_ALERT_COOLDOWN_MINUTES": "60"/);
  assert.match(config, /"TURNSTILE_EXPECTED_HOSTNAMES"/);
  assert.match(config, /"ADMIN_ALLOWED_USER_IDS"/);
  assert.doesNotMatch(config, /ADMIN_ALERT_WEBHOOK_(?:URL|SECRET)/);
}

const workflow = readFileSync(new URL('../.github/workflows/cloudflare.yml', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('./commercial-runtime-production-smoke.mjs', import.meta.url), 'utf8');
for (const marker of [
  "ALLOWED_ORIGINS: ${{ vars.ALLOWED_ORIGINS || 'https://bonaqu.github.io' }}",
  'ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS',
  'FEATURE_TURNSTILE: process.env.FEATURE_TURNSTILE',
  'FEATURE_ADMIN_ALERTS: process.env.FEATURE_ADMIN_ALERTS',
  'triggers: { crons: alertCron ? [alertCron] : [] }',
  'node scripts/commercial-runtime-production-smoke.mjs',
  'cloudflare-deployment-stage.txt',
  'for attempt in 1 2 3',
  'target_url: success && process.env.DEPLOY_URL ? process.env.DEPLOY_URL : process.env.RUN_URL'
]) assert.ok(workflow.includes(marker), `Cloudflare deployment is missing: ${marker}`);
for (const marker of [
  "expected: [expectedAdmin ? 401 : 404]",
  "origin: 'https://commercial-smoke-rejected.invalid'",
  "capabilities.contract !== 'commercial-capabilities-v1'",
  "'/api/auth/contact/register'",
  "'/api/auth/contact/password/reset'",
  "'/api/auth/contacts'",
  "'/api/auth/contact/attach'",
  "'strict-transport-security'"
]) assert.ok(smoke.includes(marker), `Commercial production smoke is missing: ${marker}`);
for (const secret of [
  'TURNSTILE_SECRET_KEY:',
  'CONTACT_VERIFICATION_SIGNING_SECRET:',
  'EMAIL_VERIFICATION_WEBHOOK_URL:',
  'EMAIL_VERIFICATION_WEBHOOK_SECRET:',
  'EMAIL_VERIFICATION_EVENT_SECRET:',
  'SMS_VERIFICATION_WEBHOOK_URL:',
  'SMS_VERIFICATION_WEBHOOK_SECRET:',
  'SMS_VERIFICATION_EVENT_SECRET:',
  'ADMIN_ALERT_WEBHOOK_URL:',
  'ADMIN_ALERT_WEBHOOK_SECRET:',
  'EMAIL_API_KEY:',
  'SMS_API_KEY:'
]) assert.ok(!workflow.includes(secret), `Secret must not be written into deployment config: ${secret}`);

console.log('Commercial capability contract, verified-contact account routing, signed delivery-event readiness, Turnstile/admin security, default-off alert routing and observable deployment wiring are fail-closed.');
