PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS learning_analytics_preferences (
  user_id TEXT PRIMARY KEY,
  sharing TEXT NOT NULL CHECK (sharing IN ('off', 'coarse-opt-in')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_analytics_snapshots (
  user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  course_version INTEGER NOT NULL CHECK (course_version BETWEEN 1 AND 100),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, period_start),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_analytics_period
  ON learning_analytics_snapshots(period_start, course_version);
