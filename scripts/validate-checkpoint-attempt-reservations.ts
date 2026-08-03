import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CHECKPOINT_ATTEMPT_GRACE_MINUTES,
  checkpointDurationMinutesFromContract,
  validCheckpointAttemptReservation,
  validCheckpointAttemptReservationResponse
} from '../src/lib/checkpoint-attempt-reservation-contract';

const migration = readFileSync(new URL('../migrations/0022_checkpoint_attempt_reservations.sql', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../worker/checkpoint-attempt-reservations.ts', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');

const database = new DatabaseSync(':memory:');
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users(user_id TEXT PRIMARY KEY);
  CREATE TABLE checkpoint_reports(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    checkpoint_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL
  );
  ${migration}
`);

type ReservationRow = {
  reservation_id: string;
  report_id: string;
  user_id: string;
  checkpoint_id: string;
  client_request_id: string;
  attempt_number: number;
  status: string;
  started_at: string;
  deadline_at: string;
  expires_at: string;
  session_id: string;
  device_name: string;
};

const reserveSql = `INSERT OR IGNORE INTO checkpoint_attempt_reservations(
  reservation_id, report_id, user_id, checkpoint_id, client_request_id,
  attempt_number, status, started_at, deadline_at, expires_at,
  session_id, device_name, created_at, updated_at
)
SELECT ?, ?, ?, ?, ?,
  COALESCE((
    SELECT MAX(attempt_number) FROM (
      SELECT attempt_number FROM checkpoint_reports WHERE user_id = ? AND checkpoint_id = ?
      UNION ALL
      SELECT attempt_number FROM checkpoint_attempt_reservations WHERE user_id = ? AND checkpoint_id = ?
    )
  ), 0) + 1,
  'active', ?, ?, ?, ?, ?, ?, ?
WHERE NOT EXISTS (
  SELECT 1 FROM checkpoint_attempt_reservations
  WHERE user_id = ? AND checkpoint_id = ? AND status = 'active'
)`;

function reserve(input: {
  reservationId: string;
  reportId: string;
  userId: string;
  checkpointId: string;
  clientRequestId: string;
  sessionId: string;
  deviceName: string;
  now: string;
  durationMinutes: number;
}) {
  const now = new Date(input.now);
  const deadlineAt = new Date(now.getTime() + input.durationMinutes * 60_000).toISOString();
  const expiresAt = new Date(
    now.getTime() + (input.durationMinutes + CHECKPOINT_ATTEMPT_GRACE_MINUTES) * 60_000
  ).toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(`UPDATE checkpoint_attempt_reservations
      SET status = 'expired', updated_at = ?
      WHERE user_id = ? AND checkpoint_id = ? AND status = 'active' AND expires_at <= ?`)
      .run(input.now, input.userId, input.checkpointId, input.now);
    const result = database.prepare(reserveSql).run(
      input.reservationId,
      input.reportId,
      input.userId,
      input.checkpointId,
      input.clientRequestId,
      input.userId,
      input.checkpointId,
      input.userId,
      input.checkpointId,
      input.now,
      deadlineAt,
      expiresAt,
      input.sessionId,
      input.deviceName,
      input.now,
      input.now,
      input.userId,
      input.checkpointId
    );
    database.exec('COMMIT');
    return Number(result.changes);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function byRequest(userId: string, checkpointId: string, clientRequestId: string) {
  return database.prepare(`SELECT * FROM checkpoint_attempt_reservations
    WHERE user_id = ? AND checkpoint_id = ? AND client_request_id = ?`)
    .get(userId, checkpointId, clientRequestId) as ReservationRow | undefined;
}

function active(userId: string, checkpointId: string) {
  return database.prepare(`SELECT * FROM checkpoint_attempt_reservations
    WHERE user_id = ? AND checkpoint_id = ? AND status = 'active'`)
    .all(userId, checkpointId) as unknown as ReservationRow[];
}

const userId = 'user-reservation-0001';
const checkpointId = 'checkpoint-foundation';
database.prepare('INSERT INTO users(user_id) VALUES(?)').run(userId);
database.prepare(`INSERT INTO checkpoint_reports(id, user_id, checkpoint_id, attempt_number)
  VALUES(?, ?, ?, 7)`).run('legacy-report-0007', userId, checkpointId);

const durationMinutes = checkpointDurationMinutesFromContract(checkpointId);
assert.equal(durationMinutes, 30);
assert.equal(CHECKPOINT_ATTEMPT_GRACE_MINUTES, 5);

const first = {
  reservationId: 'reservation-0000000000000001',
  reportId: 'report-000000000000000001',
  userId,
  checkpointId,
  clientRequestId: 'request-0000000000000001',
  sessionId: 'session-00000001',
  deviceName: 'ПК · Linux',
  now: '2026-08-04T00:00:00.000Z',
  durationMinutes: durationMinutes!
};
assert.equal(reserve(first), 1);
assert.equal(byRequest(userId, checkpointId, first.clientRequestId)?.attempt_number, 8,
  'Server numbering must continue after the greatest immutable legacy report attempt.');
assert.equal(active(userId, checkpointId).length, 1);

const competing = {
  ...first,
  reservationId: 'reservation-0000000000000002',
  reportId: 'report-000000000000000002',
  clientRequestId: 'request-0000000000000002',
  sessionId: 'session-00000002',
  deviceName: 'Телефон · Android'
};
assert.equal(reserve(competing), 0,
  'A second device must not create another active reservation.');
assert.equal(byRequest(userId, checkpointId, competing.clientRequestId), undefined);
assert.equal(active(userId, checkpointId)[0]?.reservation_id, first.reservationId);

assert.equal(reserve(first), 0,
  'The same client request ID must be idempotent.');
assert.equal(byRequest(userId, checkpointId, first.clientRequestId)?.reservation_id, first.reservationId);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM checkpoint_attempt_reservations').get()?.count, 1);

assert.throws(() => database.prepare(`INSERT INTO checkpoint_attempt_reservations(
  reservation_id, report_id, user_id, checkpoint_id, client_request_id,
  attempt_number, status, started_at, deadline_at, expires_at, session_id, device_name
) VALUES(?, ?, ?, ?, ?, 8, 'completed', ?, ?, ?, ?, ?)`)
  .run(
    'reservation-0000000000000003',
    'report-000000000000000003',
    userId,
    checkpointId,
    'request-0000000000000003',
    first.now,
    '2026-08-04T00:30:00.000Z',
    '2026-08-04T00:35:00.000Z',
    'session-00000003',
    'ПК · Windows'
  ), /UNIQUE constraint failed.*attempt_number/,
  'Attempt numbers must remain unique even outside the active partial index.');

database.prepare(`UPDATE checkpoint_attempt_reservations
  SET status = 'completed', updated_at = ?
  WHERE reservation_id = ?`).run('2026-08-04T00:20:00.000Z', first.reservationId);
const second = {
  ...competing,
  now: '2026-08-04T00:21:00.000Z'
};
assert.equal(reserve(second), 1);
assert.equal(byRequest(userId, checkpointId, second.clientRequestId)?.attempt_number, 9,
  'A reservation after completion must receive the next monotonic number.');

database.prepare(`UPDATE checkpoint_attempt_reservations
  SET expires_at = ? WHERE reservation_id = ?`)
  .run('2026-08-04T00:22:00.000Z', second.reservationId);
const third = {
  ...first,
  reservationId: 'reservation-0000000000000004',
  reportId: 'report-000000000000000004',
  clientRequestId: 'request-0000000000000004',
  sessionId: 'session-00000004',
  now: '2026-08-04T00:23:00.000Z'
};
assert.equal(reserve(third), 1,
  'A stale active reservation must expire inside the same transaction before a new allocation.');
assert.equal(byRequest(userId, checkpointId, second.clientRequestId)?.status, 'expired');
assert.equal(byRequest(userId, checkpointId, third.clientRequestId)?.attempt_number, 10,
  'Expiry must free the active slot without reusing an earlier attempt number.');
assert.equal(active(userId, checkpointId).length, 1);

const validReservation = {
  version: 1,
  reservationId: third.reservationId,
  reportId: third.reportId,
  checkpointId,
  clientRequestId: third.clientRequestId,
  attemptNumber: 10,
  status: 'active',
  startedAt: third.now,
  deadlineAt: '2026-08-04T00:53:00.000Z',
  expiresAt: '2026-08-04T00:58:00.000Z',
  deviceName: 'ПК · Linux',
  ownedByCurrentSession: true
};
assert.equal(validCheckpointAttemptReservation(validReservation), true);
assert.equal(validCheckpointAttemptReservationResponse({
  reservation: validReservation,
  created: true,
  replayed: false,
  activeElsewhere: false
}), true);
assert.equal(validCheckpointAttemptReservationResponse({
  reservation: { ...validReservation, ownedByCurrentSession: true },
  created: false,
  replayed: false,
  activeElsewhere: true
}), false,
  'An active-elsewhere response cannot claim ownership by the current session.');

for (const marker of [
  'CREATE TABLE IF NOT EXISTS checkpoint_attempt_reservations',
  'UNIQUE(user_id, checkpoint_id, client_request_id)',
  'UNIQUE(user_id, checkpoint_id, attempt_number)',
  "WHERE status = 'active'",
  'completed_report_id TEXT UNIQUE REFERENCES checkpoint_reports(id)'
]) {
  assert.ok(migration.includes(marker), `Checkpoint reservation migration is missing ${marker}.`);
}
assert.doesNotMatch(migration, /DELETE FROM checkpoint_reports|UPDATE checkpoint_reports\s+SET attempt_number/i,
  'Reservation migration must not delete or renumber immutable report history.');

for (const marker of [
  'await env.DB.batch',
  "SET status = 'expired'",
  'INSERT OR IGNORE INTO checkpoint_attempt_reservations',
  'SELECT MAX(attempt_number)',
  'UNION ALL',
  "code: 'CHECKPOINT_ATTEMPT_ACTIVE'",
  'inserted.meta.changes === 1',
  'ownedByCurrentSession'
]) {
  assert.ok(workerSource.includes(marker), `Checkpoint reservation Worker is missing ${marker}.`);
}
assert.doesNotMatch(workerSource, /Math\.max\([^\n]*attempt|attemptNumber\s*=\s*[^\n]*\+\s*1/,
  'Attempt allocation must remain inside the guarded D1 statement, not JavaScript read-modify-write.');

assert.match(indexSource, /handleCheckpointAttemptReservationRequest/,
  'Worker index must route authenticated reservation requests.');
assert.match(indexSource, /sessionId: auth\.sessionId/,
  'Reservation ownership must bind to the authenticated session.');
assert.match(indexSource, /deviceName: auth\.deviceName/,
  'Reservation notice must use the authenticated device label.');

database.close();
console.log('Checkpoint attempt reservations validated: transactional stale expiry, one active row, idempotent request identity, monotonic numbering after reports/reservations and authenticated routing.');
