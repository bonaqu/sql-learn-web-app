import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type ConditionalAggregationEvidenceTag =
  | 'aggregate-filter'
  | 'shared-source-set'
  | 'exclusive-buckets'
  | 'reconciliation'
  | 'overlapping-cohorts'
  | 'intersection'
  | 'union-count'
  | 'denominator-policy'
  | 'zero-denominator'
  | 'entity-grain'
  | 'conditional-distinct'
  | 'unknown-measure'
  | 'missingness-count'
  | 'display-fallback'
  | 'weighted-average'
  | 'effective-weight'
  | 'cohort-conversion'
  | 'user-level-flags'
  | 'orphan-event'
  | 'boundary-buckets'
  | 'control-total'
  | 'group-reconciliation';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-151': {
    title: 'Посчитай согласованные метрики через FILTER',
    description: 'По каждому сервису из одного и того же набора строк посчитай total_count, Critical-обращения и закрытые обращения через aggregate FILTER. Все три метрики должны иметь общий GROUP BY и не расходиться из-за отдельных WHERE-запросов.',
    starter: `CREATE TEMP TABLE metric_tickets(
  ticket_id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL
);
INSERT INTO metric_tickets VALUES
  (1, 'VPN', 'Open', 'Critical'),
  (2, 'VPN', 'Closed', 'High'),
  (3, 'VPN', 'Closed', 'Critical'),
  (4, 'LMS', 'Open', 'Medium'),
  (5, 'LMS', 'Closed', 'Critical'),
  (6, 'LMS', 'Open', 'Critical');

SELECT service,
       COUNT(*) AS total_count,
       COUNT(*) FILTER (WHERE ) AS critical_count,
       COUNT(*) FILTER (WHERE ) AS closed_count
FROM metric_tickets
GROUP BY service
ORDER BY service;`,
    solution: `CREATE TEMP TABLE metric_tickets(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL); INSERT INTO metric_tickets VALUES (1, 'VPN', 'Open', 'Critical'), (2, 'VPN', 'Closed', 'High'), (3, 'VPN', 'Closed', 'Critical'), (4, 'LMS', 'Open', 'Medium'), (5, 'LMS', 'Closed', 'Critical'), (6, 'LMS', 'Open', 'Critical'); SELECT service, COUNT(*) AS total_count, COUNT(*) FILTER (WHERE priority = 'Critical') AS critical_count, COUNT(*) FILTER (WHERE status = 'Closed') AS closed_count FROM metric_tickets GROUP BY service ORDER BY service;`,
    hints: [
      'COUNT(*) без FILTER фиксирует общий denominator сервиса.',
      "Critical-фильтр: priority = 'Critical'.",
      "Closed-фильтр: status = 'Closed'."
    ]
  },
  'task-152': {
    title: 'Сверь взаимоисключающие status-бакеты',
    description: 'Разложи строки каждого сервиса по Open, Closed, Pending и unknown_status. Бакеты должны быть взаимоисключающими и полностью покрывать источник; верни reconciliation_gap как total минус сумма четырёх бакетов.',
    starter: `CREATE TEMP TABLE lifecycle_metrics(
  event_id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT
);
INSERT INTO lifecycle_metrics VALUES
  (1, 'VPN', 'Open'), (2, 'VPN', 'Closed'),
  (3, 'VPN', 'Pending'), (4, 'VPN', NULL),
  (5, 'LMS', 'Open'), (6, 'LMS', 'Open'),
  (7, 'LMS', 'Closed'), (8, 'LMS', NULL);

SELECT service,
       COUNT(*) AS total_count,
       SUM(CASE WHEN  THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN  THEN 1 ELSE 0 END) AS closed_count,
       SUM(CASE WHEN  THEN 1 ELSE 0 END) AS pending_count,
       SUM(CASE WHEN  THEN 1 ELSE 0 END) AS unknown_count,
       COUNT(*) - ( ) AS reconciliation_gap
FROM lifecycle_metrics
GROUP BY service
ORDER BY service;`,
    solution: `CREATE TEMP TABLE lifecycle_metrics(event_id INTEGER PRIMARY KEY, service TEXT NOT NULL, status TEXT); INSERT INTO lifecycle_metrics VALUES (1, 'VPN', 'Open'), (2, 'VPN', 'Closed'), (3, 'VPN', 'Pending'), (4, 'VPN', NULL), (5, 'LMS', 'Open'), (6, 'LMS', 'Open'), (7, 'LMS', 'Closed'), (8, 'LMS', NULL); SELECT service, COUNT(*) AS total_count, SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open_count, SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closed_count, SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending_count, SUM(CASE WHEN status IS NULL THEN 1 ELSE 0 END) AS unknown_count, COUNT(*) - (SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) + SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) + SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) + SUM(CASE WHEN status IS NULL THEN 1 ELSE 0 END)) AS reconciliation_gap FROM lifecycle_metrics GROUP BY service ORDER BY service;`,
    hints: [
      'Каждый CASE возвращает 1 только для одного состояния.',
      'NULL получает отдельный status IS NULL bucket.',
      'reconciliation_gap обязан быть нулём для каждого сервиса.'
    ]
  },
  'task-153': {
    title: 'Не сложи пересекающиеся когорты как независимые',
    description: 'Посчитай Critical, breached, их пересечение и объединение. Один инцидент может входить сразу в обе когорты, поэтому naive_sum не равен числу уникальных строк; вычисли either_count по формуле A + B − intersection.',
    starter: `CREATE TEMP TABLE incident_flags(
  incident_id INTEGER PRIMARY KEY,
  is_critical INTEGER NOT NULL,
  is_breached INTEGER NOT NULL
);
INSERT INTO incident_flags VALUES
  (1, 1, 1), (2, 1, 0), (3, 0, 1),
  (4, 0, 0), (5, 1, 1);

SELECT COUNT(*) AS total_count,
       SUM( ) AS critical_count,
       SUM( ) AS breached_count,
       SUM(CASE WHEN  THEN 1 ELSE 0 END) AS both_count,
       ( ) AS either_count,
       SUM(is_critical) + SUM(is_breached) AS naive_sum
FROM incident_flags;`,
    solution: `CREATE TEMP TABLE incident_flags(incident_id INTEGER PRIMARY KEY, is_critical INTEGER NOT NULL, is_breached INTEGER NOT NULL); INSERT INTO incident_flags VALUES (1, 1, 1), (2, 1, 0), (3, 0, 1), (4, 0, 0), (5, 1, 1); SELECT COUNT(*) AS total_count, SUM(is_critical) AS critical_count, SUM(is_breached) AS breached_count, SUM(CASE WHEN is_critical = 1 AND is_breached = 1 THEN 1 ELSE 0 END) AS both_count, SUM(is_critical) + SUM(is_breached) - SUM(CASE WHEN is_critical = 1 AND is_breached = 1 THEN 1 ELSE 0 END) AS either_count, SUM(is_critical) + SUM(is_breached) AS naive_sum FROM incident_flags;`,
    hints: [
      'critical_count и breached_count могут пересекаться.',
      'both_count требует одновременно is_critical = 1 и is_breached = 1.',
      'Объединение двух множеств: A + B − intersection.'
    ]
  },
  'task-154': {
    title: 'Зафиксируй eligible denominator для rates',
    description: 'По каждому каналу посчитай только eligible-события, resolved среди eligible и rate. Resolved вне eligible не должен попадать в numerator, а канал с нулевым denominator должен вернуть NULL, а не выдуманный 0%.',
    starter: `-- Напиши решение с нуля:
-- создай eligible/resolved события по каналам,
-- используй один denominator и согласованный numerator,
-- защити rate через NULLIF.`,
    solution: `CREATE TEMP TABLE outcome_events(event_id INTEGER PRIMARY KEY, channel TEXT NOT NULL, eligible INTEGER NOT NULL, resolved INTEGER NOT NULL); INSERT INTO outcome_events VALUES (1, 'email', 1, 1), (2, 'email', 1, 0), (3, 'email', 0, 1), (4, 'chat', 0, 0), (5, 'chat', 0, 1), (6, 'web', 1, 0), (7, 'web', 1, 0); SELECT channel, SUM(eligible) AS eligible_count, SUM(CASE WHEN eligible = 1 AND resolved = 1 THEN 1 ELSE 0 END) AS resolved_eligible_count, ROUND(100.0 * SUM(CASE WHEN eligible = 1 AND resolved = 1 THEN 1 ELSE 0 END) / NULLIF(SUM(eligible), 0), 1) AS resolved_rate FROM outcome_events GROUP BY channel ORDER BY channel;`,
    hints: [
      'Denominator — SUM(eligible), а не COUNT(*) канала.',
      'Numerator требует одновременно eligible = 1 и resolved = 1.',
      'NULLIF(SUM(eligible), 0) сохраняет отсутствие измеримой базы.'
    ]
  },
  'task-155': {
    title: 'Отдели event grain от customer grain',
    description: 'В журнале один клиент может иметь несколько resolved-событий. Верни число строк, уникальных клиентов, уникальных resolved-клиентов и количество resolved-событий, чтобы не выдать event count за число людей.',
    starter: `-- Напиши решение с нуля:
-- создай повторяющиеся события клиентов,
-- сравни COUNT(*), COUNT(DISTINCT customer_id),
-- conditional DISTINCT и простой event count.`,
    solution: `CREATE TEMP TABLE customer_events(event_id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, event_type TEXT NOT NULL); INSERT INTO customer_events VALUES (1, 1, 'opened'), (2, 1, 'resolved'), (3, 1, 'resolved'), (4, 2, 'opened'), (5, 3, 'resolved'), (6, 3, 'opened'), (7, 4, 'opened'); SELECT COUNT(*) AS event_rows, COUNT(DISTINCT customer_id) AS unique_customers, COUNT(DISTINCT CASE WHEN event_type = 'resolved' THEN customer_id END) AS resolved_customers, SUM(CASE WHEN event_type = 'resolved' THEN 1 ELSE 0 END) AS resolved_events FROM customer_events;`,
    hints: [
      'COUNT(*) остаётся на grain события.',
      'COUNT(DISTINCT customer_id) переходит на grain клиента.',
      'Conditional DISTINCT считает клиентов, а SUM(CASE) — события.'
    ]
  },
  'task-156': {
    title: 'Суммируй известные суммы и считай пропуски отдельно',
    description: 'По каждой команде посчитай approved-строки, известные approved-суммы, число approved-строк с неизвестной amount и итоговую approved_amount. Display fallback 0 разрешён только отдельной колонкой после сохранения missingness evidence.',
    starter: `CREATE TEMP TABLE invoice_events(
  event_id INTEGER PRIMARY KEY,
  team TEXT NOT NULL,
  state TEXT NOT NULL,
  amount INTEGER
);
INSERT INTO invoice_events VALUES
  (1, 'A', 'approved', 100), (2, 'A', 'approved', NULL),
  (3, 'A', 'rejected', 50), (4, 'B', 'approved', NULL),
  (5, 'B', 'rejected', 20), (6, 'C', 'rejected', 10);

SELECT team,
       COUNT(*) FILTER (WHERE ) AS approved_rows,
       COUNT(amount) FILTER (WHERE ) AS known_approved_amounts,
       SUM(CASE WHEN  THEN amount END) AS approved_amount,
       SUM(CASE WHEN  THEN 1 ELSE 0 END) AS missing_approved_amounts,
       COALESCE( , 0) AS display_approved_amount
FROM invoice_events
GROUP BY team
ORDER BY team;`,
    solution: `CREATE TEMP TABLE invoice_events(event_id INTEGER PRIMARY KEY, team TEXT NOT NULL, state TEXT NOT NULL, amount INTEGER); INSERT INTO invoice_events VALUES (1, 'A', 'approved', 100), (2, 'A', 'approved', NULL), (3, 'A', 'rejected', 50), (4, 'B', 'approved', NULL), (5, 'B', 'rejected', 20), (6, 'C', 'rejected', 10); SELECT team, COUNT(*) FILTER (WHERE state = 'approved') AS approved_rows, COUNT(amount) FILTER (WHERE state = 'approved') AS known_approved_amounts, SUM(CASE WHEN state = 'approved' THEN amount END) AS approved_amount, SUM(CASE WHEN state = 'approved' AND amount IS NULL THEN 1 ELSE 0 END) AS missing_approved_amounts, COALESCE(SUM(CASE WHEN state = 'approved' THEN amount END), 0) AS display_approved_amount FROM invoice_events GROUP BY team ORDER BY team;`,
    hints: [
      'approved_rows не зависит от известности amount.',
      'COUNT(amount) исключает NULL и показывает число известных сумм.',
      'COALESCE применяется только к display-колонке после missing count.'
    ]
  },
  'task-157': {
    title: 'Посчитай weighted average по эффективному весу',
    description: 'По каждой команде вычисли weighted_average только по строкам с известным score. NULL-score не должен добавлять свой weight в denominator, а нулевая сумма эффективных весов должна давать NULL.',
    starter: `CREATE TEMP TABLE quality_scores(
  sample_id INTEGER PRIMARY KEY,
  team TEXT NOT NULL,
  score REAL,
  weight REAL NOT NULL
);
INSERT INTO quality_scores VALUES
  (1, 'A', 80, 2), (2, 'A', 100, 1),
  (3, 'B', 50, 0), (4, 'B', 90, 0),
  (5, 'C', 70, 1), (6, 'C', NULL, 2);

SELECT team,
       COUNT(*) AS total_rows,
       COUNT(score) AS known_rows,
       SUM(CASE WHEN  THEN weight ELSE 0 END) AS effective_weight,
       ROUND(SUM(score * weight) / NULLIF( , 0), 3) AS weighted_average
FROM quality_scores
GROUP BY team
ORDER BY team;`,
    solution: `CREATE TEMP TABLE quality_scores(sample_id INTEGER PRIMARY KEY, team TEXT NOT NULL, score REAL, weight REAL NOT NULL); INSERT INTO quality_scores VALUES (1, 'A', 80, 2), (2, 'A', 100, 1), (3, 'B', 50, 0), (4, 'B', 90, 0), (5, 'C', 70, 1), (6, 'C', NULL, 2); SELECT team, COUNT(*) AS total_rows, COUNT(score) AS known_rows, SUM(CASE WHEN score IS NOT NULL THEN weight ELSE 0 END) AS effective_weight, ROUND(SUM(score * weight) / NULLIF(SUM(CASE WHEN score IS NOT NULL THEN weight ELSE 0 END), 0), 3) AS weighted_average FROM quality_scores GROUP BY team ORDER BY team;`,
    hints: [
      'COUNT(score) показывает число известных score.',
      'Вес входит в denominator только при score IS NOT NULL.',
      'NULLIF защищает команду B с effective_weight = 0.'
    ]
  },
  'task-158': {
    title: 'Посчитай conversion на user grain',
    description: 'Сначала сверни события до одной строки на пользователя и когорту, затем посчитай signup-users, покупателей среди signup-users, orphan purchase и conversion rate. Дубли purchase не должны увеличивать число converted users.',
    starter: `CREATE TEMP TABLE funnel_events(
  event_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  cohort TEXT NOT NULL,
  event_type TEXT NOT NULL
);
INSERT INTO funnel_events VALUES
  (1, 1, 'A', 'signup'), (2, 1, 'A', 'purchase'), (3, 1, 'A', 'purchase'),
  (4, 2, 'A', 'signup'), (5, 3, 'A', 'purchase'),
  (6, 4, 'B', 'signup'), (7, 4, 'B', 'purchase'),
  (8, 5, 'B', 'signup'), (9, 5, 'B', 'purchase'), (10, 6, 'B', 'signup');

WITH user_flags AS (
  SELECT cohort, user_id,
         MAX(CASE WHEN  THEN 1 ELSE 0 END) AS signed_up,
         MAX(CASE WHEN  THEN 1 ELSE 0 END) AS purchased
  FROM funnel_events
  GROUP BY cohort, user_id
)
SELECT cohort,
       SUM(signed_up) AS eligible_users,
       SUM(CASE WHEN  THEN 1 ELSE 0 END) AS converted_users,
       SUM(CASE WHEN  THEN 1 ELSE 0 END) AS orphan_purchase_users,
       ROUND(100.0 *  / NULLIF(SUM(signed_up), 0), 1) AS conversion_rate
FROM user_flags
GROUP BY cohort
ORDER BY cohort;`,
    solution: `CREATE TEMP TABLE funnel_events(event_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, cohort TEXT NOT NULL, event_type TEXT NOT NULL); INSERT INTO funnel_events VALUES (1, 1, 'A', 'signup'), (2, 1, 'A', 'purchase'), (3, 1, 'A', 'purchase'), (4, 2, 'A', 'signup'), (5, 3, 'A', 'purchase'), (6, 4, 'B', 'signup'), (7, 4, 'B', 'purchase'), (8, 5, 'B', 'signup'), (9, 5, 'B', 'purchase'), (10, 6, 'B', 'signup'); WITH user_flags AS (SELECT cohort, user_id, MAX(CASE WHEN event_type = 'signup' THEN 1 ELSE 0 END) AS signed_up, MAX(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS purchased FROM funnel_events GROUP BY cohort, user_id) SELECT cohort, SUM(signed_up) AS eligible_users, SUM(CASE WHEN signed_up = 1 AND purchased = 1 THEN 1 ELSE 0 END) AS converted_users, SUM(CASE WHEN signed_up = 0 AND purchased = 1 THEN 1 ELSE 0 END) AS orphan_purchase_users, ROUND(100.0 * SUM(CASE WHEN signed_up = 1 AND purchased = 1 THEN 1 ELSE 0 END) / NULLIF(SUM(signed_up), 0), 1) AS conversion_rate FROM user_flags GROUP BY cohort ORDER BY cohort;`,
    hints: [
      'MAX(CASE) превращает повторные события в бинарный user flag.',
      'Converted требует signed_up = 1 и purchased = 1.',
      'Orphan purchase сохраняется отдельной quality-метрикой.'
    ]
  },
  'task-159': {
    title: 'Зафиксируй непересекающиеся SLA boundaries',
    description: 'Разложи resolution_minutes на on_time <= 60, near_breach 61..90, breached > 90 и missing. Границы должны быть взаимоисключающими и покрывать все строки; верни reconciliation_gap.',
    starter: `-- Напиши решение с нуля:
-- создай значения на границах 60/61/90/91 и NULL,
-- посчитай четыре непересекающихся бакета,
-- докажи нулевой reconciliation gap.`,
    solution: `CREATE TEMP TABLE sla_samples(ticket_id INTEGER PRIMARY KEY, resolution_minutes INTEGER); INSERT INTO sla_samples VALUES (1, NULL), (2, 30), (3, 60), (4, 61), (5, 90), (6, 91), (7, 120); SELECT COUNT(*) AS total_count, SUM(CASE WHEN resolution_minutes <= 60 THEN 1 ELSE 0 END) AS on_time_count, SUM(CASE WHEN resolution_minutes > 60 AND resolution_minutes <= 90 THEN 1 ELSE 0 END) AS near_breach_count, SUM(CASE WHEN resolution_minutes > 90 THEN 1 ELSE 0 END) AS breached_count, SUM(CASE WHEN resolution_minutes IS NULL THEN 1 ELSE 0 END) AS missing_count, COUNT(*) - (SUM(CASE WHEN resolution_minutes <= 60 THEN 1 ELSE 0 END) + SUM(CASE WHEN resolution_minutes > 60 AND resolution_minutes <= 90 THEN 1 ELSE 0 END) + SUM(CASE WHEN resolution_minutes > 90 THEN 1 ELSE 0 END) + SUM(CASE WHEN resolution_minutes IS NULL THEN 1 ELSE 0 END)) AS reconciliation_gap FROM sla_samples;`,
    hints: [
      'on_time включает 60, near_breach начинается строго после 60.',
      'near_breach включает 90, breached начинается строго после 90.',
      'NULL получает отдельный missing bucket.'
    ]
  },
  'task-160': {
    title: 'Сверь групповые метрики с control total',
    description: 'Сначала посчитай total, closed и active по сервисам, затем добавь строку ALL из сумм уже рассчитанных групп. Для каждой строки верни reconciliation_gap, чтобы доказать total = closed + active и согласованность общего итога.',
    starter: `-- Напиши решение с нуля:
-- создай события нескольких сервисов,
-- собери per_service CTE,
-- добавь ALL control row и нулевой gap.`,
    solution: `CREATE TEMP TABLE support_events(event_id INTEGER PRIMARY KEY, service TEXT NOT NULL, state TEXT NOT NULL); INSERT INTO support_events VALUES (1, 'VPN', 'Open'), (2, 'VPN', 'Closed'), (3, 'VPN', 'Closed'), (4, 'LMS', 'Open'), (5, 'LMS', 'Pending'), (6, 'VDI', 'Closed'); WITH per_service AS (SELECT service, COUNT(*) AS total_count, SUM(CASE WHEN state = 'Closed' THEN 1 ELSE 0 END) AS closed_count, SUM(CASE WHEN state IN ('Open', 'Pending') THEN 1 ELSE 0 END) AS active_count FROM support_events GROUP BY service), report AS (SELECT service, total_count, closed_count, active_count, total_count - closed_count - active_count AS reconciliation_gap, 0 AS sort_group FROM per_service UNION ALL SELECT 'ALL', SUM(total_count), SUM(closed_count), SUM(active_count), SUM(total_count) - SUM(closed_count) - SUM(active_count), 1 FROM per_service) SELECT service, total_count, closed_count, active_count, reconciliation_gap FROM report ORDER BY sort_group, service;`,
    hints: [
      'per_service фиксирует одну строку на сервис.',
      'ALL строится из сумм per_service, а не отдельным несовместимым WHERE.',
      'reconciliation_gap должен быть нулём у групп и общего итога.'
    ]
  }
};

export const conditionalAggregationAuthoredTaskEvidence: Readonly<Record<string, readonly ConditionalAggregationEvidenceTag[]>> = {
  'task-151': ['aggregate-filter', 'shared-source-set'],
  'task-152': ['exclusive-buckets', 'reconciliation'],
  'task-153': ['overlapping-cohorts', 'intersection', 'union-count'],
  'task-154': ['denominator-policy', 'zero-denominator'],
  'task-155': ['entity-grain', 'conditional-distinct'],
  'task-156': ['unknown-measure', 'missingness-count', 'display-fallback'],
  'task-157': ['weighted-average', 'effective-weight', 'zero-denominator'],
  'task-158': ['cohort-conversion', 'user-level-flags', 'orphan-event', 'denominator-policy'],
  'task-159': ['boundary-buckets', 'exclusive-buckets', 'reconciliation'],
  'task-160': ['control-total', 'group-reconciliation', 'reconciliation']
};

export function advancedConditionalAggregationTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedConditionalAggregationTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedConditionalAggregationTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}

export const conditionalAggregationAuthoredTaskIds = Object.freeze(Object.keys(taskOverrides));
