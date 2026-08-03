PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS checkpoint_attempt_reservations (
  reservation_id TEXT PRIMARY KEY NOT NULL CHECK(length(reservation_id) BETWEEN 16 AND 80),
  report_id TEXT NOT NULL UNIQUE CHECK(length(report_id) BETWEEN 16 AND 80),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL CHECK(length(client_request_id) BETWEEN 16 AND 80),
  attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 1000),
  status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'expired', 'abandoned')),
  started_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  session_id TEXT NOT NULL CHECK(length(session_id) BETWEEN 8 AND 80),
  device_name TEXT NOT NULL CHECK(length(device_name) BETWEEN 1 AND 64),
  completed_report_id TEXT UNIQUE REFERENCES checkpoint_reports(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, checkpoint_id, client_request_id),
  UNIQUE(user_id, checkpoint_id, attempt_number),
  CHECK(completed_report_id IS NULL OR completed_report_id = report_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoint_attempt_one_active
  ON checkpoint_attempt_reservations(user_id, checkpoint_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_checkpoint_attempt_user_status
  ON checkpoint_attempt_reservations(user_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkpoint_attempt_request
  ON checkpoint_attempt_reservations(user_id, checkpoint_id, client_request_id);
