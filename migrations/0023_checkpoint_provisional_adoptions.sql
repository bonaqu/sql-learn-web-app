PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS checkpoint_provisional_adoptions (
  report_id TEXT PRIMARY KEY NOT NULL REFERENCES checkpoint_reports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL,
  provisional_attempt_number INTEGER NOT NULL CHECK(provisional_attempt_number BETWEEN 1 AND 1000),
  canonical_attempt_number INTEGER NOT NULL CHECK(canonical_attempt_number BETWEEN 1 AND 1000),
  evidence_digest TEXT NOT NULL CHECK(length(evidence_digest) = 64),
  adopted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, checkpoint_id, canonical_attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_provisional_adoptions_owner
  ON checkpoint_provisional_adoptions(user_id, checkpoint_id, adopted_at DESC);

CREATE TABLE IF NOT EXISTS checkpoint_provisional_adoption_commits (
  report_id TEXT PRIMARY KEY NOT NULL REFERENCES checkpoint_provisional_adoptions(report_id) ON DELETE CASCADE,
  committed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
