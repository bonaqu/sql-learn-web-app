ALTER TABLE checkpoint_reports ADD COLUMN payload_digest TEXT;
ALTER TABLE checkpoint_reports ADD COLUMN persisted_at TEXT;

UPDATE checkpoint_reports
SET persisted_at = COALESCE(persisted_at, created_at, updated_at, completed_at)
WHERE persisted_at IS NULL OR persisted_at = '';

CREATE INDEX IF NOT EXISTS idx_checkpoint_reports_canonical_history
ON checkpoint_reports(user_id, checkpoint_id, completed_at DESC, attempt_number DESC, id DESC);
