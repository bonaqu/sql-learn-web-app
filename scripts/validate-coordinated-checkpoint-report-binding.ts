import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0022_checkpoint_attempt_reservations.sql', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/coordinated-checkpoint-reports.ts', import.meta.url), 'utf8');

const database = new DatabaseSync(':memory:');
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users(user_id TEXT PRIMARY KEY);
  CREATE TABLE checkpoint_reports(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    checkpoint_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    attempt_number INTEGER NOT NULL,
    score INTEGER NOT NULL,
    best_score INTEGER NOT NULL,
    passed INTEGER NOT NULL,
    payload TEXT NOT NULL,
    payload_digest TEXT,
    persisted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ${migration}
`);

type BindingInput = {
  reservationId: string;
  reportId: string;
  userId: string;
  checkpointId: string;
  attemptNumber: number;
  status: 'completed' | 'expired' | 'abandoned';
  startedAt: string;
  completedAt: string;
  score: number;
  digest: string;
  payload: string;
  receiptTime: string;
};

const reportInsertSql = `INSERT OR IGNORE INTO checkpoint_reports(
  id, user_id, checkpoint_id, status, started_at, completed_at, duration_seconds,
  attempt_number, score, best_score, passed, payload, payload_digest, persisted_at
)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
FROM checkpoint_attempt_reservations
WHERE reservation_id = ? AND user_id = ? AND checkpoint_id = ?
  AND report_id = ? AND attempt_number = ? AND status IN ('active', 'expired')
  AND completed_report_id IS NULL
  AND (? <> 'completed' OR expires_at >= ?)
  AND (? <> 'expired' OR deadline_at <= ?)`;

const reservationUpdateSql = `UPDATE checkpoint_attempt_reservations
SET status = ?, completed_report_id = ?, updated_at = ?
WHERE reservation_id = ? AND user_id = ? AND checkpoint_id = ?
  AND report_id = ? AND attempt_number = ? AND status IN ('active', 'expired')
  AND completed_report_id IS NULL
  AND EXISTS (
    SELECT 1 FROM checkpoint_reports
    WHERE id = ? AND user_id = ? AND checkpoint_id = ?
      AND attempt_number = ? AND payload_digest = ?
  )`;

const completionReceiptSql = `INSERT INTO checkpoint_attempt_completion_receipts(
  reservation_id, report_id, completed_at
) VALUES(
  (SELECT reservation_id FROM checkpoint_attempt_reservations
    WHERE reservation_id = ? AND user_id = ? AND checkpoint_id = ?
      AND report_id = ? AND attempt_number = ? AND status = ?
      AND completed_report_id = ?),
  ?, ?
) ON CONFLICT(reservation_id) DO NOTHING`;

function bindReport(input: BindingInput) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const insert = database.prepare(reportInsertSql).run(
      input.reportId,
      input.userId,
      input.checkpointId,
      input.status,
      input.startedAt,
      input.completedAt,
      Math.max(1, Math.round((Date.parse(input.completedAt) - Date.parse(input.startedAt)) / 1000)),
      input.attemptNumber,
      input.score,
      input.score,
      input.status === 'completed' && input.score >= 70 ? 1 : 0,
      input.payload,
      input.digest,
      input.receiptTime,
      input.reservationId,
      input.userId,
      input.checkpointId,
      input.reportId,
      input.attemptNumber,
      input.status,
      input.completedAt,
      input.status,
      input.completedAt
    );
    const update = database.prepare(reservationUpdateSql).run(
      input.status,
      input.reportId,
      input.receiptTime,
      input.reservationId,
      input.userId,
      input.checkpointId,
      input.reportId,
      input.attemptNumber,
      input.reportId,
      input.userId,
      input.checkpointId,
      input.attemptNumber,
      input.digest
    );
    const receipt = database.prepare(completionReceiptSql).run(
      input.reservationId,
      input.userId,
      input.checkpointId,
      input.reportId,
      input.attemptNumber,
      input.status,
      input.reportId,
      input.reportId,
      input.receiptTime
    );
    database.exec('COMMIT');
    return {
      inserted: Number(insert.changes),
      updated: Number(update.changes),
      receipt: Number(receipt.changes)
    };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function plainRow(value: unknown) {
  return value && typeof value === 'object' ? { ...value } : value;
}

function reserve(input: {
  reservationId: string;
  reportId: string;
  userId: string;
  attemptNumber: number;
  status?: BindingInput['status'] | 'active';
  deadlineAt?: string;
  expiresAt?: string;
}) {
  const reservationStatus = input.status === 'expired' ? 'expired' : 'active';
  database.prepare(`INSERT INTO checkpoint_attempt_reservations(
    reservation_id, report_id, user_id, checkpoint_id, client_request_id,
    attempt_number, status, started_at, deadline_at, expires_at,
    session_id, device_name
  ) VALUES(?, ?, ?, 'checkpoint-foundation', ?, ?, ?, ?, ?, ?, ?, 'Browser')`)
    .run(
      input.reservationId,
      input.reportId,
      input.userId,
      `30000000-0000-4000-8000-${String(input.attemptNumber).padStart(12, '0')}`,
      input.attemptNumber,
      reservationStatus,
      '2026-08-04T00:00:00.000Z',
      input.deadlineAt || '2026-08-04T00:30:00.000Z',
      input.expiresAt || '2026-08-04T00:35:00.000Z',
      `session-${String(input.attemptNumber).padStart(8, '0')}`
    );
}

const userId = '40000000-0000-4000-8000-000000000001';
database.prepare('INSERT INTO users(user_id) VALUES(?)').run(userId);

const first = {
  reservationId: '50000000-0000-4000-8000-000000000001',
  reportId: '60000000-0000-4000-8000-000000000001',
  userId,
  checkpointId: 'checkpoint-foundation',
  attemptNumber: 1,
  status: 'completed' as const,
  startedAt: '2026-08-04T00:00:00.000Z',
  completedAt: '2026-08-04T00:20:00.000Z',
  score: 82,
  digest: 'a'.repeat(64),
  payload: '{"report":1}',
  receiptTime: '2026-08-04T00:21:00.000Z'
};
reserve(first);
assert.deepEqual(bindReport(first), { inserted: 1, updated: 1, receipt: 1 });
assert.deepEqual(plainRow(database.prepare(`SELECT status, completed_report_id FROM checkpoint_attempt_reservations
  WHERE reservation_id = ?`).get(first.reservationId)), {
  status: 'completed',
  completed_report_id: first.reportId
});
assert.equal(database.prepare(`SELECT report_id FROM checkpoint_attempt_completion_receipts
  WHERE reservation_id = ?`).get(first.reservationId)?.report_id, first.reportId);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM checkpoint_reports').get()?.count, 1);

assert.deepEqual(bindReport(first), { inserted: 0, updated: 0, receipt: 0 },
  'Concurrent or repeated exact binding must be idempotent after the completion receipt exists.');
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM checkpoint_reports').get()?.count, 1);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM checkpoint_attempt_completion_receipts').get()?.count, 1);

const collision = {
  ...first,
  reservationId: '50000000-0000-4000-8000-000000000002',
  reportId: '60000000-0000-4000-8000-000000000002',
  attemptNumber: 2,
  digest: 'b'.repeat(64),
  payload: '{"report":2}'
};
database.prepare(`INSERT INTO checkpoint_reports(
    id, user_id, checkpoint_id, status, started_at, completed_at, duration_seconds,
    attempt_number, score, best_score, passed, payload, payload_digest, persisted_at
  )
  SELECT ?, user_id, checkpoint_id, status, started_at, completed_at, duration_seconds,
    ?, score, best_score, passed, payload, payload_digest, persisted_at
  FROM checkpoint_reports WHERE id = ?`)
  .run(collision.reportId, collision.attemptNumber, first.reportId);
reserve(collision);
assert.throws(() => bindReport(collision), /NOT NULL constraint failed.*reservation_id/,
  'A pre-existing immutable report with a different digest must make the guard fail and roll back reservation changes.');
assert.deepEqual(plainRow(database.prepare(`SELECT status, completed_report_id FROM checkpoint_attempt_reservations
  WHERE reservation_id = ?`).get(collision.reservationId)), {
  status: 'active',
  completed_report_id: null
});
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM checkpoint_attempt_completion_receipts
  WHERE reservation_id = ?`).get(collision.reservationId)?.count, 0);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM checkpoint_reports').get()?.count, 2,
  'The failed collision batch must not add or mutate report evidence.');
assert.equal(database.prepare('SELECT payload_digest FROM checkpoint_reports WHERE id = ?')
  .get(collision.reportId)?.payload_digest, first.digest,
  'The pre-existing immutable report digest must remain unchanged after rollback.');

database.prepare(`UPDATE checkpoint_attempt_reservations SET status = 'abandoned'
  WHERE reservation_id = ?`).run(collision.reservationId);

const late = {
  ...first,
  reservationId: '50000000-0000-4000-8000-000000000003',
  reportId: '60000000-0000-4000-8000-000000000003',
  attemptNumber: 3,
  completedAt: '2026-08-04T01:34:00.000Z',
  receiptTime: '2026-08-04T01:50:00.000Z',
  digest: 'c'.repeat(64),
  payload: '{"report":3}'
};
reserve({
  ...late,
  status: 'expired',
  deadlineAt: '2026-08-04T01:30:00.000Z',
  expiresAt: '2026-08-04T01:35:00.000Z'
});
assert.deepEqual(bindReport(late), { inserted: 1, updated: 1, receipt: 1 },
  'A report completed before expiresAt must bind even when network delivery occurs after the reservation row became expired.');
assert.equal(database.prepare(`SELECT status FROM checkpoint_attempt_reservations
  WHERE reservation_id = ?`).get(late.reservationId)?.status, 'completed');

const tooLate = {
  ...late,
  reservationId: '50000000-0000-4000-8000-000000000004',
  reportId: '60000000-0000-4000-8000-000000000004',
  attemptNumber: 4,
  completedAt: '2026-08-04T02:36:00.000Z',
  receiptTime: '2026-08-04T02:40:00.000Z',
  digest: 'd'.repeat(64),
  payload: '{"report":4}'
};
reserve({
  ...tooLate,
  status: 'expired',
  deadlineAt: '2026-08-04T02:30:00.000Z',
  expiresAt: '2026-08-04T02:35:00.000Z'
});
assert.throws(() => bindReport(tooLate), /NOT NULL constraint failed.*reservation_id/,
  'A completed report claiming a time after expiresAt must fail the transactional guard.');
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM checkpoint_reports WHERE id = ?`)
  .get(tooLate.reportId)?.count, 0);
assert.deepEqual(plainRow(database.prepare(`SELECT status, completed_report_id FROM checkpoint_attempt_reservations
  WHERE reservation_id = ?`).get(tooLate.reservationId)), {
  status: 'expired',
  completed_report_id: null
});

for (const marker of [
  'checkpoint_attempt_completion_receipts',
  'reservation_id TEXT PRIMARY KEY NOT NULL',
  'REFERENCES checkpoint_reports(id) ON DELETE CASCADE'
]) {
  assert.ok(migration.includes(marker), `Checkpoint completion guard migration is missing ${marker}.`);
}

for (const marker of [
  'completion_receipt_report_id',
  "status IN ('active', 'expired')",
  'Date.parse(body.completedAt) > Date.parse(reserved.expires_at)',
  'checkpoint_attempt_completion_receipts',
  'ON CONFLICT(reservation_id) DO NOTHING',
  'reserved.completion_receipt_report_id !== body.id'
]) {
  assert.ok(worker.includes(marker), `Coordinated report binding Worker is missing ${marker}.`);
}
assert.match(worker, /INSERT INTO checkpoint_attempt_completion_receipts[\s\S]*SELECT reservation_id FROM checkpoint_attempt_reservations/,
  'Completion guard receipt must be derived from the successfully updated reservation.');
assert.doesNotMatch(worker, /body\.status === 'completed'[\s\S]{0,160}new Date\(\)\.toISOString/,
  'Completion validity must depend on report.completedAt versus reservation.expiresAt, not network delivery time.');

database.close();
console.log('Coordinated checkpoint report binding validated: atomic report/reservation/receipt commit, idempotent replay, digest-collision rollback and late-delivery acceptance by actual completion time.');
