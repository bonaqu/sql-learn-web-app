CREATE TABLE IF NOT EXISTS mentor_ai_daily_quota (
  quota_day TEXT NOT NULL,
  quota_key TEXT NOT NULL,
  neurons_reserved INTEGER NOT NULL DEFAULT 0 CHECK (neurons_reserved >= 0),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (quota_day, quota_key)
);

