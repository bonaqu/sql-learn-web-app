PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS verified_contacts (
  contact_id TEXT PRIMARY KEY CHECK(length(contact_id) BETWEEN 8 AND 80),
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
  challenge_id TEXT PRIMARY KEY CHECK(length(challenge_id) BETWEEN 8 AND 80),
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
  purpose TEXT NOT NULL CHECK(purpose IN ('register', 'password-reset', 'sensitive-action')),
  destination_digest TEXT NOT NULL CHECK(length(destination_digest) = 64),
  consumed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_ticket_consumptions_user
  ON contact_ticket_consumptions(user_id, consumed_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_contact_ticket_consumption_guard
BEFORE INSERT ON contact_ticket_consumptions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM contact_verification_challenges AS challenge
    WHERE challenge.challenge_id = NEW.challenge_id
      AND challenge.channel = NEW.channel
      AND challenge.purpose = NEW.purpose
      AND challenge.destination_digest = NEW.destination_digest
      AND challenge.provider_message_id IS NOT NULL
      AND challenge.confirmed_at IS NOT NULL
      AND challenge.consumed_at IS NULL
      AND datetime(challenge.confirmed_at, '+10 minutes') > datetime(NEW.consumed_at)
  ) THEN RAISE(ABORT, 'CONTACT_TICKET_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_contact_ticket_consumption_mark_challenge
AFTER INSERT ON contact_ticket_consumptions
BEGIN
  UPDATE contact_verification_challenges
  SET consumed_at = NEW.consumed_at,
      updated_at = NEW.consumed_at
  WHERE challenge_id = NEW.challenge_id;
END;
