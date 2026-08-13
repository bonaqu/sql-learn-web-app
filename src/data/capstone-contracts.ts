import type { CapstoneProject } from './complete-curriculum';

export type CapstoneFileKind = 'query' | 'schema' | 'mutation' | 'plan';
export type CapstoneCheckKind = 'result-contract' | 'hidden-data' | 'schema-invariant' | 'state-invariant' | 'plan-shape' | 'reflection';

export interface CapstoneDatasetVariant {
  id: string;
  title: string;
  appendSql: string;
  hidden: boolean;
  provenance: string;
  edgeCases: string[];
}

export interface CapstoneFileContract {
  id: string;
  title: string;
  description: string;
  kind: CapstoneFileKind;
  starterSql: string;
  referenceSql?: string;
  postValidationSql?: string;
  requiredColumns?: string[];
  weight: number;
  remediation: string;
}

export interface CapstoneReflectionContract {
  title: string;
  prompt: string;
  minimumCharacters: number;
  requiredIdeas: Array<{ id: string; label: string; keywords: string[] }>;
  weight: number;
}

export interface CapstoneEvaluationContract {
  projectId: CapstoneProject['id'];
  trackId: CapstoneProject['trackId'];
  originality: string;
  engineEvidence: string;
  sqliteLimitations: string;
  passingScore: number;
  files: CapstoneFileContract[];
  datasets: CapstoneDatasetVariant[];
  reflection: CapstoneReflectionContract;
}

const commonHidden: CapstoneDatasetVariant = {
  id: 'hidden-edge-cases',
  title: 'Hidden edge cases',
  hidden: true,
  provenance: 'Synthetic SQL Academy fixture authored for this course; reserved .example contacts only.',
  edgeCases: ['normalized duplicate', 'NULL email/phone', 'new service', 'open ticket', 'breach tie'],
  appendSql: `
INSERT INTO customers(customer_id, region, segment, email, phone) VALUES
  (101,'Рязань','Education','  ADMIN@CAMPUS.EXAMPLE  ',NULL),
  (102,'Тверь','Business',NULL,NULL);
INSERT INTO tickets(ticket_id, service, status, priority, engineer_id, customer_id, resolution_minutes, sla_minutes, created_at, closed_at, subject) VALUES
  (2001,'LMS','Closed','High',2,101,240,120,'2026-07-08 09:00:00','2026-07-08 13:00:00','Hidden duplicate contact'),
  (2002,'NewService','Open','Medium',5,102,NULL,180,'2026-07-08 10:00:00',NULL,'Hidden open service'),
  (2003,'VPN','Closed','Critical',4,102,330,60,'2026-07-08 11:00:00','2026-07-08 16:30:00','Hidden breach tie');`
};

const tieVariant: CapstoneDatasetVariant = {
  id: 'hidden-order-ties',
  title: 'Hidden stable-order ties',
  hidden: true,
  provenance: 'Synthetic SQL Academy ordering fixture; no production or competitor records.',
  edgeCases: ['equal risk values', 'stable ordering', 'open backlog'],
  appendSql: `
INSERT INTO customers(customer_id, region, segment, email, phone) VALUES
  (103,'Калуга','Retail','tie@example.test',NULL);
INSERT INTO tickets(ticket_id, service, status, priority, engineer_id, customer_id, resolution_minutes, sla_minutes, created_at, closed_at, subject) VALUES
  (2004,'Email','Closed','High',3,103,190,120,'2026-07-08 12:00:00','2026-07-08 15:10:00','Hidden deterministic tie'),
  (2005,'Access','Open','Low',5,103,NULL,240,'2026-07-08 13:00:00',NULL,'Hidden backlog tie');`
};

const baseDataset: CapstoneDatasetVariant = {
  id: 'public-base',
  title: 'Public training dataset',
  appendSql: '',
  hidden: false,
  provenance: 'Public synthetic SQL Academy dataset committed with the course; all people and organizations are fictional.',
  edgeCases: ['NULL contacts', 'duplicate email', 'open tickets', 'SLA breaches', 'event history']
};

const analyticsHidden: CapstoneDatasetVariant = {
  id: 'hidden-cohort-boundaries',
  title: 'Hidden cohort and funnel boundaries',
  hidden: true,
  provenance: 'Synthetic SQL Academy cohort fixture created for week-boundary and unknown-event evaluation.',
  edgeCases: ['new calendar week', 'missing assigned event', 'unknown event type', 'open funnel entity'],
  appendSql: `
INSERT INTO customers(customer_id, region, segment, email, phone) VALUES
  (201,'Вологда','Education','cohort@example.test',NULL);
INSERT INTO tickets(ticket_id, service, status, priority, engineer_id, customer_id, resolution_minutes, sla_minutes, created_at, closed_at, subject) VALUES
  (3001,'LMS','Closed','Medium',2,201,90,180,'2026-07-13 09:00:00','2026-07-13 10:30:00','Hidden activated cohort'),
  (3002,'LMS','Open','Low',5,201,NULL,240,'2026-07-13 11:00:00',NULL,'Hidden funnel dropoff');
INSERT INTO ticket_events(event_id,ticket_id,event_type,event_at,payload) VALUES
  (101,3001,'created','2026-07-13 09:00:00','{}'),
  (102,3001,'assigned','2026-07-13 09:05:00','{}'),
  (103,3001,'closed','2026-07-13 10:30:00','{}'),
  (104,3002,'created','2026-07-13 11:00:00','{}'),
  (105,3002,'observed','2026-07-13 11:10:00','{}');`
};

const backendHidden: CapstoneDatasetVariant = {
  id: 'hidden-mutation-scope',
  title: 'Hidden mutation scope',
  hidden: true,
  provenance: 'Synthetic SQL Academy mutation fixture built to detect unbounded updates and incomplete audit state.',
  edgeCases: ['additional open row', 'already closed row', 'NULL close timestamp', 'mutation scope'],
  appendSql: `
INSERT INTO customers(customer_id, region, segment, email, phone) VALUES
  (301,'Ижевск','Business','backend@example.test',NULL);
INSERT INTO tickets(ticket_id, service, status, priority, engineer_id, customer_id, resolution_minutes, sla_minutes, created_at, closed_at, subject) VALUES
  (4001,'Access','Open','Critical',4,301,NULL,60,'2026-07-09 08:00:00',NULL,'Hidden migration target'),
  (4002,'Access','Closed','Low',4,301,20,240,'2026-07-09 09:00:00','2026-07-09 09:20:00','Hidden protected row');`
};

const incidentBaseSql = `WITH contacts AS (
  SELECT
    customer_id,
    email,
    lower(trim(email)) AS normalized_email,
    COUNT(*) OVER (PARTITION BY lower(trim(email))) AS duplicate_group_size
  FROM customers
)
SELECT
  t.ticket_id,
  t.service,
  t.status,
  e.name AS engineer_name,
  CASE
    WHEN t.status = 'Closed' AND t.resolution_minutes > t.sla_minutes THEN 'breach'
    WHEN t.status = 'Closed' THEN 'met'
    ELSE 'open'
  END AS sla_state,
  (SELECT COUNT(*) FROM ticket_events te WHERE te.ticket_id = t.ticket_id) AS history_events,
  (SELECT MAX(te.event_at) FROM ticket_events te WHERE te.ticket_id = t.ticket_id) AS last_event_at,
  CASE
    WHEN c.email IS NULL OR trim(c.email) = '' THEN 'missing'
    WHEN c.duplicate_group_size > 1 THEN 'duplicate'
    ELSE 'known'
  END AS contact_state
FROM tickets t
JOIN engineers e ON e.engineer_id = t.engineer_id
LEFT JOIN contacts c ON c.customer_id = t.customer_id
ORDER BY t.ticket_id;`;

const incidentMetricsSql = `SELECT
  service,
  SUM(CASE WHEN status <> 'Closed' THEN 1 ELSE 0 END) AS backlog_count,
  SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closed_count,
  SUM(CASE WHEN status = 'Closed' AND resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breach_count,
  ROUND(100.0 * SUM(CASE WHEN status = 'Closed' AND resolution_minutes > sla_minutes THEN 1 ELSE 0 END)
    / NULLIF(SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END), 0), 1) AS breach_rate
FROM tickets
GROUP BY service
ORDER BY breach_count DESC, backlog_count DESC, service;`;

const incidentRankingSql = `WITH metrics AS (
  SELECT
    service,
    SUM(CASE WHEN status <> 'Closed' THEN 1 ELSE 0 END) AS backlog_count,
    SUM(CASE WHEN status = 'Closed' AND resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breach_count
  FROM tickets
  GROUP BY service
)
SELECT
  service,
  breach_count,
  backlog_count,
  ROW_NUMBER() OVER (ORDER BY breach_count DESC, backlog_count DESC, service) AS risk_rank
FROM metrics
ORDER BY risk_rank, service;`;

const trustProfileSql = `WITH normalized AS (
  SELECT customer_id, lower(trim(email)) AS normalized_email
  FROM customers
), issues AS (
  SELECT 'missing_email' AS issue_type, '<NULL>' AS issue_key, COUNT(*) AS affected_rows
  FROM normalized
  WHERE normalized_email IS NULL OR normalized_email = ''
  UNION ALL
  SELECT 'duplicate_email', normalized_email, COUNT(*)
  FROM normalized
  WHERE normalized_email IS NOT NULL AND normalized_email <> ''
  GROUP BY normalized_email
  HAVING COUNT(*) > 1
)
SELECT issue_type, issue_key, affected_rows
FROM issues
WHERE affected_rows > 0
ORDER BY issue_type, issue_key;`;

const trustNormalizeSql = `WITH normalized AS (
  SELECT customer_id, lower(trim(email)) AS normalized_email
  FROM customers
)
SELECT
  customer_id,
  normalized_email,
  CASE WHEN normalized_email IS NULL OR normalized_email = '' THEN 1 ELSE 0 END AS is_email_missing,
  CASE
    WHEN normalized_email IS NULL OR normalized_email = '' THEN 0
    ELSE COUNT(*) OVER (PARTITION BY normalized_email)
  END AS duplicate_group_size
FROM normalized
ORDER BY customer_id;`;

const trustViewValidationSql = `SELECT customer_id, normalized_email, email_quality
FROM customer_contact_quality
ORDER BY customer_id;`;

const trustViewReferenceSql = `SELECT
  customer_id,
  lower(trim(email)) AS normalized_email,
  CASE
    WHEN email IS NULL OR trim(email) = '' THEN 'missing'
    WHEN COUNT(*) OVER (PARTITION BY lower(trim(email))) > 1 THEN 'duplicate'
    ELSE 'ok'
  END AS email_quality
FROM customers
ORDER BY customer_id;`;

const martPipelineSql = `SELECT
  service,
  COUNT(*) AS tickets_count,
  SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closed_count,
  SUM(CASE WHEN status = 'Closed' AND resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breach_count,
  ROUND(AVG(CASE WHEN status = 'Closed' THEN resolution_minutes END), 1) AS avg_resolution_minutes
FROM tickets
GROUP BY service
ORDER BY breach_count DESC, tickets_count DESC, service;`;

const martTrendSql = `WITH daily AS (
  SELECT
    date(created_at) AS day,
    service,
    SUM(CASE WHEN status = 'Closed' AND resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breach_count
  FROM tickets
  GROUP BY date(created_at), service
)
SELECT
  day,
  service,
  breach_count,
  ROW_NUMBER() OVER (PARTITION BY day ORDER BY breach_count DESC, service) AS risk_rank
FROM daily
ORDER BY day, risk_rank, service;`;

const analyticsCohortSql = `WITH first_touch AS (
  SELECT customer_id, MIN(created_at) AS first_created_at
  FROM tickets
  WHERE customer_id IS NOT NULL
  GROUP BY customer_id
)
SELECT
  strftime('%Y-W%W', first_created_at) AS cohort_week,
  COUNT(*) AS customers_count,
  SUM(CASE WHEN EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.customer_id = first_touch.customer_id AND t.status = 'Closed'
  ) THEN 1 ELSE 0 END) AS activated_count,
  ROUND(100.0 * SUM(CASE WHEN EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.customer_id = first_touch.customer_id AND t.status = 'Closed'
  ) THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS activation_rate
FROM first_touch
GROUP BY strftime('%Y-W%W', first_created_at)
ORDER BY cohort_week;`;

const analyticsFunnelSql = `WITH flags AS (
  SELECT
    t.ticket_id,
    strftime('%Y-W%W', t.created_at) AS cohort_week,
    MAX(CASE WHEN e.event_type = 'created' THEN 1 ELSE 0 END) AS reached_created,
    MAX(CASE WHEN e.event_type = 'assigned' THEN 1 ELSE 0 END) AS reached_assigned,
    MAX(CASE WHEN e.event_type = 'closed' THEN 1 ELSE 0 END) AS reached_closed
  FROM tickets t
  LEFT JOIN ticket_events e ON e.ticket_id = t.ticket_id
  GROUP BY t.ticket_id, strftime('%Y-W%W', t.created_at)
)
SELECT
  cohort_week,
  SUM(reached_created) AS created_count,
  SUM(reached_assigned) AS assigned_count,
  SUM(reached_closed) AS closed_count
FROM flags
GROUP BY cohort_week
ORDER BY cohort_week;`;

const analyticsTrendSql = `WITH cohorts AS (
  SELECT
    strftime('%Y-W%W', created_at) AS cohort_week,
    COUNT(*) AS tickets_count,
    ROUND(100.0 * SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS completion_rate
  FROM tickets
  GROUP BY strftime('%Y-W%W', created_at)
)
SELECT
  cohort_week,
  tickets_count,
  completion_rate,
  LAG(completion_rate) OVER (ORDER BY cohort_week) AS previous_rate,
  ROUND(completion_rate - LAG(completion_rate) OVER (ORDER BY cohort_week), 1) AS rate_delta
FROM cohorts
ORDER BY cohort_week;`;

const backendMutationSql = `BEGIN;
CREATE TABLE IF NOT EXISTS ticket_status_audit(
  ticket_id INTEGER PRIMARY KEY,
  previous_status TEXT NOT NULL,
  migrated_at TEXT NOT NULL
);
INSERT INTO ticket_status_audit(ticket_id, previous_status, migrated_at)
SELECT ticket_id, status, '2026-08-13T00:00:00Z'
FROM tickets
WHERE status = 'Open';
UPDATE tickets
SET status = 'In Progress'
WHERE status = 'Open';
COMMIT;`;

const backendPostStateSql = `SELECT
  t.ticket_id,
  t.status,
  a.previous_status,
  a.migrated_at
FROM tickets t
JOIN ticket_status_audit a ON a.ticket_id = t.ticket_id
ORDER BY t.ticket_id;`;

const backendInvariantViewSql = `SELECT
  ticket_id,
  status,
  CASE
    WHEN status = 'Closed' AND closed_at IS NULL THEN 'invalid_closed_without_time'
    WHEN status <> 'Closed' AND closed_at IS NOT NULL THEN 'invalid_open_with_time'
    ELSE 'valid'
  END AS invariant_state
FROM tickets
ORDER BY ticket_id;`;

const backendInvariantValidationSql = `SELECT ticket_id, status, invariant_state
FROM ticket_state_invariants
ORDER BY ticket_id;`;

const backendPlanSql = `EXPLAIN QUERY PLAN
SELECT ticket_id, service, status
FROM tickets
WHERE service = 'Access' AND status = 'Closed'
ORDER BY ticket_id;`;

export const capstoneContracts: Record<string, CapstoneEvaluationContract> = {
  'project-incident-command': {
    projectId: 'project-incident-command',
    trackId: 'support',
    originality: 'Original synthetic support investigation authored for SQL Academy; no private or competitor data.',
    engineEvidence: 'Result semantics are deterministic in SQLite; PostgreSQL/MySQL transfer contracts separately verify joins, dates and NULL behavior.',
    sqliteLimitations: 'SQLite cannot reproduce production row locking or vendor SLA date functions; this capstone makes no locking claim.',
    passingScore: 80,
    datasets: [baseDataset, commonHidden, tieVariant],
    files: [
      {
        id: 'incident-base.sql', title: '01 · base.sql', kind: 'query', weight: 25,
        description: 'Одна строка на обращение с инженером, SLA, event history и NULL/duplicate contact state.',
        starterSql: incidentBaseSql, referenceSql: incidentBaseSql,
        requiredColumns: ['ticket_id', 'service', 'status', 'engineer_name', 'sla_state', 'history_events', 'last_event_at', 'contact_state'],
        remediation: 'Сохрани гранулярность «одно обращение — одна строка», агрегируй event history без умножения строк и различай missing/duplicate contacts.'
      },
      {
        id: 'incident-metrics.sql', title: '02 · metrics.sql', kind: 'query', weight: 30,
        description: 'Backlog, closed flow, breaches и breach rate по сервису.',
        starterSql: incidentMetricsSql, referenceSql: incidentMetricsSql,
        requiredColumns: ['service', 'backlog_count', 'closed_count', 'breach_count', 'breach_rate'],
        remediation: 'Раздели backlog и closed denominator; защищай деление через NULLIF.'
      },
      {
        id: 'incident-ranking.sql', title: '03 · ranking.sql', kind: 'query', weight: 30,
        description: 'Детерминированный рейтинг операционного риска.',
        starterSql: incidentRankingSql, referenceSql: incidentRankingSql,
        requiredColumns: ['service', 'breach_count', 'backlog_count', 'risk_rank'],
        remediation: 'Добавь полный tie-breaker в window ORDER BY и финальный ORDER BY.'
      }
    ],
    reflection: {
      title: 'Операционное объяснение',
      prompt: 'Опиши гранулярность, denominator breach rate, правила для open tickets и tie-breaker рейтинга.',
      minimumCharacters: 220,
      weight: 15,
      requiredIdeas: [
        { id: 'grain', label: 'гранулярность', keywords: ['грануляр', 'одна строк', 'одно обращ'] },
        { id: 'denominator', label: 'знаменатель', keywords: ['знаменател', 'denominator', 'closed'] },
        { id: 'open', label: 'open tickets', keywords: ['open', 'незакрыт', 'backlog'] },
        { id: 'order', label: 'стабильный порядок', keywords: ['tie', 'поряд', 'детерминир'] },
        { id: 'history', label: 'история обращения', keywords: ['истори', 'event', 'событ'] },
        { id: 'contact-quality', label: 'NULL и дубли контакта', keywords: ['null', 'дубл', 'duplicate'] }
      ]
    }
  },
  'project-data-trust': {
    projectId: 'project-data-trust',
    trackId: 'data-engineering',
    originality: 'Original synthetic quality/modeling case using reserved .example contacts only.',
    engineEvidence: 'Quality outputs are cross-engine concepts; schema syntax here is executable SQLite and vendor migrations require dialect-lab verification.',
    sqliteLimitations: 'SQLite VIEW and transaction behavior are evaluated locally; scheduler, warehouse orchestration and concurrent pipeline locks are out of scope.',
    passingScore: 80,
    datasets: [baseDataset, commonHidden],
    files: [
      {
        id: 'trust-profile.sql', title: '01 · profile.sql', kind: 'query', weight: 30,
        description: 'Профиль пропусков и дублей после нормализации email.',
        starterSql: trustProfileSql, referenceSql: trustProfileSql,
        requiredColumns: ['issue_type', 'issue_key', 'affected_rows'],
        remediation: 'Нормализуй email до группировки и отдели NULL/пустые значения от дублей.'
      },
      {
        id: 'trust-normalize.sql', title: '02 · normalize.sql', kind: 'query', weight: 30,
        description: 'Неразрушающая нормализация с размером duplicate group.',
        starterSql: trustNormalizeSql, referenceSql: trustNormalizeSql,
        requiredColumns: ['customer_id', 'normalized_email', 'is_email_missing', 'duplicate_group_size'],
        remediation: 'Сохрани customer_id, не заменяй NULL пустой строкой и считай дубли по normalized_email.'
      },
      {
        id: 'trust-schema.sql', title: '03 · schema.sql', kind: 'schema', weight: 25,
        description: 'Создай проверяемое представление customer_contact_quality без удаления исходных данных.',
        starterSql: `DROP VIEW IF EXISTS customer_contact_quality;\nCREATE VIEW customer_contact_quality AS\n${trustViewReferenceSql.replace(/;$/, '')};`,
        postValidationSql: trustViewValidationSql,
        referenceSql: trustViewReferenceSql,
        requiredColumns: ['customer_id', 'normalized_email', 'email_quality'],
        remediation: 'Создай VIEW customer_contact_quality с customer_id, normalized_email и quality: missing/duplicate/ok.'
      }
    ],
    reflection: {
      title: 'План безопасной миграции',
      prompt: 'Опиши, как сохранить исходные значения, проверить дубли, внедрить правило поэтапно и выполнить rollback.',
      minimumCharacters: 180,
      weight: 15,
      requiredIdeas: [
        { id: 'raw', label: 'исходные данные', keywords: ['исходн', 'raw', 'оригинал'] },
        { id: 'duplicates', label: 'дубли', keywords: ['дубл', 'duplicate'] },
        { id: 'staged', label: 'поэтапное внедрение', keywords: ['этап', 'копи', 'сначала'] },
        { id: 'rollback', label: 'rollback', keywords: ['rollback', 'откат'] }
      ]
    }
  },
  'project-executive-mart': {
    projectId: 'project-executive-mart',
    trackId: 'general',
    originality: 'Original synthetic operating-review case authored for SQL Academy.',
    engineEvidence: 'The local artifact uses a real SQLite EXPLAIN plan; the real-engine validator supplies PostgreSQL EXPLAIN and MySQL EXPLAIN evidence for transferable claims.',
    sqliteLimitations: 'EXPLAIN QUERY PLAN wording and access choices are SQLite-only and must not be presented as a PostgreSQL/MySQL plan.',
    passingScore: 82,
    datasets: [baseDataset, commonHidden, tieVariant],
    files: [
      {
        id: 'mart-pipeline.sql', title: '01 · mart.sql', kind: 'query', weight: 35,
        description: 'Повторяемая сервисная витрина с явной гранулярностью.',
        starterSql: martPipelineSql, referenceSql: martPipelineSql,
        requiredColumns: ['service', 'tickets_count', 'closed_count', 'breach_count', 'avg_resolution_minutes'],
        remediation: 'Собери одну строку на сервис; AVG считай только по closed resolution values.'
      },
      {
        id: 'mart-trend.sql', title: '02 · trend.sql', kind: 'query', weight: 25,
        description: 'Дневной trend и детерминированный ranking внутри дня.',
        starterSql: martTrendSql, referenceSql: martTrendSql,
        requiredColumns: ['day', 'service', 'breach_count', 'risk_rank'],
        remediation: 'Нормализуй день до группировки и добавь service как tie-breaker окна.'
      },
      {
        id: 'mart-plan.sql', title: '03 · plan.sql', kind: 'plan', weight: 20,
        description: 'EXPLAIN QUERY PLAN для фильтра service + status.',
        starterSql: `EXPLAIN QUERY PLAN\nSELECT ticket_id, service, status\nFROM tickets\nWHERE service = 'VPN' AND status = 'Closed'\nORDER BY ticket_id;`,
        requiredColumns: ['id', 'parent', 'notused', 'detail'],
        remediation: 'Запусти EXPLAIN QUERY PLAN для реального SELECT и сохрани фильтр по service/status.'
      }
    ],
    reflection: {
      title: 'Контракт operating review',
      prompt: 'Опиши период, гранулярность, трактовку backlog/closed, NULL и ограничения использования метрик.',
      minimumCharacters: 200,
      weight: 20,
      requiredIdeas: [
        { id: 'period', label: 'период', keywords: ['период', 'день', 'недел'] },
        { id: 'grain', label: 'гранулярность', keywords: ['грануляр', 'одна строк', 'сервис'] },
        { id: 'population', label: 'популяция метрики', keywords: ['backlog', 'closed', 'статус'] },
        { id: 'null', label: 'NULL', keywords: ['null', 'пропуск', 'неизвест'] }
      ]
    }
  },
  'project-analytics-decision': {
    projectId: 'project-analytics-decision',
    trackId: 'analyst',
    originality: 'Original synthetic cohort/funnel case derived from the course-owned event model, not a production analytics export.',
    engineEvidence: 'Cohort, conditional aggregation and window semantics are covered by PostgreSQL/MySQL transfer validators; local date formatting is SQLite-specific.',
    sqliteLimitations: "strftime('%Y-W%W') is SQLite-only; production work must use the target engine calendar/date contract and timezone policy.",
    passingScore: 82,
    datasets: [baseDataset, analyticsHidden],
    files: [
      {
        id: 'analytics-cohort.sql', title: '01 · cohort.sql', kind: 'query', weight: 30,
        description: 'Weekly acquisition cohort with an explicit customer population and activation denominator.',
        starterSql: analyticsCohortSql, referenceSql: analyticsCohortSql,
        requiredColumns: ['cohort_week', 'customers_count', 'activated_count', 'activation_rate'],
        remediation: 'Anchor each customer to first_created_at, keep one row per customer before aggregation, and divide activated customers by the full cohort.'
      },
      {
        id: 'analytics-funnel.sql', title: '02 · funnel.sql', kind: 'query', weight: 30,
        description: 'Created → assigned → closed funnel without multiplying entities by event rows.',
        starterSql: analyticsFunnelSql, referenceSql: analyticsFunnelSql,
        requiredColumns: ['cohort_week', 'created_count', 'assigned_count', 'closed_count'],
        remediation: 'Collapse events to one flag row per ticket before the cohort aggregation; ignore unknown event types without dropping the ticket.'
      },
      {
        id: 'analytics-trend.sql', title: '03 · trend.sql', kind: 'query', weight: 25,
        description: 'Window comparison of completion rate against the previous cohort.',
        starterSql: analyticsTrendSql, referenceSql: analyticsTrendSql,
        requiredColumns: ['cohort_week', 'tickets_count', 'completion_rate', 'previous_rate', 'rate_delta'],
        remediation: 'Aggregate the cohort first, then apply LAG with a deterministic cohort_week order; the first cohort must keep a NULL previous value.'
      }
    ],
    reflection: {
      title: 'Decision memo',
      prompt: 'Опиши population, denominator, calendar/timezone contract, funnel drop-off и почему наблюдаемая разница не доказывает причинность.',
      minimumCharacters: 200,
      weight: 15,
      requiredIdeas: [
        { id: 'population', label: 'population', keywords: ['population', 'популяц', 'клиент'] },
        { id: 'denominator', label: 'denominator', keywords: ['denominator', 'знаменател'] },
        { id: 'calendar', label: 'календарь и timezone', keywords: ['календар', 'timezone', 'часов'] },
        { id: 'funnel', label: 'funnel drop-off', keywords: ['funnel', 'воронк', 'drop'] },
        { id: 'causality', label: 'не причинность', keywords: ['причин', 'корреляц', 'эксперимент'] }
      ]
    }
  },
  'project-backend-integrity': {
    projectId: 'project-backend-integrity',
    trackId: 'backend',
    originality: 'Original synthetic migration case authored to test mutation scope and final database state.',
    engineEvidence: 'SQLite executes the state migration and real plan; PostgreSQL/MySQL validators cover transaction, locking and parameterization semantics separately.',
    sqliteLimitations: 'SQLite has database-level write serialization and no SELECT FOR UPDATE; production locking/isolation claims require the target engine evidence.',
    passingScore: 85,
    datasets: [baseDataset, backendHidden],
    files: [
      {
        id: 'backend-mutation.sql', title: '01 · migration.sql', kind: 'mutation', weight: 40,
        description: 'Audited, bounded status migration evaluated by final database state.',
        starterSql: backendMutationSql, referenceSql: backendMutationSql, postValidationSql: backendPostStateSql,
        requiredColumns: ['ticket_id', 'status', 'previous_status', 'migrated_at'],
        remediation: 'Wrap the audit insert and bounded UPDATE in BEGIN/COMMIT, target only status = Open, and preserve every previous status before mutation.'
      },
      {
        id: 'backend-schema.sql', title: '02 · invariants.sql', kind: 'schema', weight: 25,
        description: 'Read-only invariant view for impossible state/time combinations.',
        starterSql: `DROP VIEW IF EXISTS ticket_state_invariants;\nCREATE VIEW ticket_state_invariants AS\n${backendInvariantViewSql.replace(/;$/, '')};`,
        referenceSql: backendInvariantViewSql, postValidationSql: backendInvariantValidationSql,
        requiredColumns: ['ticket_id', 'status', 'invariant_state'],
        remediation: 'Create ticket_state_invariants without altering source rows and classify closed-without-time/open-with-time combinations explicitly.'
      },
      {
        id: 'backend-plan.sql', title: '03 · access-plan.sql', kind: 'plan', weight: 20,
        description: 'Real SQLite plan for the bounded service/status read path.',
        starterSql: backendPlanSql,
        requiredColumns: ['id', 'parent', 'notused', 'detail'],
        remediation: 'Run EXPLAIN QUERY PLAN for a SELECT constrained by both service and status, preserving an indexed service access path.'
      }
    ],
    reflection: {
      title: 'Migration and runtime note',
      prompt: 'Опиши transaction/rollback, bounded mutation, final-state validation, locking differences, parameterized input and SQLite plan limitation.',
      minimumCharacters: 220,
      weight: 15,
      requiredIdeas: [
        { id: 'transaction', label: 'transaction и rollback', keywords: ['transaction', 'транзакц', 'rollback', 'откат'] },
        { id: 'scope', label: 'bounded mutation', keywords: ['where', 'целев', 'bounded'] },
        { id: 'state', label: 'final state', keywords: ['final state', 'конечн', 'инвариант'] },
        { id: 'locking', label: 'locking', keywords: ['locking', 'блокиров', 'isolation'] },
        { id: 'parameters', label: 'parameters', keywords: ['параметр', 'injection'] },
        { id: 'sqlite', label: 'SQLite limitation', keywords: ['sqlite', 'огранич'] }
      ]
    }
  }
};

export const capstoneContractList = Object.values(capstoneContracts);

export function capstoneContract(projectId: string) {
  return capstoneContracts[projectId] || null;
}
