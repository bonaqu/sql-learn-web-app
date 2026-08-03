import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminHealthRequest } from '../worker/admin-health';
import {
  contactDeliveryReceiptReady,
  handleContactDeliveryReceiptRequest,
  type ContactOperationsEnvironment
} from '../worker/contact-delivery-operations';

const database = new DatabaseSync(':memory:');
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users(user_id TEXT PRIMARY KEY, updated_at TEXT);
  CREATE TABLE auth_sessions(session_id TEXT PRIMARY KEY, expires_at TEXT);
  CREATE TABLE progress(profile_id TEXT PRIMARY KEY, updated_at TEXT);
  ${readFileSync(new URL('../migrations/0018_contact_verification.sql', import.meta.url), 'utf8')}
  ${readFileSync(new URL('../migrations/0020_contact_delivery_operations.sql', import.meta.url), 'utf8')}
`);

type SqlValue = string | number | bigint | Uint8Array | null;

class StatementMock {
  constructor(private readonly sql: string, private readonly params: SqlValue[] = []) {}
  bind(...params: unknown[]) { return new StatementMock(this.sql, params as SqlValue[]); }
  async run() {
    const result = database.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: Number(result.changes), duration: 0, rows_read: 0, rows_written: Number(result.changes) } };
  }
  async first<T>() { return (database.prepare(this.sql).get(...this.params) || null) as T | null; }
  async all<T>() {
    return { success: true, results: database.prepare(this.sql).all(...this.params) as T[], meta: { changes: 0, duration: 0, rows_read: 0, rows_written: 0 } };
  }
}

const DB = {
  prepare: (sql: string) => new StatementMock(sql),
  async batch(statements: StatementMock[]) {
    const results = [];
    database.exec('BEGIN');
    try {
      for (const statement of statements) results.push(await statement.run());
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },
  async exec(sql: string) { database.exec(sql); return { count: 0, duration: 0 }; }
} as unknown as D1Database;

const receiptSecret = 'receipt-secret-with-at-least-thirty-two-characters';
const env = {
  DB,
  EMAIL_VERIFICATION_WEBHOOK_URL: 'https://provider.example.test/email',
  EMAIL_VERIFICATION_WEBHOOK_SECRET: 'provider-secret-with-sixteen-characters',
  CONTACT_DELIVERY_RECEIPT_SECRET: receiptSecret,
  FEATURE_ADMIN_CONSOLE: 'on',
  ADMIN_ALLOWED_USER_IDS: 'user_12345678'
} as unknown as ContactOperationsEnvironment & Cloudflare.Env & Record<string, string>;

assert.equal(contactDeliveryReceiptReady({ ...env, CONTACT_DELIVERY_RECEIPT_SECRET: '' }), false);
assert.equal(contactDeliveryReceiptReady(env), true, 'Receipt acceptance must work before learner feature flags are enabled.');

const challengeId = '11111111-1111-4111-8111-111111111111';
const createdAt = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ');
const expiresAt = new Date(Date.now() + 9 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
database.prepare(`INSERT INTO contact_verification_challenges(
  challenge_id, channel, purpose, destination_digest, masked_destination,
  code_verifier, provider_message_id, attempts_remaining, expires_at, created_at, updated_at
) VALUES(?, 'email', 'register', ?, 'u***@example.test', ?, 'provider-message-1', 5, ?, ?, ?)`)
  .run(challengeId, 'a'.repeat(64), 'b'.repeat(64), expiresAt, createdAt, createdAt);

const receiptBody = {
  contract: 'contact-verification-receipt-v1',
  eventId: 'provider-event-1',
  challengeId,
  channel: 'email',
  purpose: 'register',
  providerMessageId: 'provider-message-1',
  status: 'delivered',
  occurredAt: new Date().toISOString()
};
const receiptUrl = 'https://academy.example.test/api/integrations/contact-delivery-receipt';
const authorizedHeaders = { authorization: `Bearer ${receiptSecret}` };

const hidden = await handleContactDeliveryReceiptRequest(new Request(receiptUrl, {
  headers: { authorization: 'Bearer wrong-secret-value-with-enough-length' }
}), env);
assert.equal(hidden?.status, 404);

async function postReceipt(body: unknown) {
  return handleContactDeliveryReceiptRequest(new Request(receiptUrl, {
    method: 'POST',
    headers: { ...authorizedHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }), env);
}

const accepted = await postReceipt(receiptBody);
assert.equal(accepted?.status, 202);
assert.deepEqual(await accepted?.json(), { ok: true, duplicate: false });
const duplicate = await postReceipt(receiptBody);
assert.equal(duplicate?.status, 200);
assert.deepEqual(await duplicate?.json(), { ok: true, duplicate: true });
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM contact_delivery_events WHERE event_id = ?')
  .get('provider-event-1')?.count, 1);

const statusResponse = await handleContactDeliveryReceiptRequest(new Request(
  `${receiptUrl}?challengeId=${challengeId}`,
  { headers: authorizedHeaders }
), env);
assert.equal(statusResponse?.status, 200);
const statusPayload = await statusResponse?.json() as { challengeId: string; events: Array<Record<string, unknown>> };
assert.equal(statusPayload.challengeId, challengeId);
assert.deepEqual(statusPayload.events.map(event => event.status), ['delivered']);
assert.ok(statusPayload.events.every(event => !('providerMessageId' in event)
  && !('destination' in event) && !('code' in event) && !('ticket' in event)));

const mismatch = await postReceipt({ ...receiptBody, eventId: 'provider-event-2', providerMessageId: 'wrong-message' });
assert.equal(mismatch?.status, 409);
const stagingChallengeId = '22222222-2222-4222-8222-222222222222';
const unknownStaging = await postReceipt({
  ...receiptBody,
  eventId: 'provider-staging-event',
  challengeId: stagingChallengeId,
  providerMessageId: 'provider-staging-message'
});
assert.equal(unknownStaging?.status, 202, 'Signed real-provider staging receipts must work before learner rollout.');

for (let index = 0; index < 10; index += 1) {
  database.prepare(`INSERT INTO contact_delivery_events(
    event_key, event_id, challenge_id, channel, purpose, provider_message_id,
    status, reason_code, occurred_at, recorded_at
  ) VALUES(?, ?, ?, 'email', 'register', ?, 'accepted', NULL, datetime('now'), datetime('now'))`)
    .run(`email:accepted-${index}`, `accepted-${index}`, challengeId, `accepted-message-${index}`);
}
database.prepare(`INSERT INTO contact_delivery_events(
  event_key, event_id, challenge_id, channel, purpose, provider_message_id,
  status, reason_code, occurred_at, recorded_at
) VALUES('email:complaint-1', 'complaint-1', ?, 'email', 'register', 'complaint-message-1',
  'complained', 'feedback-loop', datetime('now'), datetime('now'))`).run(challengeId);
for (let index = 0; index < 3; index += 1) {
  database.prepare(`INSERT INTO contact_delivery_events(
    event_key, event_id, challenge_id, channel, purpose, provider_message_id,
    status, reason_code, occurred_at, recorded_at
  ) VALUES(?, ?, ?, 'email', 'register', NULL, 'provider-unavailable', 'timeout', datetime('now'), datetime('now'))`)
    .run(`email:failure-${index}`, `failure-${index}`, challengeId);
}
for (let index = 0; index < 20; index += 1) {
  database.prepare(`INSERT INTO contact_security_events(
    event_id, challenge_id, channel, purpose, event_type, occurred_at
  ) VALUES(?, ?, 'email', 'register', 'invalid-code', datetime('now'))`)
    .run(`security-${index}`, challengeId);
}
database.prepare("INSERT INTO users(user_id, updated_at) VALUES(?, datetime('now'))").run('user_12345678');

const adminResponse = await handleAdminHealthRequest(
  new Request('https://academy.example.test/api/admin/health'),
  env,
  'user_12345678'
);
assert.equal(adminResponse?.status, 200);
const adminPayload = await adminResponse?.json() as {
  contactOperations: {
    retentionDays: number;
    privacy: string;
    alerts: Array<{ code: string }>;
    windows: unknown[];
  };
};
assert.equal(adminPayload.contactOperations.retentionDays, 30);
assert.equal(adminPayload.contactOperations.privacy, 'aggregate-only-no-destination-code-or-ticket');
assert.equal(adminPayload.contactOperations.windows.length, 2);
assert.ok(adminPayload.contactOperations.alerts.some(alert => alert.code === 'PROVIDER_FAILURE_RATE'));
assert.ok(adminPayload.contactOperations.alerts.some(alert => alert.code === 'EMAIL_COMPLAINT_RATE'));
const serializedAdmin = JSON.stringify(adminPayload);
for (const secretValue of ['u***@example.test', 'provider-message-1', 'a'.repeat(64), 'b'.repeat(64)]) {
  assert.ok(!serializedAdmin.includes(secretValue), `Aggregate admin response leaked ${secretValue.slice(0, 16)}`);
}

const columnNames = (table: string) => database.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
for (const column of ['destination', 'destination_digest', 'masked_destination', 'code', 'code_verifier', 'ticket']) {
  assert.ok(!columnNames('contact_delivery_events').includes(column));
  assert.ok(!columnNames('contact_security_events').includes(column));
}

const workerSource = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const verificationSource = readFileSync(new URL('../worker/contact-verification.ts', import.meta.url), 'utf8');
const adminSource = readFileSync(new URL('../worker/admin-health.ts', import.meta.url), 'utf8');
const stagingScript = readFileSync(new URL('./contact-provider-staging-acceptance.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/contact-provider-staging.yml', import.meta.url), 'utf8');
const runbook = readFileSync(new URL('../docs/contact-provider-staging-and-support.md', import.meta.url), 'utf8');

assert.ok(workerSource.indexOf('handleContactDeliveryReceiptRequest(request, env)')
  < workerSource.indexOf('enforceTurnstile(request, env)'));
for (const marker of [
  "eventType: 'challenge-created'", "eventType: 'resend-cooldown'", "eventType: 'challenge-rate-limit'",
  "eventType: 'provider-failure'", "eventType: 'invalid-code'", "eventType: 'code-locked'",
  "eventType: 'confirmed'", "status: 'accepted'"
]) assert.ok(verificationSource.includes(marker), `Verification lifecycle is missing ${marker}`);
for (const marker of [
  'PROVIDER_FAILURE_RATE', 'EMAIL_COMPLAINT_RATE', 'NEGATIVE_DELIVERY_RATE',
  'CONTACT_ABUSE_SPIKE', 'INVALID_CODE_SPIKE', 'aggregate-only-no-destination-code-or-ticket'
]) assert.ok(adminSource.includes(marker), `Admin monitoring is missing ${marker}`);
for (const marker of [
  "contract: 'contact-provider-staging-result-v1'", "terminalSuccess = new Set(['delivered'])",
  'providerMessageFingerprint', 'destinationMasked', 'rawDestinationPersisted: false',
  'verificationCodePersisted: false', "url.searchParams.set('challengeId', challengeId)"
]) assert.ok(stagingScript.includes(marker), `Staging harness is missing ${marker}`);
assert.ok(!stagingScript.includes('console.log(code)'));
assert.ok(!stagingScript.includes('console.log(destination)'));
for (const marker of [
  'workflow_dispatch:', 'environment: contact-provider-staging', 'CONTACT_STAGING_EMAIL_PROVIDER_URL',
  'CONTACT_STAGING_SMS_PROVIDER_URL', 'CONTACT_STAGING_RECEIPT_SECRET',
  'node --check scripts/contact-provider-staging-acceptance.mjs', 'Upload scrubbed acceptance evidence'
]) assert.ok(workflow.includes(marker), `Staging workflow is missing ${marker}`);
assert.ok(!workflow.includes('schedule:'));
assert.ok(!workflow.includes('push:'));
assert.ok(!workflow.includes('* 1000'));
for (const marker of [
  'Never ask a learner to send a password, verification code, signed contact ticket or recovery code.',
  'HTTP 2xx without a later `delivered` receipt is **not acceptance**.',
  'Do not manually mark a contact verified.', 'PROVIDER_FAILURE_RATE', 'EMAIL_COMPLAINT_RATE',
  'Normal retention is 30 days.'
]) assert.ok(runbook.includes(marker), `Support runbook is missing ${marker}`);

console.log('Contact provider operations validated: signed idempotent receipts, pre-flag real-provider acceptance, aggregate deliverability/abuse alerts, 30-day privacy retention and fail-closed support procedures.');
