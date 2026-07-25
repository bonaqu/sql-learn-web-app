import type { CapstoneProject } from './complete-curriculum';

export type CapstoneFileKind = 'query' | 'schema' | 'plan';
export type CapstoneCheckKind = 'result-contract' | 'hidden-data' | 'schema-invariant' | 'plan-shape' | 'reflection';

export interface CapstoneDatasetVariant {
  id: string;
  title: string;
  appendSql: string;
  hidden: boolean;
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
  passingScore: number;
  files: CapstoneFileContract[];
  datasets: CapstoneDatasetVariant[];
  reflection: CapstoneReflectionContract;
}

const commonHidden: CapstoneDatasetVariant = {
  id: 'hidden-edge-cases',
  title: 'Hidden edge cases',
  hidden: true,
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
  hidden: false
};

const incidentBaseSql = `SELECT
  t.ticket_id,
  t.service,
  t.status,
  e.name AS engineer_name,
  CASE
    WHEN t.status = 'Closed' AND t.resolution_minutes > t.sla_minutes THEN 'breach'
    WHEN t.status = 'Closed' THEN 'met'
    ELSE 'open'
  END AS sla_state
FROM tickets t
JOIN engineers e ON e.engineer_id = t.engineer_id
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

export const capstoneContracts: Record<string, CapstoneEvaluationContract> = {
  'project-incident-command': {
    projectId: 'project-incident-command',
    passingScore: 80,
    datasets: [baseDataset, commonHidden, tieVariant],
    files: [
      {
        id: 'incident-base.sql', title: '01 · base.sql', kind: 'query', weight: 25,
        description: 'Одна строка на обращение с инженером и корректным SLA state.',
        starterSql: incidentBaseSql, referenceSql: incidentBaseSql,
        requiredColumns: ['ticket_id', 'service', 'status', 'engineer_name', 'sla_state'],
        remediation: 'Зафиксируй гранулярность «одно обращение — одна строка» и не вычисляй resolution для open tickets.'
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
      minimumCharacters: 180,
      weight: 15,
      requiredIdeas: [
        { id: 'grain', label: 'гранулярность', keywords: ['грануляр', 'одна строк', 'одно обращ'] },
        { id: 'denominator', label: 'знаменатель', keywords: ['знаменател', 'denominator', 'closed'] },
        { id: 'open', label: 'open tickets', keywords: ['open', 'незакрыт', 'backlog'] },
        { id: 'order', label: 'стабильный порядок', keywords: ['tie', 'поряд', 'детерминир'] }
      ]
    }
  },
  'project-data-trust': {
    projectId: 'project-data-trust',
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
  }
};

export const capstoneContractList = Object.values(capstoneContracts);

export function capstoneContract(projectId: string) {
  return capstoneContracts[projectId] || null;
}
