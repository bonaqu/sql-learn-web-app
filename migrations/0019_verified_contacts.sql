PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS verified_contacts (
  contact_id TEXT PRIMARY KEY NOT NULL CHECK(length(contact_id) BETWEEN 8 AND 80),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
  destination_digest TEXT NOT NULL CHECK(length(destination_digest) = 64),
  masked_destination TEXT NOT NULL CHECK(length(masked_destination) BETWEEN 3 AND 160),
  verified_at TEXT NOT NULL,
  source_challenge_id TEXT NOT NULL UNIQUE CHECK(length(source_challenge_id) BETWEEN 8 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel, destination_digest),
  UNIQUE(user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_verified_contacts_user
  ON verified_contacts(user_id, channel);

CREATE TABLE IF NOT EXISTS contact_ticket_consumptions (
  challenge_id TEXT PRIMARY KEY NOT NULL CHECK(length(challenge_id) BETWEEN 8 AND 80),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
  purpose TEXT NOT NULL CHECK(purpose IN ('register', 'password-reset', 'sensitive-action')),
  destination_digest TEXT NOT NULL CHECK(length(destination_digest) = 64),
  consumed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_ticket_consumptions_user
  ON contact_ticket_consumptions(user_id, consumed_at DESC);
