const templates: Record<string, string> = {
  'incident-base.sql': `SELECT
  t.ticket_id,
  t.service,
  t.status,
  -- TODO: engineer_name,
  -- TODO: sla_state
FROM tickets t
-- TODO: join engineers without multiplying rows
ORDER BY t.ticket_id;`,
  'incident-metrics.sql': `SELECT
  service,
  -- TODO: backlog_count,
  -- TODO: closed_count,
  -- TODO: breach_count,
  -- TODO: breach_rate
FROM tickets
GROUP BY service
-- TODO: deterministic risk order;`,
  'incident-ranking.sql': `WITH metrics AS (
  SELECT service
  -- TODO: breach_count and backlog_count
  FROM tickets
  GROUP BY service
)
SELECT
  service
  -- TODO: counts and risk_rank
FROM metrics
-- TODO: stable final ordering;`,
  'trust-profile.sql': `WITH normalized AS (
  SELECT customer_id, lower(trim(email)) AS normalized_email
  FROM customers
)
-- TODO: return issue_type, issue_key, affected_rows
SELECT 'todo' AS issue_type, 'todo' AS issue_key, 0 AS affected_rows
WHERE 0;`,
  'trust-normalize.sql': `WITH normalized AS (
  SELECT customer_id, lower(trim(email)) AS normalized_email
  FROM customers
)
SELECT
  customer_id,
  normalized_email,
  -- TODO: is_email_missing,
  -- TODO: duplicate_group_size
  0 AS is_email_missing,
  0 AS duplicate_group_size
FROM normalized
ORDER BY customer_id;`,
  'trust-schema.sql': `DROP VIEW IF EXISTS customer_contact_quality;
CREATE VIEW customer_contact_quality AS
SELECT
  customer_id,
  lower(trim(email)) AS normalized_email,
  -- TODO: missing / duplicate / ok
  'todo' AS email_quality
FROM customers;`,
  'mart-pipeline.sql': `SELECT
  service,
  COUNT(*) AS tickets_count
  -- TODO: closed_count, breach_count, avg_resolution_minutes
FROM tickets
GROUP BY service
-- TODO: deterministic operating-risk order;`,
  'mart-trend.sql': `WITH daily AS (
  SELECT
    date(created_at) AS day,
    service
    -- TODO: breach_count
  FROM tickets
  GROUP BY date(created_at), service
)
SELECT
  day,
  service
  -- TODO: breach_count and risk_rank
FROM daily
-- TODO: stable day/rank/service order;`,
  'mart-plan.sql': `EXPLAIN QUERY PLAN
SELECT ticket_id, service, status
FROM tickets
WHERE service = 'VPN'
-- TODO: add the operational status filter
ORDER BY ticket_id;`
};

export function capstoneWorkspaceTemplate(fileId: string, fallback = '') {
  return templates[fileId] ?? fallback;
}

export const capstoneWorkspaceTemplates = { ...templates };
