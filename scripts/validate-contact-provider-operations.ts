import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminHealthRequest } from '../worker/admin-health';
import { handleContactDeliveryEventRequest } from '../worker/contact-delivery-events';
import { recordContactSecurityOutcome } from '../worker/contact-security-events';

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

  async batch(statements: TestStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

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

database.prepare('INSERT INTO users(user_id, updated_at) VALUES(?, ?)').run('user-provider-0001', '2026-08-03 12:00:00');
database.prepare('INSERT INTO auth_sessions(session_id, expires_at) VALUES(?, ?)').run('session-provider-1', '2099-08-03 12:00:00');
database.prepare('INSERT INTO progress(profile_id, updated_at) VALUES(?, ?)').run('user-provider-0001', '2026-08-03 12:00:00');

const challengeId = '00000000-0000-4000-8000-000000000020';
const createdAt = new Date(Date.now() - 2_000).toISOString().slice(0, 19).replace('T', ' ');
database.prepare(`INSERT INTO contact_verification_challenges(
  challenge_id, channel, purpose, destination_digest, masked_destination,
  code_verifier, provider_message_id, attempts_remaining, expires_at, created_at, updated_at
) VALUES(?, 'email', 'register', ?, 'l***@example.com', ?, ?, 5, ?, ?, ?)`)
  .run(
    challengeId,
    'a'.repeat(64),
    'b'.repeat(64),
    'provider-message-20',
    new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 19).replace('T', ' '),
    createdAt,
    createdAt
  );

const eventSecret = 'delivery-event-secret-at-least-thirty-two-characters';
const env = {
  DB: new TestD1(database),
  SETTINGS: {},
  AI: {},
  FEATURE_EMAIL_VERIFICATION: 'on',
  FEATURE_SMS_VERIFICATION: 'off',
  FEATURE_ADMIN_CONSOLE: 'on',
  ADMIN_ALLOWED_USER_IDS: 'user-provider-0001',
  CONTACT_VERIFICATION_SIGNING_SECRET: 'contact-signing-secret-at-least-thirty-two-characters',
  EMAIL_VERIFICATION_WEBHOOK_URL: 'https://verification.example.test/deliver',
  EMAIL_VERIFICATION_WEBHOOK_SECRET: 'outbound-provider-secret',
  EMAIL_VERIFICATION_EVENT_SECRET: eventSecret
} as unknown as Cloudflare.Env;

function signedEvent(overrides: Record<string, unknown> = {}) {
  const event = {
    contract: 'contact-verification-delivery-event-v1',
    eventId: 'provider-event-00000020',
    challengeId,
    channel: 'email',
    provider: 'staging-provider',
    providerMessageId: 'provider-message-20',
    status: 'delivered',
    occurredAt: new Date().toISOString(),
    ...overrides
  };
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac('sha256', eventSecret).update(`${timestamp}.${body}`).digest('hex');
  return new Request('https://academy.example.test/api/provider/contact-delivery/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-verification-event-id': String(event.eventId),
      'x-verification-event-timestamp': timestamp,
      'x-verification-signature': `sha256=${signature}`
    },
    body
  });
}

const accepted = await handleContactDeliveryEventRequest(signedEvent(), env);
assert.ok(accepted);
assert.equal(accepted.status, 200);
assert.equal((await accepted.json() as { duplicate: boolean }).duplicate, false);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM contact_delivery_events').get()?.count, 1);

const duplicate = await handleContactDeliveryEventRequest(signedEvent(), env);
assert.ok(duplicate);
assert.equal(duplicate.status, 200);
assert.equal((await duplicate.json() as { duplicate: boolean }).duplicate, true);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM contact_delivery_events').get()?.count, 1,
  'Provider retries must not duplicate delivery evidence.');

const tamperedRequest = signedEvent();
const tamperedBody = await tamperedRequest.text();
const rejectedTamper = await handleContactDeliveryEventRequest(new Request(tamperedRequest.url, {
  method: 'POST',
  headers: tamperedRequest.headers,
  body: tamperedBody.replace('delivered', 'bounced')
}), env);
assert.ok(rejectedTamper);
assert.equal(rejectedTamper.status, 401, 'A modified event must fail HMAC verification.');

const wrongMessage = await handleContactDeliveryEventRequest(signedEvent({
  eventId: 'provider-event-00000021',
  providerMessageId: 'different-provider-message'
}), env);
assert.ok(wrongMessage);
assert.equal(wrongMessage.status, 404, 'Delivery evidence must match the persisted provider message ID.');

await recordContactSecurityOutcome(new Request('https://academy.example.test/api/auth/contact/challenge', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.10',
    'user-agent': 'Provider operations validator'
  },
  body: JSON.stringify({ channel: 'email', purpose: 'register', destination: 'learner@example.com' })
}), new Response('{}', { status: 429 }), env);

const securityRow = database.prepare(`SELECT event_type, actor_digest, channel, purpose
  FROM contact_security_events`).get() as Record<string, unknown>;
assert.equal(securityRow.event_type, 'rate-limited');
assert.equal(String(securityRow.actor_digest).length, 64);
assert.equal(securityRow.channel, 'email');
assert.equal(securityRow.purpose, 'register');

const adminResponse = await handleAdminHealthRequest(
  new Request('https://academy.example.test/api/admin/health'),
  env,
  'user-provider-0001'
);
assert.ok(adminResponse);
assert.equal(adminResponse.status, 200);
const adminText = await adminResponse.text();
const admin = JSON.parse(adminText) as {
  contactOperations: {
    delivery: { sent: number; delivered: number };
    security: { rateLimited: number };
    alerts: string[];
  };
};
assert.equal(admin.contactOperations.delivery.sent, 1);
assert.equal(admin.contactOperations.delivery.delivered, 1);
assert.equal(admin.contactOperations.security.rateLimited, 1);
for (const forbidden of [challengeId, 'provider-message-20', String(securityRow.actor_digest), 'learner@example.com']) {
  assert.ok(!adminText.includes(forbidden), `Admin health leaked operational identifier: ${forbidden}`);
}

for (const forbiddenColumn of ['destination TEXT', 'code TEXT', 'ip_address', 'user_agent']) {
  assert.ok(!migration20.includes(forbiddenColumn), `Operational schema stores forbidden data: ${forbiddenColumn}`);
}
for (const marker of [
  'CREATE TABLE IF NOT EXISTS contact_delivery_events',
  'CREATE TABLE IF NOT EXISTS contact_security_events',
  "status IN ('accepted', 'delivered', 'deferred', 'bounced', 'complained', 'failed')",
  'actor_digest TEXT NOT NULL CHECK(length(actor_digest) = 64)'
]) assert.ok(migration20.includes(marker), `Operational migration is missing: ${marker}`);

const routeSource = readFileSync(new URL('../worker/contact-delivery-events.ts', import.meta.url), 'utf8');
for (const marker of [
  'x-verification-event-timestamp',
  'x-verification-signature',
  'crypto.subtle.verify',
  'INSERT OR IGNORE INTO contact_delivery_events',
  'provider_message_id !== body.providerMessageId',
  'EVENT_TOLERANCE_MS'
]) assert.ok(routeSource.includes(marker), `Delivery event route is missing: ${marker}`);
assert.doesNotMatch(routeSource, /console\.(?:log|error)\([^\n]*(?:providerMessageId|challengeId|destination|code)/,
  'Delivery identifiers and contact secrets must not be logged.');

const securitySource = readFileSync(new URL('../worker/contact-security-events.ts', import.meta.url), 'utf8');
assert.match(securitySource, /contact-actor\/v1/);
assert.match(securitySource, /dateBucket/);
assert.doesNotMatch(securitySource, /INSERT INTO contact_security_events[^]*destination/i,
  'Security telemetry must not persist a destination.');

const indexSource = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
assert.ok(indexSource.indexOf('handleContactDeliveryEventRequest(request, env)') < indexSource.indexOf('enforceTurnstile(request, env)'),
  'Server-to-server provider events must be routed before browser Turnstile enforcement.');
assert.match(indexSource, /recordContactSecurityOutcome/);

const adminSource = readFileSync(new URL('../worker/admin-health.ts', import.meta.url), 'utf8');
for (const marker of [
  'CONTACT_DELIVERY_RATE_LOW',
  'CONTACT_BOUNCE_RATE_HIGH',
  'CONTACT_COMPLAINT_RATE_HIGH',
  'CONTACT_PROVIDER_FAILURES_HIGH',
  'CONTACT_ABUSE_PRESSURE_HIGH'
]) assert.ok(adminSource.includes(marker), `Admin health is missing alert: ${marker}`);

database.close();
console.log('Contact provider operations validated: signed idempotent delivery events, privacy-safe abuse telemetry, aggregate health and no PII leakage.');
