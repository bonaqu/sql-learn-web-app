PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contact_verification_challenges (
  challenge_id TEXT PRIMARY KEY CHECK(length(challenge_id) BETWEEN 8 AND 80),
  channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
  purpose TEXT NOT NULL CHECK(purpose IN ('register', 'password-reset', 'sensitive-action')),
  destination_digest TEXT NOT NULL CHECK(length(destination_digest) = 64),
  masked_destination TEXT NOT NULL CHECK(length(masked_destination) BETWEEN 3 AND 160),
  code_verifier TEXT NOT NULL CHECK(length(code_verifier) = 64),
  provider_message_id TEXT CHECK(provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 160),
  attempts_remaining INTEGER NOT NULL DEFAULT 5 CHECK(attempts_remaining BETWEEN 0 AND 5),
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(confirmed_at IS NULL OR confirmed_at >= created_at),
  CHECK(consumed_at IS NULL OR confirmed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_contact_verification_destination
  ON contact_verification_challenges(channel, purpose, destination_digest, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_verification_expiry
  ON contact_verification_challenges(expires_at, consumed_at, confirmed_at);
