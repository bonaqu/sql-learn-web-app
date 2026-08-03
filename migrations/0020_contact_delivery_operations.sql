PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contact_delivery_events (
  event_key TEXT PRIMARY KEY CHECK(length(event_key) BETWEEN 8 AND 240),
  event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 180),
  challenge_id TEXT NOT NULL CHECK(length(challenge_id) BETWEEN 8 AND 80),
  channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
  purpose TEXT NOT NULL CHECK(purpose IN ('register', 'password-reset', 'sensitive-action')),
  provider_message_id TEXT CHECK(provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 160),
  status TEXT NOT NULL CHECK(status IN (
    'accepted', 'delivered', 'deferred', 'bounced', 'complained', 'undeliverable',
    'provider-rejected', 'provider-unavailable'
  )),
  reason_code TEXT CHECK(reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 96),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel, event_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_delivery_status_time
  ON contact_delivery_events(channel, status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_delivery_challenge
  ON contact_delivery_events(challenge_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS contact_security_events (
  event_id TEXT PRIMARY KEY CHECK(length(event_id) BETWEEN 8 AND 80),
  challenge_id TEXT CHECK(challenge_id IS NULL OR length(challenge_id) BETWEEN 8 AND 80),
  channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
  purpose TEXT NOT NULL CHECK(purpose IN ('register', 'password-reset', 'sensitive-action')),
  event_type TEXT NOT NULL CHECK(event_type IN (
    'challenge-created', 'resend-cooldown', 'challenge-rate-limit', 'provider-failure',
    'invalid-code', 'code-locked', 'confirmed', 'ticket-consumed'
  )),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_security_type_time
  ON contact_security_events(channel, event_type, occurred_at DESC);
