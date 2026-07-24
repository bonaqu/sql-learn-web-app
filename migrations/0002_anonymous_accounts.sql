ALTER TABLE progress ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS sync_accounts (
  account_id TEXT PRIMARY KEY,
  master_verifier TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_devices (
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  token_verifier TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, device_id),
  FOREIGN KEY (account_id) REFERENCES sync_accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_devices_account_seen
  ON sync_devices(account_id, last_seen_at DESC);
