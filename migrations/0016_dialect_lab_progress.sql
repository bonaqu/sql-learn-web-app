PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS dialect_lab_progress (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  payload TEXT NOT NULL CHECK(length(payload) <= 96000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dialect_lab_progress_updated
  ON dialect_lab_progress(updated_at DESC);
