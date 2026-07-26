PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS assessment_calibration_receipts (
  report_id TEXT PRIMARY KEY REFERENCES assessment_reports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  blueprint_version TEXT NOT NULL CHECK(length(blueprint_version) BETWEEN 8 AND 80),
  contributed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assessment_calibration_receipts_user
  ON assessment_calibration_receipts(user_id, contributed_at DESC);

CREATE TABLE IF NOT EXISTS assessment_item_aggregates (
  task_id TEXT NOT NULL,
  blueprint_version TEXT NOT NULL,
  eligible_attempts INTEGER NOT NULL DEFAULT 0 CHECK(eligible_attempts >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK(correct_count >= 0),
  first_attempt_correct INTEGER NOT NULL DEFAULT 0 CHECK(first_attempt_correct >= 0),
  duration_seconds_sum INTEGER NOT NULL DEFAULT 0 CHECK(duration_seconds_sum >= 0),
  independence_sum INTEGER NOT NULL DEFAULT 0 CHECK(independence_sum >= 0),
  low_attempts INTEGER NOT NULL DEFAULT 0 CHECK(low_attempts >= 0),
  low_correct INTEGER NOT NULL DEFAULT 0 CHECK(low_correct >= 0),
  high_attempts INTEGER NOT NULL DEFAULT 0 CHECK(high_attempts >= 0),
  high_correct INTEGER NOT NULL DEFAULT 0 CHECK(high_correct >= 0),
  technical_error_attempts INTEGER NOT NULL DEFAULT 0 CHECK(technical_error_attempts >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(task_id, blueprint_version),
  CHECK(correct_count <= eligible_attempts),
  CHECK(first_attempt_correct <= correct_count),
  CHECK(low_correct <= low_attempts),
  CHECK(high_correct <= high_attempts)
);

CREATE INDEX IF NOT EXISTS idx_assessment_item_aggregates_version_evidence
  ON assessment_item_aggregates(blueprint_version, eligible_attempts DESC, task_id);
