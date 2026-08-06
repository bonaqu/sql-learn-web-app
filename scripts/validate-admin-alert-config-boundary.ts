import assert from 'node:assert/strict';
import {
  adminAlertConfigurationErrors,
  adminAlertCooldownMinutes,
  adminAlertWebhookUrl,
  configuredAdminAlertCron
} from '../worker/admin-alert-config';

const base = {
  FEATURE_ADMIN_ALERTS: 'on',
  ADMIN_ALERT_CRON: '17 * * * *',
  ADMIN_ALERT_COOLDOWN_MINUTES: '60',
  ADMIN_ALERT_WEBHOOK_SECRET: 'buyer-owned-alert-secret-at-least-thirty-two-characters',
  DB: {},
  SETTINGS: {}
} as unknown as Cloudflare.Env;

assert.equal(configuredAdminAlertCron(base), '17 * * * *');
assert.equal(adminAlertCooldownMinutes(base), 60);
assert.equal(adminAlertWebhookUrl({ ...base, ADMIN_ALERT_WEBHOOK_URL: 'https://alerts.example.test/hooks?route=opaque' } as Cloudflare.Env),
  'https://alerts.example.test/hooks?route=opaque');

for (const forbiddenUrl of [
  'http://alerts.example.test/hook',
  'https://user:password@alerts.example.test/hook',
  'https://alerts.example.test/hook#fragment',
  'https://localhost/hook',
  'https://receiver.local/hook',
  'https://receiver.internal/hook',
  'https://127.0.0.1/hook',
  'https://10.0.0.1/hook',
  'https://100.64.0.1/hook',
  'https://169.254.169.254/latest/meta-data',
  'https://172.16.0.1/hook',
  'https://192.168.1.1/hook',
  'https://198.18.0.1/hook',
  'https://224.0.0.1/hook',
  'https://[::1]/hook',
  'https://[fd00::1]/hook'
]) {
  const env = { ...base, ADMIN_ALERT_WEBHOOK_URL: forbiddenUrl } as Cloudflare.Env;
  assert.equal(adminAlertWebhookUrl(env), null, `Unsafe webhook target was accepted: ${forbiddenUrl}`);
  assert.ok(adminAlertConfigurationErrors(env).includes('ADMIN_ALERT_WEBHOOK_URL_INVALID'));
}

for (const invalidCron of ['', '*/5 * * *', '*/5 * * * * extra', '17 * * * *\nnext']) {
  const env = { ...base, ADMIN_ALERT_CRON: invalidCron, ADMIN_ALERT_WEBHOOK_URL: 'https://alerts.example.test/hook' } as Cloudflare.Env;
  assert.equal(configuredAdminAlertCron(env), null);
  assert.ok(adminAlertConfigurationErrors(env).some(code => code === 'ADMIN_ALERT_CRON_MISSING' || code === 'ADMIN_ALERT_CRON_INVALID'));
}

for (const invalidCooldown of ['0', '4', '1441', '1.5', '-1', 'NaN']) {
  const env = {
    ...base,
    ADMIN_ALERT_WEBHOOK_URL: 'https://alerts.example.test/hook',
    ADMIN_ALERT_COOLDOWN_MINUTES: invalidCooldown
  } as Cloudflare.Env;
  assert.equal(adminAlertCooldownMinutes(env), 60);
  assert.ok(adminAlertConfigurationErrors(env).includes('ADMIN_ALERT_COOLDOWN_INVALID'));
}

console.log('Admin alert configuration boundary validated: HTTPS public destinations, no local/private literals, exact five-field schedule and bounded cooldown.');
