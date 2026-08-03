PRAGMA foreign_keys = ON;

CREATE TABLE contact_delivery_attempts (
  challenge_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'password-reset', 'sensitive-action')),
  destination_hash TEXT NOT NULL CHECK (length(destination_hash) = 64),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  provider TEXT NOT NULL CHECK (provider IN ('resend', 'twilio')),
  provider_message_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'reserved', 'accepted', 'sent', 'delivered', 'delayed', 'bounced',
    'complained', 'suppressed', 'failed', 'undelivered'
  )),
  error_code TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT
);

CREATE INDEX idx_contact_delivery_attempts_status_updated
  ON contact_delivery_attempts(status, updated_at);
CREATE INDEX idx_contact_delivery_attempts_destination_created
  ON contact_delivery_attempts(destination_hash, created_at);

CREATE TABLE contact_delivery_events (
  provider_event_id TEXT PRIMARY KEY,
  challenge_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('resend', 'twilio')),
  provider_message_id TEXT,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (challenge_id) REFERENCES contact_delivery_attempts(challenge_id) ON DELETE SET NULL
);

CREATE INDEX idx_contact_delivery_events_challenge
  ON contact_delivery_events(challenge_id, received_at);
CREATE INDEX idx_contact_delivery_events_message
  ON contact_delivery_events(provider, provider_message_id);

CREATE TABLE contact_delivery_abuse_buckets (
  scope TEXT NOT NULL CHECK (scope IN ('destination', 'source')),
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  window_start TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (scope, subject_hash, window_start)
);

CREATE TABLE contact_delivery_suppressions (
  destination_hash TEXT PRIMARY KEY CHECK (length(destination_hash) = 64),
  reason TEXT NOT NULL CHECK (reason IN ('hard-bounce', 'complaint', 'operator')),
  provider_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  released_at TEXT
);

CREATE INDEX idx_contact_delivery_suppressions_active
  ON contact_delivery_suppressions(released_at, created_at);
