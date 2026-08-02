import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { publicAuthTurnstileAction } from '../worker/turnstile';

const migration18 = readFileSync(new URL('../migrations/0018_contact_verification.sql', import.meta.url), 'utf8');
const migration19 = readFileSync(new URL('../migrations/0019_verified_contacts.sql', import.meta.url), 'utf8');
const database = new DatabaseSync(':memory:');
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users(user_id TEXT PRIMARY KEY);
  ${migration18}
  ${migration19}
`);

const guardedConsumptionSql = `INSERT INTO contact_ticket_consumptions(
  challenge_id, user_id, channel, purpose, destination_digest, consumed_at
) VALUES(
  (SELECT challenge_id FROM contact_verification_challenges
    WHERE challenge_id = ? AND channel = ? AND purpose = ? AND destination_digest = ?
      AND provider_message_id IS NOT NULL AND confirmed_at IS NOT NULL AND consumed_at IS NULL
      AND datetime(confirmed_at, '+10 minutes') > datetime(?)),
  ?, ?, ?, ?, ?
)`;
const markConsumedSql = `UPDATE contact_verification_challenges
  SET consumed_at = ?, updated_at = ?
  WHERE challenge_id = ? AND channel = ? AND purpose = ? AND destination_digest = ?
    AND provider_message_id IS NOT NULL AND confirmed_at IS NOT NULL AND consumed_at IS NULL`;

function consume(
  challengeId: string,
  userId: string,
  channel: 'email' | 'sms',
  purpose: 'register' | 'password-reset' | 'sensitive-action',
  digest: string,
  now: string
) {
  database.prepare(guardedConsumptionSql).run(
    challengeId, channel, purpose, digest, now,
    userId, channel, purpose, digest, now
  );
  database.prepare(markConsumedSql).run(now, now, challengeId, channel, purpose, digest);
}

const now = '2026-08-02 00:20:00';
const confirmedAt = '2026-08-02 00:15:00';
const digest = 'a'.repeat(64);
database.prepare('INSERT INTO users(user_id) VALUES(?)').run('user-00000001');
database.prepare(`INSERT INTO contact_verification_challenges(
  challenge_id, channel, purpose, destination_digest, masked_destination,
  code_verifier, provider_message_id, attempts_remaining, expires_at,
  confirmed_at, created_at, updated_at
) VALUES(?, 'email', 'register', ?, 'l***@example.com', ?, 'provider-1', 5, ?, ?, ?, ?)`)
  .run('00000000-0000-4000-8000-000000000001', digest, 'b'.repeat(64), '2026-08-02 00:25:00', confirmedAt, confirmedAt, confirmedAt);

database.exec('BEGIN');
consume('00000000-0000-4000-8000-000000000001', 'user-00000001', 'email', 'register', digest, now);
database.prepare(`INSERT INTO verified_contacts(
  contact_id, user_id, channel, destination_digest, masked_destination,
  verified_at, source_challenge_id, created_at, updated_at
) VALUES(?, ?, 'email', ?, 'l***@example.com', ?, ?, ?, ?)`)
  .run('contact-00000001', 'user-00000001', digest, confirmedAt, '00000000-0000-4000-8000-000000000001', now, now);
database.exec('COMMIT');

assert.equal(database.prepare('SELECT consumed_at FROM contact_verification_challenges WHERE challenge_id = ?')
  .get('00000000-0000-4000-8000-000000000001')?.consumed_at, now);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM verified_contacts').get()?.count, 1);
assert.throws(() => consume(
  '00000000-0000-4000-8000-000000000001',
  'user-00000001',
  'email',
  'register',
  digest,
  now
), /contact_ticket_consumptions\.challenge_id/i);

const secondChallenge = '00000000-0000-4000-8000-000000000002';
database.prepare('INSERT INTO users(user_id) VALUES(?)').run('user-00000002');
database.prepare(`INSERT INTO contact_verification_challenges(
  challenge_id, channel, purpose, destination_digest, masked_destination,
  code_verifier, provider_message_id, attempts_remaining, expires_at,
  confirmed_at, created_at, updated_at
) VALUES(?, 'email', 'register', ?, 'l***@example.com', ?, 'provider-2', 5, ?, ?, ?, ?)`)
  .run(secondChallenge, digest, 'c'.repeat(64), '2026-08-02 00:25:00', confirmedAt, confirmedAt, confirmedAt);

assert.throws(() => {
  database.exec('BEGIN');
  try {
    consume(secondChallenge, 'user-00000002', 'email', 'register', digest, now);
    database.prepare(`INSERT INTO verified_contacts(
      contact_id, user_id, channel, destination_digest, masked_destination,
      verified_at, source_challenge_id, created_at, updated_at
    ) VALUES(?, ?, 'email', ?, 'l***@example.com', ?, ?, ?, ?)`)
      .run('contact-00000002', 'user-00000002', digest, confirmedAt, secondChallenge, now, now);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}, /UNIQUE/);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM contact_ticket_consumptions WHERE challenge_id = ?')
  .get(secondChallenge)?.count, 0, 'Failed contact binding must roll back the consumption receipt.');
assert.equal(database.prepare('SELECT consumed_at FROM contact_verification_challenges WHERE challenge_id = ?')
  .get(secondChallenge)?.consumed_at, null, 'Failed contact binding must leave the ticket usable until expiry.');

const expiredChallenge = '00000000-0000-4000-8000-000000000003';
database.prepare(`INSERT INTO contact_verification_challenges(
  challenge_id, channel, purpose, destination_digest, masked_destination,
  code_verifier, provider_message_id, attempts_remaining, expires_at,
  confirmed_at, created_at, updated_at
) VALUES(?, 'sms', 'password-reset', ?, '+1*****0100', ?, 'provider-3', 5, ?, ?, ?, ?)`)
  .run(expiredChallenge, 'd'.repeat(64), 'e'.repeat(64), '2026-08-02 00:00:00', '2026-08-01 23:50:00', '2026-08-01 23:50:00', '2026-08-01 23:50:00');
assert.throws(() => consume(
  expiredChallenge,
  'user-00000001',
  'sms',
  'password-reset',
  'd'.repeat(64),
  now
), /NOT NULL.*contact_ticket_consumptions\.challenge_id/i);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM contact_ticket_consumptions WHERE challenge_id = ?')
  .get(expiredChallenge)?.count, 0);

database.close();

const accountSource = readFileSync(new URL('../worker/contact-account.ts', import.meta.url), 'utf8');
for (const marker of [
  "x-contact-account-contract': 'contact-account-v1'",
  'verifyContactVerificationTicket',
  'contact_ticket_consumptions',
  'verified_contacts',
  'await env.DB.batch',
  "datetime(confirmed_at, '+10 minutes') > datetime(?)",
  'challengeConsumptionStatement',
  "prepareTicket(body?.contactTicket, 'register'",
  "prepareTicket(body?.contactTicket, 'password-reset'",
  "prepareTicket(body?.contactTicket, 'sensitive-action'",
  'DELETE FROM auth_sessions WHERE user_id = ?'
]) assert.ok(accountSource.includes(marker), `Contact account flow is missing: ${marker}`);
assert.doesNotMatch(accountSource, /Math\.random/);
assert.doesNotMatch(accountSource, /console\.(?:log|error)\([^\n]*(?:ticket|destination|password)/i,
  'Tickets, destinations and passwords must never be logged.');

for (const marker of [
  'CREATE TABLE IF NOT EXISTS verified_contacts',
  'challenge_id TEXT PRIMARY KEY NOT NULL',
  'UNIQUE(channel, destination_digest)',
  'UNIQUE(user_id, channel)'
]) assert.ok(migration19.includes(marker), `Verified-contact migration is missing: ${marker}`);
assert.doesNotMatch(migration19, /CREATE\s+TRIGGER/i,
  'Remote D1 migration must not depend on multi-statement trigger bodies.');
assert.doesNotMatch(migration19, /\bdestination\s+TEXT\b/,
  'Verified contact storage must not persist a raw email address or phone number.');

const indexSource = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
assert.match(indexSource, /handleContactAccountRequest/);
assert.ok(indexSource.indexOf('handleContactAccountRequest(request, env)') < indexSource.indexOf('handleAuthRequest(request, env)'),
  'Contact-account routes must run before the generic /api/auth fallback.');
assert.match(indexSource, /x-contact-account-contract/);

assert.equal(publicAuthTurnstileAction(new Request('https://academy.test/api/auth/contact/register', { method: 'POST' })), 'contact-register');
assert.equal(publicAuthTurnstileAction(new Request('https://academy.test/api/auth/contact/password/reset', { method: 'POST' })), 'contact-password-reset');
assert.equal(publicAuthTurnstileAction(new Request('https://academy.test/api/auth/contact/attach', { method: 'POST' })), null,
  'Authenticated attachment relies on the current password and verified contact ticket, not public Turnstile routing.');

console.log('Verified-contact account binding is triggerless for remote D1, atomic, replay-safe and privacy-preserving.');
