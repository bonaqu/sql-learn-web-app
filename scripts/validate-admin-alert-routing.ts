import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  adminAlertConfigurationErrors,
  adminAlertConfigurationStatus,
  adminAlertRoutingReady
} from '../worker/admin-alert-config';
import {
  evaluateAndDispatchAdminAlerts,
  handleAdminAlertRequest,
  handleScheduledAdminAlerts
} from '../worker/admin-alert-routing';
import { handleHiddenAdminBoundary } from '../worker/admin-health';

class TestStatement {
  private parameters: unknown[] = [];

  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}

  bind(...parameters: unknown[]) {
    this.parameters = parameters;
    return this;
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.parameters) || null) as T | null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.parameters);
    return { meta: { changes: Number(result.changes) || 0 } };
  }
}

class TestD1 {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new TestStatement(this.database, sql);
  }
}

class TestKV {
  private readonly values = new Map<string, string>();

  async get<T>(key: string, type?: string) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return (type === 'json' ? JSON.parse(value) : value) as T;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }
}

const disabled = adminAlertConfigurationStatus({} as Cloudflare.Env);
assert.equal(disabled.contract, 'admin-alert-routing-v1');
assert.equal(disabled.enabled, false);
assert.equal(disabled.ready, false);
assert.equal(disabled.schedule, null);
assert.equal(disabled.cooldownMinutes, 60);
assert.deepEqual(disabled.configurationErrors, []);

const incomplete = {
  FEATURE_ADMIN_ALERTS: 'on',
  ADMIN_ALERT_CRON: 'not a cron expression',
  ADMIN_ALERT_COOLDOWN_MINUTES: '2',
  ADMIN_ALERT_WEBHOOK_URL: 'http://alerts.invalid/path',
  ADMIN_ALERT_WEBHOOK_SECRET: 'short'
} as Cloudflare.Env;
assert.equal(adminAlertRoutingReady(incomplete), false);
assert.deepEqual(adminAlertConfigurationErrors(incomplete).sort(), [
  'ADMIN_ALERT_COOLDOWN_INVALID',
  'ADMIN_ALERT_CRON_INVALID',
  'ADMIN_ALERT_D1_UNAVAILABLE',
  'ADMIN_ALERT_KV_UNAVAILABLE',
  'ADMIN_ALERT_WEBHOOK_SECRET_MISSING',
  'ADMIN_ALERT_WEBHOOK_URL_INVALID'
]);

const migration18 = readFileSync(new URL('../migrations/0018_contact_verification.sql', import.meta.url), 'utf8');
const migration20 = readFileSync(new URL('../migrations/0020_contact_provider_operations.sql', import.meta.url), 'utf8');
const database = new DatabaseSync(':memory:');
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users(user_id TEXT PRIMARY KEY, updated_at TEXT);
  CREATE TABLE auth_sessions(session_id TEXT PRIMARY KEY, expires_at TEXT);
  CREATE TABLE progress(profile_id TEXT PRIMARY KEY, updated_at TEXT);
  ${migration18}
  ${migration20}
`);
database.prepare('INSERT INTO users(user_id, updated_at) VALUES(?, ?)')
  .run('user-alert-0001', '2026-08-06 00:00:00');
database.prepare('INSERT INTO auth_sessions(session_id, expires_at) VALUES(?, ?)')
  .run('session-alert-0001', '2099-08-06 00:00:00');
database.prepare('INSERT INTO progress(profile_id, updated_at) VALUES(?, ?)')
  .run('user-alert-0001', '2026-08-06 00:00:00');

const actorDigest = 'd'.repeat(64);
const nowSql = new Date().toISOString().slice(0, 19).replace('T', ' ');
const insertSecurity = database.prepare(`INSERT INTO contact_security_events(
  event_id, actor_digest, event_type, channel, purpose, response_status, created_at
) VALUES(?, ?, 'challenge-rejected', 'email', 'register', 400, ?)`);
for (let index = 0; index < 30; index += 1) {
  insertSecurity.run(`alert-burst-${String(index).padStart(2, '0')}`, actorDigest, nowSql);
}

const webhookSecret = 'buyer-owned-admin-alert-secret-at-least-thirty-two-characters';
const webhookUrl = 'https://alerts.example.test/hooks/sql-academy?route=opaque';
const kv = new TestKV();
const env = {
  DB: new TestD1(database),
  SETTINGS: kv,
  AI: {},
  FEATURE_ADMIN_CONSOLE: 'on',
  ADMIN_ALLOWED_USER_IDS: 'user-alert-0001',
  FEATURE_ADMIN_ALERTS: 'on',
  ADMIN_ALERT_CRON: '17 * * * *',
  ADMIN_ALERT_COOLDOWN_MINUTES: '60',
  ADMIN_ALERT_WEBHOOK_URL: webhookUrl,
  ADMIN_ALERT_WEBHOOK_SECRET: webhookSecret
} as unknown as Cloudflare.Env;
assert.equal(adminAlertRoutingReady(env), true);
assert.deepEqual(adminAlertConfigurationErrors(env), []);

const deliveries: Array<{ url: string; init: RequestInit; body: string }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const body = String(init?.body || '');
  deliveries.push({ url: String(input), init: init || {}, body });
  return new Response(null, { status: 204 });
}) as typeof fetch;

function verifyLatestDelivery() {
  const delivery = deliveries.at(-1);
  assert.ok(delivery);
  assert.equal(delivery.url, webhookUrl);
  assert.equal(delivery.init.method, 'POST');
  assert.equal(delivery.init.redirect, 'error');
  const headers = new Headers(delivery.init.headers);
  assert.equal(headers.get('x-sql-academy-alert-contract'), 'admin-alert-event-v1');
  const timestamp = headers.get('x-sql-academy-alert-timestamp');
  const signature = headers.get('x-sql-academy-alert-signature');
  assert.ok(timestamp && signature);
  const expected = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${delivery.body}`)
    .digest('hex');
  assert.equal(signature, `sha256=${expected}`);
  assert.equal(headers.get('x-sql-academy-alert-id'), JSON.parse(delivery.body).eventId);
  return JSON.parse(delivery.body) as {
    status: string;
    severity: string;
    source: string;
    alerts: Array<{ code: string; severity: string }>;
    metrics: unknown;
  };
}

try {
  const firstTime = new Date('2026-08-06T00:00:00.000Z');
  const firing = await evaluateAndDispatchAdminAlerts(env, { source: 'schedule', now: firstTime });
  assert.equal(firing.status, 'firing');
  assert.equal(firing.delivered, true);
  assert.equal(deliveries.length, 1);
  const firingPayload = verifyLatestDelivery();
  assert.equal(firingPayload.status, 'firing');
  assert.equal(firingPayload.source, 'schedule');
  assert.equal(firingPayload.severity, 'warning');
  assert.ok(firingPayload.alerts.some(alert => alert.code === 'CONTACT_ACTOR_BURST_HIGH'));
  assert.ok(firingPayload.metrics);
  for (const forbidden of [
    'user-alert-0001',
    'session-alert-0001',
    actorDigest,
    'alerts.example.test',
    webhookSecret
  ]) assert.ok(!deliveries[0].body.includes(forbidden), `Alert payload leaked sensitive value: ${forbidden}`);

  const suppressed = await evaluateAndDispatchAdminAlerts(env, {
    source: 'schedule',
    now: new Date(firstTime.getTime() + 5 * 60_000)
  });
  assert.equal(suppressed.status, 'suppressed');
  assert.equal(suppressed.delivered, false);
  assert.equal(deliveries.length, 1, 'Unchanged alerts must respect the configured cooldown.');

  const forced = await evaluateAndDispatchAdminAlerts(env, {
    source: 'operator',
    now: new Date(firstTime.getTime() + 10 * 60_000),
    force: true
  });
  assert.equal(forced.status, 'firing');
  assert.equal(deliveries.length, 2, 'Explicit operator dispatch must bypass cooldown.');

  database.exec('DELETE FROM contact_security_events');
  const resolved = await evaluateAndDispatchAdminAlerts(env, {
    source: 'schedule',
    now: new Date(firstTime.getTime() + 15 * 60_000)
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(deliveries.length, 3);
  const resolvedPayload = verifyLatestDelivery();
  assert.equal(resolvedPayload.status, 'resolved');
  assert.equal(resolvedPayload.severity, 'info');
  assert.ok(resolvedPayload.alerts.some(alert => alert.code === 'CONTACT_ACTOR_BURST_HIGH'));

  const clear = await evaluateAndDispatchAdminAlerts(env, {
    source: 'schedule',
    now: new Date(firstTime.getTime() + 20 * 60_000)
  });
  assert.equal(clear.status, 'no-alerts');
  assert.equal(deliveries.length, 3, 'A resolved state must be delivered only once.');

  const mismatch = await handleScheduledAdminAlerts({
    cron: '23 * * * *',
    scheduledTime: firstTime.getTime(),
    type: 'scheduled',
    noRetry() {}
  } as ScheduledController, env);
  assert.equal(mismatch.status, 'ignored-schedule');
  assert.equal(deliveries.length, 3);

  for (let index = 0; index < 30; index += 1) {
    insertSecurity.run(`scheduled-burst-${String(index).padStart(2, '0')}`, actorDigest, nowSql);
  }
  const scheduled = await handleScheduledAdminAlerts({
    cron: '17 * * * *',
    scheduledTime: new Date(firstTime.getTime() + 70 * 60_000).getTime(),
    type: 'scheduled',
    noRetry() {}
  } as ScheduledController, env);
  assert.equal(scheduled.status, 'firing');
  assert.equal(deliveries.length, 4);

  const statusResponse = await handleAdminAlertRequest(
    new Request('https://academy.example.test/api/admin/alerts'),
    env,
    'user-alert-0001'
  );
  assert.ok(statusResponse);
  assert.equal(statusResponse.status, 200);
  const statusText = await statusResponse.text();
  const status = JSON.parse(statusText) as {
    contract: string;
    ready: boolean;
    schedule: string;
    lastDelivery: { activeCodes: string[]; lastDeliveredAt: string } | null;
  };
  assert.equal(status.contract, 'admin-alert-routing-v1');
  assert.equal(status.ready, true);
  assert.equal(status.schedule, '17 * * * *');
  assert.ok(status.lastDelivery?.activeCodes.includes('CONTACT_ACTOR_BURST_HIGH'));
  assert.ok(!statusText.includes(webhookUrl));
  assert.ok(!statusText.includes(webhookSecret));

  const missingConfirmation = await handleAdminAlertRequest(
    new Request('https://academy.example.test/api/admin/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'test' })
    }),
    env,
    'user-alert-0001'
  );
  assert.ok(missingConfirmation);
  assert.equal(missingConfirmation.status, 409);

  const testResponse = await handleAdminAlertRequest(
    new Request('https://academy.example.test/api/admin/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'test', confirmation: 'SEND_ADMIN_ALERT_TEST' })
    }),
    env,
    'user-alert-0001'
  );
  assert.ok(testResponse);
  assert.equal(testResponse.status, 200);
  assert.equal(deliveries.length, 5);
  const testPayload = verifyLatestDelivery();
  assert.equal(testPayload.status, 'test');
  assert.equal(testPayload.source, 'operator-test');
  assert.deepEqual(testPayload.alerts, [{ code: 'ADMIN_ALERT_TEST', severity: 'info' }]);
  assert.equal(testPayload.metrics, null);

  const hidden = handleHiddenAdminBoundary(
    new Request('https://academy.example.test/api/admin/alerts'),
    { ...env, FEATURE_ADMIN_CONSOLE: 'off' } as Cloudflare.Env
  );
  assert.equal(hidden?.status, 404);
} finally {
  globalThis.fetch = originalFetch;
  database.close();
}

const routingSource = readFileSync(new URL('../worker/admin-alert-routing.ts', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('../worker/admin-alert-config.ts', import.meta.url), 'utf8');
const healthSource = readFileSync(new URL('../worker/admin-health.ts', import.meta.url), 'utf8');
const entrypointSource = readFileSync(new URL('../worker/entrypoint.ts', import.meta.url), 'utf8');
const productionConfig = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const typegenConfig = readFileSync(new URL('../wrangler.typegen.jsonc', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/cloudflare.yml', import.meta.url), 'utf8');
const documentation = readFileSync(new URL('../docs/admin-alert-routing.md', import.meta.url), 'utf8');

for (const marker of [
  "const STATE_KEY = 'admin-alert-routing-v1:state'",
  "redirect: 'error'",
  'x-sql-academy-alert-signature',
  'ADMIN_ALERT_DELIVERY_FAILED',
  "status: 'resolved'",
  'adminAlertCooldownMinutes(env)',
  'await writeState(env',
  'clearTimeout(timeout)'
]) assert.ok(routingSource.includes(marker), `Alert routing is missing: ${marker}`);
assert.ok(routingSource.indexOf('await deliverPayload(env, payload)') < routingSource.indexOf('await writeState(env'),
  'Delivery state must advance only after a successful webhook response.');
assert.doesNotMatch(routingSource, /aggregates\.(?:users|activeSessions|progressRows)/,
  'Alert payload construction must not include account or learning aggregate counts.');
assert.ok(configSource.includes("parsed.protocol !== 'https:'"));
assert.ok(configSource.includes("secret.length >= 32"));
assert.ok(healthSource.includes("pathname === '/api/admin/alerts'"));
assert.ok(healthSource.includes("await import('./admin-alert-routing')"));
assert.ok(entrypointSource.includes('await handleScheduledAdminAlerts(controller, env)'));
assert.ok(!entrypointSource.includes('const { waitUntil }'));

for (const config of [productionConfig, typegenConfig]) {
  assert.ok(config.includes('"main": "worker/entrypoint.ts"'));
  assert.ok(config.includes('"FEATURE_ADMIN_ALERTS": "off"'));
  assert.ok(config.includes('"ADMIN_ALERT_CRON": ""'));
  assert.ok(config.includes('"crons": []'));
  assert.ok(!config.includes('ADMIN_ALERT_WEBHOOK_URL'));
  assert.ok(!config.includes('ADMIN_ALERT_WEBHOOK_SECRET'));
}
for (const marker of [
  "FEATURE_ADMIN_ALERTS: ${{ vars.FEATURE_ADMIN_ALERTS || 'off' }}",
  'ADMIN_ALERT_CRON: ${{ vars.ADMIN_ALERT_CRON }}',
  "triggers: { crons: alertCron ? [alertCron] : [] }",
  "main: 'worker/entrypoint.ts'",
  'FEATURE_ADMIN_ALERTS: process.env.FEATURE_ADMIN_ALERTS',
  'ADMIN_ALERT_COOLDOWN_MINUTES: process.env.ADMIN_ALERT_COOLDOWN_MINUTES'
]) assert.ok(workflow.includes(marker), `Production alert deployment is missing: ${marker}`);
for (const secret of ['ADMIN_ALERT_WEBHOOK_URL:', 'ADMIN_ALERT_WEBHOOK_SECRET:']) {
  assert.ok(!workflow.includes(secret), `Alert secret must not be written into deployment workflow: ${secret}`);
}
for (const marker of [
  'admin-alert-event-v1',
  'at-least-once',
  'SEND_ADMIN_ALERT_TEST',
  'DISPATCH_CURRENT_ADMIN_ALERTS',
  'wrangler secret put ADMIN_ALERT_WEBHOOK_URL',
  'triggers.crons: []'
]) assert.ok(documentation.includes(marker), `Alert runbook is missing: ${marker}`);

console.log('Buyer-owned admin alert routing validated: default-off cron, signed aggregate-only webhooks, cooldown and recovery state, protected operator tests, production wiring and no secret/PII leakage.');
