PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS checkpoint_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed', 'expired', 'abandoned')),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds >= 0 AND duration_seconds <= 86400),
  attempt_number INTEGER NOT NULL CHECK(attempt_number >= 1 AND attempt_number <= 1000),
  score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
  best_score INTEGER NOT NULL CHECK(best_score >= 0 AND best_score <= 100),
  passed INTEGER NOT NULL CHECK(passed IN (0, 1)),
  payload TEXT NOT NULL CHECK(length(payload) <= 120000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_reports_user_completed
  ON checkpoint_reports(user_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkpoint_reports_user_checkpoint_score
  ON checkpoint_reports(user_id, checkpoint_id, score DESC);
