CREATE TABLE IF NOT EXISTS learner_onboarding_profiles (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS learner_onboarding_profiles_updated_idx
  ON learner_onboarding_profiles(updated_at DESC);
