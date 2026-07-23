CREATE TABLE IF NOT EXISTS progress (
  profile_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_progress_updated_at ON progress(updated_at);
