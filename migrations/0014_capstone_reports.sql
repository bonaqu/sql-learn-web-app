PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS capstone_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('passed', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds >= 0 AND duration_seconds <= 86400),
  attempt_number INTEGER NOT NULL CHECK(attempt_number >= 1 AND attempt_number <= 1000),
  score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
  best_score INTEGER NOT NULL CHECK(best_score >= 0 AND best_score <= 100),
  passed INTEGER NOT NULL CHECK(passed IN (0, 1)),
  provenance TEXT NOT NULL CHECK(provenance IN ('independent', 'guided', 'solution-assisted')),
  payload TEXT NOT NULL CHECK(length(payload) <= 240000),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_capstone_reports_user_completed
  ON capstone_reports(user_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_capstone_reports_user_project_score
  ON capstone_reports(user_id, project_id, passed DESC, score DESC);
