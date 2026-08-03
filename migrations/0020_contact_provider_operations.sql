PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contact_delivery_events (
  event_id TEXT PRIMARY KEY CHECK(length(event_id) BETWEEN 8 AND 160),
  challenge_id TEXT NOT NULL CHECK(length(challenge_id) BETWEEN 8 AND 80),
  channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
  provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 80),
  provider_message_id TEXT NOT NULL CHECK(length(provider_message_id) BETWEEN 1 AND 160),
  status TEXT NOT NULL CHECK(status IN ('accepted', 'delivered', 'deferred', 'bounced', 'complained', 'failed')),
  reason_code TEXT CHECK(reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 80),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  latency_ms INTEGER CHECK(latency_ms IS NULL OR latency_ms BETWEEN 0 AND 604800000),
  CHECK(occurred_at <= datetime(received_at, '+5 minutes'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_delivery_provider_event
  ON contact_delivery_events(channel, provider, event_id);

CREATE INDEX IF NOT EXISTS idx_contact_delivery_challenge
  ON contact_delivery_events(challenge_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_delivery_status_window
  ON contact_delivery_events(channel, status, received_at DESC);

CREATE TABLE IF NOT EXISTS contact_security_events (
  event_id TEXT PRIMARY KEY CHECK(length(event_id) BETWEEN 8 AND 80),
  event_type TEXT NOT NULL CHECK(event_type IN (
    'challenge-created',
    'challenge-rejected',
    'rate-limited',
    'provider-failed',
    'confirmation-invalid',
    'confirmation-locked',
    'contact-confirmed'
  )),
  channel TEXT CHECK(channel IS NULL OR channel IN ('email', 'sms')),
  purpose TEXT CHECK(purpose IS NULL OR purpose IN ('register', 'password-reset', 'sensitive-action')),
  actor_digest TEXT NOT NULL CHECK(length(actor_digest) = 64),
  response_status INTEGER NOT NULL CHECK(response_status BETWEEN 100 AND 599),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_security_window
  ON contact_security_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_security_actor_window
  ON contact_security_events(actor_digest, created_at DESC);
