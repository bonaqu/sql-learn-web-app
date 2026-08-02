PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contact_delivery_events (
  event_id TEXT PRIMARY KEY CHECK(length(event_id) BETWEEN 8 AND 200),
  provider TEXT NOT NULL CHECK(provider IN ('resend', 'twilio', 'webhook')),
  provider_message_id TEXT NOT NULL CHECK(length(provider_message_id) BETWEEN 8 AND 200),
  challenge_id TEXT,
  channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
  status TEXT NOT NULL CHECK(status IN (
    'accepted', 'queued', 'sent', 'delivered', 'delayed', 'bounced',
    'complained', 'failed', 'undelivered', 'read', 'unknown'
  )),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 80),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(challenge_id) REFERENCES contact_verification_challenges(challenge_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_delivery_message
  ON contact_delivery_events(provider, provider_message_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_delivery_challenge
  ON contact_delivery_events(challenge_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_delivery_health
  ON contact_delivery_events(channel, status, received_at DESC);

CREATE TABLE IF NOT EXISTS contact_security_events (
  event_id TEXT PRIMARY KEY CHECK(length(event_id) BETWEEN 8 AND 80),
  event_type TEXT NOT NULL CHECK(event_type IN (
    'challenge-created', 'challenge-rate-limited', 'challenge-provider-failed',
    'code-invalid', 'code-exhausted', 'contact-confirmed', 'ticket-consumed'
  )),
  challenge_id TEXT,
  channel TEXT CHECK(channel IS NULL OR channel IN ('email', 'sms')),
  purpose TEXT CHECK(purpose IS NULL OR purpose IN ('register', 'password-reset', 'sensitive-action')),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(challenge_id) REFERENCES contact_verification_challenges(challenge_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_security_health
  ON contact_security_events(event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_security_challenge
  ON contact_security_events(challenge_id, occurred_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_contact_challenge_created
AFTER INSERT ON contact_verification_challenges
BEGIN
  INSERT OR IGNORE INTO contact_security_events(
    event_id, event_type, challenge_id, channel, purpose, occurred_at
  ) VALUES(
    lower(hex(randomblob(16))), 'challenge-created', NEW.challenge_id,
    NEW.channel, NEW.purpose, NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_contact_code_invalid
AFTER UPDATE OF attempts_remaining ON contact_verification_challenges
WHEN NEW.attempts_remaining < OLD.attempts_remaining
  AND NEW.expires_at = OLD.expires_at
  AND NEW.confirmed_at IS NULL
  AND NEW.consumed_at IS NULL
BEGIN
  INSERT OR IGNORE INTO contact_security_events(
    event_id, event_type, challenge_id, channel, purpose, occurred_at
  ) VALUES(
    lower(hex(randomblob(16))), 'code-invalid', NEW.challenge_id,
    NEW.channel, NEW.purpose, NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_contact_code_exhausted
AFTER UPDATE OF attempts_remaining ON contact_verification_challenges
WHEN NEW.attempts_remaining = 0
  AND OLD.attempts_remaining > 0
  AND NEW.expires_at = OLD.expires_at
  AND NEW.confirmed_at IS NULL
  AND NEW.consumed_at IS NULL
BEGIN
  INSERT OR IGNORE INTO contact_security_events(
    event_id, event_type, challenge_id, channel, purpose, occurred_at
  ) VALUES(
    lower(hex(randomblob(16))), 'code-exhausted', NEW.challenge_id,
    NEW.channel, NEW.purpose, NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_contact_confirmed
AFTER UPDATE OF confirmed_at ON contact_verification_challenges
WHEN OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO contact_security_events(
    event_id, event_type, challenge_id, channel, purpose, occurred_at
  ) VALUES(
    lower(hex(randomblob(16))), 'contact-confirmed', NEW.challenge_id,
    NEW.channel, NEW.purpose, NEW.confirmed_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_contact_ticket_consumed
AFTER UPDATE OF consumed_at ON contact_verification_challenges
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO contact_security_events(
    event_id, event_type, challenge_id, channel, purpose, occurred_at
  ) VALUES(
    lower(hex(randomblob(16))), 'ticket-consumed', NEW.challenge_id,
    NEW.channel, NEW.purpose, NEW.consumed_at
  );
END;