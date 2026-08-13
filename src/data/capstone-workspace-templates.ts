const templates: Record<string, string> = {
  'incident-base.sql': `SELECT
  t.ticket_id,
  t.service,
  t.status,
  -- TODO: engineer_name,
  -- TODO: sla_state,
  -- TODO: history_events and last_event_at without row multiplication,
  -- TODO: NULL/duplicate-aware contact_state
FROM tickets t
-- TODO: join engineers and normalized contacts without multiplying rows
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
ORDER BY ticket_id;`,
  'analytics-cohort.sql': `WITH first_touch AS (
  -- TODO: one first interaction per customer
  SELECT customer_id, MIN(created_at) AS first_created_at
  FROM tickets
  GROUP BY customer_id
)
-- TODO: cohort_week, customers_count, activated_count, activation_rate
SELECT 'todo' AS cohort_week, 0 AS customers_count, 0 AS activated_count, 0 AS activation_rate
WHERE 0;`,
  'analytics-funnel.sql': `WITH flags AS (
  -- TODO: collapse events to one row per ticket before aggregation
  SELECT t.ticket_id, strftime('%Y-W%W', t.created_at) AS cohort_week
  FROM tickets t
)
-- TODO: created_count, assigned_count, closed_count
SELECT cohort_week, 0 AS created_count, 0 AS assigned_count, 0 AS closed_count
FROM flags
GROUP BY cohort_week;`,
  'analytics-trend.sql': `WITH cohorts AS (
  -- TODO: aggregate completion_rate by cohort_week
  SELECT strftime('%Y-W%W', created_at) AS cohort_week, COUNT(*) AS tickets_count
  FROM tickets
  GROUP BY strftime('%Y-W%W', created_at)
)
-- TODO: completion_rate, LAG(previous_rate), rate_delta
SELECT cohort_week, tickets_count, 0 AS completion_rate, NULL AS previous_rate, NULL AS rate_delta
FROM cohorts;`,
  'backend-mutation.sql': `BEGIN;
-- TODO: create a non-destructive audit table
-- TODO: insert every target's previous status before mutation
-- TODO: bounded UPDATE with an explicit WHERE status predicate
COMMIT;`,
  'backend-schema.sql': `DROP VIEW IF EXISTS ticket_state_invariants;
CREATE VIEW ticket_state_invariants AS
SELECT
  ticket_id,
  status,
  -- TODO: classify impossible status/closed_at combinations
  'todo' AS invariant_state
FROM tickets;`,
  'backend-plan.sql': `EXPLAIN QUERY PLAN
SELECT ticket_id, service, status
FROM tickets
WHERE service = 'Access'
-- TODO: add the bounded status predicate
ORDER BY ticket_id;`
};

export function capstoneWorkspaceTemplate(fileId: string, fallback = '') {
  return templates[fileId] ?? fallback;
}

export const capstoneWorkspaceTemplates = { ...templates };
