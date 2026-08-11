import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../migrations/0023_checkpoint_provisional_adoptions.sql', import.meta.url),
  'utf8'
);
const worker = readFileSync(
  new URL('../worker/checkpoint-provisional-adoptions.ts', import.meta.url),
  'utf8'
);
const checkpointWorker = readFileSync(
  new URL('../worker/checkpoints.ts', import.meta.url),
  'utf8'
);
const syncSource = readFileSync(
  new URL('../src/lib/evidence-sync.ts', import.meta.url),
  'utf8'
);

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
  CREATE TABLE checkpoint_attempt_reservations(
    reservation_id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    checkpoint_id TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    session_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    completed_report_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, checkpoint_id, attempt_number)
  );
  ${migration}
`);

type AdoptionInput = {
  reportId: string;
  userId: string;
  checkpointId: string;
  provisionalAttemptNumber: number;
  status: 'completed' | 'expired' | 'abandoned';
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  score: number;
  bestScore: number;
  passed: boolean;
  payload: string;
  payloadDigest: string;
  evidenceDigest: string;
  adoptedAt: string;
};

const reportInsertSql = `INSERT OR IGNORE INTO checkpoint_reports(
  id, user_id, checkpoint_id, status, started_at, completed_at, duration_seconds,
  attempt_number, score, best_score, passed, payload, payload_digest, persisted_at
)
SELECT ?, ?, ?, ?, ?, ?, ?,
  COALESCE((
    SELECT MAX(attempt_number) FROM (
      SELECT attempt_number FROM checkpoint_reports WHERE user_id = ? AND checkpoint_id = ?
      UNION ALL
      SELECT attempt_number FROM checkpoint_attempt_reservations WHERE user_id = ? AND checkpoint_id = ?
    )
  ), 0) + 1,
  ?, ?, ?, ?, ?, ?
WHERE NOT EXISTS (
  SELECT 1 FROM checkpoint_attempt_reservations
  WHERE user_id = ? AND checkpoint_id = ? AND status = 'active'
)
AND NOT EXISTS (SELECT 1 FROM checkpoint_reports WHERE id = ?)`;

const adoptionInsertSql = `INSERT OR IGNORE INTO checkpoint_provisional_adoptions(
  report_id, user_id, checkpoint_id, provisional_attempt_number,
  canonical_attempt_number, evidence_digest, adopted_at
)
SELECT r.id, r.user_id, r.checkpoint_id, ?, r.attempt_number, ?, ?
FROM checkpoint_reports r
WHERE r.id = ? AND r.user_id = ? AND r.checkpoint_id = ?
  AND r.payload_digest = ? AND r.payload = ?
  AND NOT EXISTS (
    SELECT 1 FROM checkpoint_attempt_reservations
    WHERE user_id = ? AND checkpoint_id = ? AND status = 'active'
  )`;

const commitInsertSql = `INSERT INTO checkpoint_provisional_adoption_commits(report_id, committed_at)
VALUES((
  SELECT a.report_id
  FROM checkpoint_provisional_adoptions a
  JOIN checkpoint_reports r ON r.id = a.report_id
  WHERE a.report_id = ? AND a.user_id = ? AND a.checkpoint_id = ?
    AND a.provisional_attempt_number = ? AND a.evidence_digest = ?
    AND r.payload_digest = ? AND r.payload = ?
), ?)
ON CONFLICT(report_id) DO NOTHING`;

function adopt(input: AdoptionInput) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const inserted = database.prepare(reportInsertSql).run(
      input.reportId,
      input.userId,
      input.checkpointId,
      input.status,
      input.startedAt,
      input.completedAt,
      input.durationSeconds,
      input.userId,
      input.checkpointId,
      input.userId,
      input.checkpointId,
      input.score,
      input.bestScore,
      input.passed ? 1 : 0,
      input.payload,
      input.payloadDigest,
      input.adoptedAt,
      input.userId,
      input.checkpointId,
      input.reportId
    );
    const receipt = database.prepare(adoptionInsertSql).run(
      input.provisionalAttemptNumber,
      input.evidenceDigest,
      input.adoptedAt,
      input.reportId,
      input.userId,
      input.checkpointId,
      input.payloadDigest,
      input.payload,
      input.userId,
      input.checkpointId
    );
    const committed = database.prepare(commitInsertSql).run(
      input.reportId,
      input.userId,
      input.checkpointId,
      input.provisionalAttemptNumber,
      input.evidenceDigest,
      input.payloadDigest,
      input.payload,
      input.adoptedAt
    );
    database.exec('COMMIT');
    return {
      inserted: Number(inserted.changes),
      receipt: Number(receipt.changes),
      committed: Number(committed.changes)
    };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function plain<T extends Record<string, unknown>>(value: T | undefined) {
  return value ? { ...value } : value;
}

const userId = '20000000-0000-4000-8000-000000000001';
const checkpointId = 'checkpoint-foundation';
database.prepare('INSERT INTO users(user_id) VALUES(?)').run(userId);
database.prepare(`INSERT INTO checkpoint_reports(
  id, user_id, checkpoint_id, status, started_at, completed_at, duration_seconds,
  attempt_number, score, best_score, passed, payload, payload_digest, persisted_at
) VALUES(?, ?, ?, 'completed', ?, ?, 600, 1, 75, 75, 1, '{}', ?, ?)`)
  .run(
    '30000000-0000-4000-8000-000000000001',
    userId,
    checkpointId,
    '2026-08-04T07:00:00.000Z',
    '2026-08-04T07:10:00.000Z',
    '1'.repeat(64),
    '2026-08-04T07:10:01.000Z'
  );
database.prepare(`INSERT INTO checkpoint_attempt_reservations(
  reservation_id, report_id, user_id, checkpoint_id, client_request_id,
  attempt_number, status, started_at, deadline_at, expires_at, session_id, device_name
) VALUES(?, ?, ?, ?, ?, 2, 'completed', ?, ?, ?, ?, ?)`)
  .run(
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    userId,
    checkpointId,
    '60000000-0000-4000-8000-000000000001',
    '2026-08-04T07:20:00.000Z',
    '2026-08-04T07:50:00.000Z',
    '2026-08-04T07:55:00.000Z',
    'session-history',
    'Desktop'
  );

const firstPayload = JSON.stringify({
  id: '70000000-0000-4000-8000-000000000001',
  attemptNumber: 1,
  coordination: 'provisional',
  score: 82,
  completedAt: '2026-08-04T08:20:00.000Z'
});
const first: AdoptionInput = {
  reportId: '70000000-0000-4000-8000-000000000001',
  userId,
  checkpointId,
  provisionalAttemptNumber: 1,
  status: 'completed',
  startedAt: '2026-08-04T08:00:00.000Z',
  completedAt: '2026-08-04T08:20:00.000Z',
  durationSeconds: 1_200,
  score: 82,
  bestScore: 82,
  passed: true,
  payload: firstPayload,
  payloadDigest: 'a'.repeat(64),
  evidenceDigest: 'b'.repeat(64),
  adoptedAt: '2026-08-04T09:00:00.000Z'
};

assert.deepEqual(adopt(first), { inserted: 1, receipt: 1, committed: 1 });
assert.deepEqual(plain(database.prepare(`SELECT attempt_number, payload, completed_at
  FROM checkpoint_reports WHERE id = ?`).get(first.reportId) as Record<string, unknown>), {
  attempt_number: 3,
  payload: firstPayload,
  completed_at: first.completedAt
});
assert.deepEqual(plain(database.prepare(`SELECT provisional_attempt_number, canonical_attempt_number,
    evidence_digest, adopted_at
  FROM checkpoint_provisional_adoptions WHERE report_id = ?`).get(first.reportId) as Record<string, unknown>), {
  provisional_attempt_number: 1,
  canonical_attempt_number: 3,
  evidence_digest: first.evidenceDigest,
  adopted_at: first.adoptedAt
});
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM checkpoint_provisional_adoption_commits
  WHERE report_id = ?`).get(first.reportId)?.count, 1);

assert.deepEqual(adopt(first), { inserted: 0, receipt: 0, committed: 0 },
  'Exact replay must preserve the original report, canonical number and adoption receipt.');
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM checkpoint_reports').get()?.count, 2);

const collision: AdoptionInput = {
  ...first,
  reportId: '70000000-0000-4000-8000-000000000002',
  payload: '{"collision":"stored"}',
  payloadDigest: 'c'.repeat(64),
  evidenceDigest: 'd'.repeat(64)
};
database.prepare(`INSERT INTO checkpoint_reports(
  id, user_id, checkpoint_id, status, started_at, completed_at, duration_seconds,
  attempt_number, score, best_score, passed, payload, payload_digest, persisted_at
) VALUES(?, ?, ?, 'completed', ?, ?, 1200, 4, 20, 20, 0, ?, ?, ?)`)
  .run(
    collision.reportId,
    userId,
    checkpointId,
    collision.startedAt,
    collision.completedAt,
    '{"collision":"different"}',
    'e'.repeat(64),
    collision.adoptedAt
  );
assert.throws(() => adopt(collision), /NOT NULL constraint failed.*report_id/,
  'A same-ID payload/digest collision must fail the commit guard and roll back adoption metadata.');
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM checkpoint_provisional_adoptions
  WHERE report_id = ?`).get(collision.reportId)?.count, 0);

const activeReport: AdoptionInput = {
  ...first,
  reportId: '70000000-0000-4000-8000-000000000003',
  payload: '{"report":"blocked"}',
  payloadDigest: 'f'.repeat(64),
  evidenceDigest: '0'.repeat(64),
  adoptedAt: '2026-08-04T09:10:00.000Z'
};
database.prepare(`INSERT INTO checkpoint_attempt_reservations(
  reservation_id, report_id, user_id, checkpoint_id, client_request_id,
  attempt_number, status, started_at, deadline_at, expires_at, session_id, device_name
) VALUES(?, ?, ?, ?, ?, 5, 'active', ?, ?, ?, ?, ?)`)
  .run(
    '40000000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000005',
    userId,
    checkpointId,
    '60000000-0000-4000-8000-000000000005',
    '2026-08-04T09:00:00.000Z',
    '2026-08-04T09:30:00.000Z',
    '2026-08-04T09:35:00.000Z',
    'session-active',
    'Mobile'
  );
assert.throws(() => adopt(activeReport), /NOT NULL constraint failed.*report_id/,
  'The in-batch active-reservation guard must block adoption even after the preflight check.');
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM checkpoint_reports
  WHERE id = ?`).get(activeReport.reportId)?.count, 0);
assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM checkpoint_provisional_adoptions
  WHERE report_id = ?`).get(activeReport.reportId)?.count, 0);

database.prepare(`UPDATE checkpoint_attempt_reservations SET status = 'completed'
  WHERE reservation_id = ?`).run('40000000-0000-4000-8000-000000000005');
assert.deepEqual(adopt(activeReport), { inserted: 1, receipt: 1, committed: 1 });
assert.equal(database.prepare(`SELECT attempt_number FROM checkpoint_reports
  WHERE id = ?`).get(activeReport.reportId)?.attempt_number, 6,
  'Adoption after the active reservation completes must allocate after all prior report/reservation numbers.');
assert.equal(database.prepare(`SELECT completed_at FROM checkpoint_reports
  WHERE id = ?`).get(activeReport.reportId)?.completed_at, activeReport.completedAt,
  'Delayed reconciliation must preserve the original evidence completion timestamp.');

for (const marker of [
  'checkpoint_provisional_adoptions',
  'provisional_attempt_number',
  'canonical_attempt_number',
  'UNIQUE(user_id, checkpoint_id, canonical_attempt_number)',
  'checkpoint_provisional_adoption_commits'
]) {
  assert.ok(migration.includes(marker), `Provisional adoption migration is missing ${marker}.`);
}
for (const marker of [
  'await env.DB.batch',
  'SELECT MAX(attempt_number)',
  'checkpoint_provisional_adoption_commits',
  "code: CHECKPOINT_PROVISIONAL_ADOPTION_CODES.activeAttempt",
  'canonicalProvisionalCheckpointEvidenceJson',
  'projectAdoptedCheckpointReport'
]) {
  assert.ok(worker.includes(marker), `Provisional adoption Worker is missing ${marker}.`);
}
assert.ok(
  worker.includes("const TASK_ID_PATTERN = /^(?:task-[0-9]{3}|checkpoint-[a-z0-9-]{1,80})$/;"),
  'Provisional adoption must accept the same bounded unseen checkpoint task IDs as the canonical report endpoint.'
);
assert.match(checkpointWorker, /LEFT JOIN checkpoint_provisional_adoptions/,
  'Checkpoint GET must project adopted reports from server allocation metadata.');
assert.match(checkpointWorker, /coordination === 'provisional' \|\| coordination === 'adopted'/,
  'Legacy checkpoint upload must reject allocation-managed report types.');
assert.match(syncSource, /provisionalCheckpointReportsToAdopt/,
  'Evidence sync must split provisional reports from legacy uploads.');
assert.match(syncSource, /adoptProvisionalCheckpointReport/,
  'Evidence sync must call the typed adoption domain.');

database.close();
console.log('Provisional checkpoint adoption storage validated: D1-owned canonical numbering, immutable raw evidence, exact replay, collision rollback, active-attempt blocking and delayed reconciliation.');
