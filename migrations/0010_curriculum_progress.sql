CREATE TABLE IF NOT EXISTS curriculum_progress (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_curriculum_progress_updated_at
  ON curriculum_progress(updated_at);
