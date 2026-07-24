CREATE TABLE IF NOT EXISTS assessment_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('quick', 'interview', 'exam')),
  status TEXT NOT NULL CHECK(status IN ('completed', 'expired', 'abandoned')),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds >= 0),
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assessment_reports_user_completed
  ON assessment_reports(user_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_reports_user_mode
  ON assessment_reports(user_id, mode, completed_at DESC);
