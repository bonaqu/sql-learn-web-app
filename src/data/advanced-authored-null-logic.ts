import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type NullLogicEvidenceTag =
  | 'three-valued-logic'
  | 'unknown-classification'
  | 'where-unknown'
  | 'explicit-null-branch'
  | 'not-in-trap'
  | 'null-safe-anti-join'
  | 'null-safe-equality'
  | 'pairwise-comparison'
  | 'business-fallback'
  | 'missingness-preservation'
  | 'blank-normalization'
  | 'nullif'
  | 'safe-division'
  | 'zero-denominator'
  | 'aggregate-null-semantics'
  | 'denominator-proof'
  | 'explicit-null-order'
  | 'deterministic-order'
  | 'outer-join-presence'
  | 'nullable-attribute'
  | 'check-unknown'
  | 'not-null-contract'
  | 'schema-metadata';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-141': {
    title: 'Построй таблицу TRUE, FALSE и UNKNOWN',
    description: 'Вычисли четыре сравнения, включая `1 = NULL` и `NULL = NULL`, затем классифицируй результат каждого выражения как TRUE, FALSE или UNKNOWN. Задача должна показать, что SQL NULL не является обычным значением и не равен даже другому NULL.',
    starter: `WITH expressions(label, result) AS (
  VALUES
    ('one_equals_one', 1 = 1),
    ('one_equals_two', 1 = 2),
    ('one_equals_null', 1 = NULL),
    ('null_equals_null', NULL = NULL)
)
SELECT
  label,
  CASE
    WHEN  THEN 'TRUE'
    WHEN  THEN 'FALSE'
    ELSE 'UNKNOWN'
  END AS truth_value
FROM expressions
ORDER BY label;`,
    solution: `WITH expressions(label, result) AS (VALUES ('one_equals_one', 1 = 1), ('one_equals_two', 1 = 2), ('one_equals_null', 1 = NULL), ('null_equals_null', NULL = NULL)) SELECT label, CASE WHEN result = 1 THEN 'TRUE' WHEN result = 0 THEN 'FALSE' ELSE 'UNKNOWN' END AS truth_value FROM expressions ORDER BY label;`,
    hints: [
      'SQLite представляет TRUE как 1, FALSE как 0, а UNKNOWN как NULL.',
      'Сначала проверь result = 1, затем result = 0.',
      'Все остальные результаты относятся к UNKNOWN.'
    ]
  },
  'task-142': {
    title: 'Не потеряй UNKNOWN в фильтре статусов',
    description: 'Верни обращения, которые точно не закрыты, а также строки с неизвестным status для отдельной проверки. Простое `status <> Closed` исключит NULL, потому что WHERE пропускает только TRUE; добавь явную ветку `IS NULL` и подпиши причину попадания строки.',
    starter: `CREATE TEMP TABLE status_audit(
  ticket_id INTEGER PRIMARY KEY,
  status TEXT
);
INSERT INTO status_audit VALUES
  (201, 'Open'),
  (202, 'Closed'),
  (203, NULL),
  (204, 'Pending');

SELECT ticket_id, status,
       CASE WHEN  THEN 'unknown-status' ELSE 'not-closed' END AS inclusion_reason
FROM status_audit
WHERE
ORDER BY ticket_id;`,
    solution: `CREATE TEMP TABLE status_audit(ticket_id INTEGER PRIMARY KEY, status TEXT); INSERT INTO status_audit VALUES (201, 'Open'), (202, 'Closed'), (203, NULL), (204, 'Pending'); SELECT ticket_id, status, CASE WHEN status IS NULL THEN 'unknown-status' ELSE 'not-closed' END AS inclusion_reason FROM status_audit WHERE status <> 'Closed' OR status IS NULL ORDER BY ticket_id;`,
    hints: [
      "`status <> 'Closed'` даёт UNKNOWN для NULL и сам по себе строку не возвращает.",
      'Добавь `OR status IS NULL` в WHERE.',
      'В CASE используй `status IS NULL` для отдельной причины.'
    ]
  },
  'task-143': {
    title: 'Обезвредь NOT IN с NULL через NOT EXISTS',
    description: 'Найди клиентов, регион которых отсутствует в blocked_regions. В справочнике намеренно есть NULL: `NOT IN` превратит сравнение в UNKNOWN и может вернуть ноль строк. Используй коррелированный `NOT EXISTS`, а в результате покажи безопасный список и контрольное количество.',
    starter: `CREATE TEMP TABLE customer_regions(
  customer_id INTEGER PRIMARY KEY,
  region TEXT NOT NULL
);
CREATE TEMP TABLE blocked_regions(region TEXT);
INSERT INTO customer_regions VALUES
  (1, 'RU'), (2, 'LV'), (3, 'EE'), (4, 'DE');
INSERT INTO blocked_regions VALUES ('RU'), (NULL), ('DE');

WITH safe_customers AS (
  SELECT c.customer_id, c.region
  FROM customer_regions c
  WHERE
)
SELECT customer_id, region,
       COUNT(*) OVER () AS safe_customer_count
FROM safe_customers
ORDER BY customer_id;`,
    solution: `CREATE TEMP TABLE customer_regions(customer_id INTEGER PRIMARY KEY, region TEXT NOT NULL); CREATE TEMP TABLE blocked_regions(region TEXT); INSERT INTO customer_regions VALUES (1, 'RU'), (2, 'LV'), (3, 'EE'), (4, 'DE'); INSERT INTO blocked_regions VALUES ('RU'), (NULL), ('DE'); WITH safe_customers AS (SELECT c.customer_id, c.region FROM customer_regions c WHERE NOT EXISTS (SELECT 1 FROM blocked_regions b WHERE b.region = c.region)) SELECT customer_id, region, COUNT(*) OVER () AS safe_customer_count FROM safe_customers ORDER BY customer_id;`,
    hints: [
      'Не используй `region NOT IN (SELECT region ...)`, пока подзапрос может вернуть NULL.',
      'Коррелируй `blocked_regions.region` с `customer_regions.region` внутри NOT EXISTS.',
      'Безопасными должны остаться LV и EE, count — 2.'
    ]
  },
  'task-144': {
    title: 'Сравни пары значений NULL-safe способом',
    description: 'Для каждой пары expected_value и actual_value определи совпадение: два одинаковых известных значения совпадают, два NULL тоже совпадают, а NULL против известного значения — нет. Реализуй переносимый null-safe predicate без подмены NULL фиктивной строкой.',
    starter: `-- Напиши решение с нуля:
-- создай пары expected/actual,
-- сравни обычные значения и отдельный случай двух NULL,
-- верни match_state для каждой пары.`,
    solution: `CREATE TEMP TABLE value_pairs(pair_id INTEGER PRIMARY KEY, expected_value TEXT, actual_value TEXT); INSERT INTO value_pairs VALUES (1, 'email', 'email'), (2, NULL, NULL), (3, NULL, 'sms'), (4, 'chat', NULL), (5, 'vpn', 'lms'); SELECT pair_id, expected_value, actual_value, CASE WHEN expected_value = actual_value OR (expected_value IS NULL AND actual_value IS NULL) THEN 'match' ELSE 'different' END AS match_state FROM value_pairs ORDER BY pair_id;`,
    hints: [
      'Обычное равенство покрывает только два известных одинаковых значения.',
      'Добавь отдельную ветку `(expected_value IS NULL AND actual_value IS NULL)`.',
      'Не используй COALESCE с магической строкой: она может совпасть с реальными данными.'
    ]
  },
  'task-145': {
    title: 'Покажи fallback, не уничтожая причину отсутствия',
    description: 'Нормализуй email через TRIM и NULLIF, но не ограничивайся одним display fallback. Для каждой строки верни исходное значение, normalized_email, состояние `missing`, `blank` или `present` и отображаемый адрес, чтобы UI-fallback не стирал различие между NULL и пустой строкой.',
    starter: `-- Напиши решение с нуля:
-- создай контакты с NULL, пробелами и реальным email,
-- нормализуй значение,
-- отдельно сохрани missingness state и display fallback.`,
    solution: `CREATE TEMP TABLE contact_inputs(customer_id INTEGER PRIMARY KEY, email TEXT); INSERT INTO contact_inputs VALUES (1, NULL), (2, '   '), (3, ' Alice@Example.com '); WITH normalized AS (SELECT customer_id, email AS raw_email, NULLIF(TRIM(email), '') AS normalized_email FROM contact_inputs) SELECT customer_id, raw_email, normalized_email, CASE WHEN raw_email IS NULL THEN 'missing' WHEN normalized_email IS NULL THEN 'blank' ELSE 'present' END AS email_state, COALESCE(normalized_email, 'not-provided') AS display_email FROM normalized ORDER BY customer_id;`,
    hints: [
      'NULLIF(TRIM(email), \'\') превращает пустой ввод в NULL только в normalized-слое.',
      'Состояние missing определяется по raw_email IS NULL, blank — по normalized_email IS NULL.',
      'COALESCE применяй только для display_email, не как замену данным.'
    ]
  },
  'task-146': {
    title: 'Защити коэффициент через NULLIF denominator',
    description: 'Посчитай долю resolved_count / total_count для трёх команд. При total_count = 0 результат должен быть NULL, а не ошибка или фиктивный ноль. Дополнительно верни ratio_state, чтобы потребитель отличал отсутствие denominator от настоящего коэффициента 0.',
    starter: `CREATE TEMP TABLE team_metrics(
  team TEXT PRIMARY KEY,
  resolved_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL
);
INSERT INTO team_metrics VALUES
  ('A', 8, 10),
  ('B', 0, 0),
  ('C', 0, 5);

SELECT team,
       ROUND(1.0 * resolved_count / , 3) AS resolved_ratio,
       CASE WHEN  THEN 'no-denominator' ELSE 'calculated' END AS ratio_state
FROM team_metrics
ORDER BY team;`,
    solution: `CREATE TEMP TABLE team_metrics(team TEXT PRIMARY KEY, resolved_count INTEGER NOT NULL, total_count INTEGER NOT NULL); INSERT INTO team_metrics VALUES ('A', 8, 10), ('B', 0, 0), ('C', 0, 5); SELECT team, ROUND(1.0 * resolved_count / NULLIF(total_count, 0), 3) AS resolved_ratio, CASE WHEN total_count = 0 THEN 'no-denominator' ELSE 'calculated' END AS ratio_state FROM team_metrics ORDER BY team;`,
    hints: [
      'NULLIF(total_count, 0) возвращает NULL только при нулевом denominator.',
      'Умножение на 1.0 сохраняет дробную арифметику.',
      'Команда B — no-denominator, а команда C имеет рассчитанный коэффициент 0.'
    ]
  },
  'task-147': {
    title: 'Раздели строки, известные значения и пропуски в агрегатах',
    description: 'По каждому сервису верни количество всех обращений, количество известных resolution_minutes, число пропусков и среднее только по известным значениям. Задача должна явно показать различие COUNT(*) и COUNT(column), а также согласованность denominator.',
    starter: `CREATE TEMP TABLE resolution_samples(
  ticket_id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  resolution_minutes INTEGER
);
INSERT INTO resolution_samples VALUES
  (1, 'VPN', 30), (2, 'VPN', NULL), (3, 'VPN', 90),
  (4, 'LMS', NULL), (5, 'LMS', NULL), (6, 'LMS', 60);

SELECT service,
       COUNT(*) AS total_rows,
       COUNT( ) AS known_rows,
       SUM(CASE WHEN  THEN 1 ELSE 0 END) AS missing_rows,
       ROUND(AVG(resolution_minutes), 1) AS known_average
FROM resolution_samples
GROUP BY service
ORDER BY service;`,
    solution: `CREATE TEMP TABLE resolution_samples(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL, resolution_minutes INTEGER); INSERT INTO resolution_samples VALUES (1, 'VPN', 30), (2, 'VPN', NULL), (3, 'VPN', 90), (4, 'LMS', NULL), (5, 'LMS', NULL), (6, 'LMS', 60); SELECT service, COUNT(*) AS total_rows, COUNT(resolution_minutes) AS known_rows, SUM(CASE WHEN resolution_minutes IS NULL THEN 1 ELSE 0 END) AS missing_rows, ROUND(AVG(resolution_minutes), 1) AS known_average FROM resolution_samples GROUP BY service ORDER BY service;`,
    hints: [
      'COUNT(*) считает строки, COUNT(resolution_minutes) — только не-NULL значения.',
      'missing_rows считай через CASE WHEN resolution_minutes IS NULL.',
      'AVG автоматически игнорирует NULL, поэтому подпиши его как known_average.'
    ]
  },
  'task-148': {
    title: 'Задай порядок NULL явно и детерминированно',
    description: 'Отсортируй задачи так, чтобы известные due_at шли первыми по дате, а строки без срока — последними. Добавь task_id как tie-breaker. Не полагайся на диалектный порядок NULL по умолчанию: вырази null placement отдельным ключом сортировки.',
    starter: `CREATE TEMP TABLE work_items(
  task_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  due_at TEXT
);
INSERT INTO work_items VALUES
  (1, 'A', NULL),
  (2, 'B', '2026-08-05'),
  (3, 'C', '2026-08-05'),
  (4, 'D', '2026-08-03'),
  (5, 'E', NULL);

SELECT task_id, title, due_at
FROM work_items
ORDER BY ;`,
    solution: `CREATE TEMP TABLE work_items(task_id INTEGER PRIMARY KEY, title TEXT NOT NULL, due_at TEXT); INSERT INTO work_items VALUES (1, 'A', NULL), (2, 'B', '2026-08-05'), (3, 'C', '2026-08-05'), (4, 'D', '2026-08-03'), (5, 'E', NULL); SELECT task_id, title, due_at FROM work_items ORDER BY due_at IS NULL ASC, due_at ASC, task_id ASC;`,
    hints: [
      '`due_at IS NULL` даёт 0 для известных дат и 1 для NULL.',
      'Первый ключ — null placement, второй — сама дата.',
      'task_id завершает полный стабильный порядок при одинаковых датах и NULL.'
    ]
  },
  'task-149': {
    title: 'Отличи отсутствие JOIN-строки от NULL-атрибута',
    description: 'После LEFT JOIN классифицируй клиента как `no-preference-row`, `preference-without-channel` или `channel-selected`. Нельзя проверять только `channel IS NULL`: это смешает отсутствие связанной строки с существующей строкой, где канал пока неизвестен.',
    starter: `-- Напиши решение с нуля:
-- создай клиентов и nullable preferences,
-- выполни LEFT JOIN,
-- различи отсутствие строки по ключу правой таблицы и NULL в её атрибуте.`,
    solution: `CREATE TEMP TABLE preference_customers(customer_id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TEMP TABLE notification_preferences(customer_id INTEGER PRIMARY KEY, channel TEXT); INSERT INTO preference_customers VALUES (1, 'Ann'), (2, 'Bob'), (3, 'Cara'); INSERT INTO notification_preferences VALUES (1, 'email'), (2, NULL); SELECT c.customer_id, c.name, p.channel, CASE WHEN p.customer_id IS NULL THEN 'no-preference-row' WHEN p.channel IS NULL THEN 'preference-without-channel' ELSE 'channel-selected' END AS preference_state FROM preference_customers c LEFT JOIN notification_preferences p ON p.customer_id = c.customer_id ORDER BY c.customer_id;`,
    hints: [
      'После LEFT JOIN ключ правой таблицы остаётся NULL только при отсутствии связанной строки.',
      'Сначала проверь p.customer_id IS NULL, затем p.channel IS NULL.',
      'Клиенты 2 и 3 должны получить разные состояния.'
    ]
  },
  'task-150': {
    title: 'Докажи, что CHECK без NOT NULL пропускает UNKNOWN',
    description: 'Создай таблицу score_policy, где score ограничен CHECK диапазоном 0..100, но не объявлен NOT NULL. Вставь известное значение и NULL, затем через данные и pragma_table_info докажи: CHECK отклоняет FALSE, но UNKNOWN от NULL проходит, пока отдельный NOT NULL-контракт отсутствует.',
    starter: `-- Напиши решение с нуля:
-- создай nullable score с CHECK диапазоном,
-- вставь NULL и допустимое значение,
-- верни число NULL и metadata-флаг NOT NULL.`,
    solution: `CREATE TEMP TABLE score_policy(sample_id INTEGER PRIMARY KEY, score INTEGER CHECK(score BETWEEN 0 AND 100)); INSERT INTO score_policy VALUES (1, 85), (2, NULL); SELECT (SELECT COUNT(*) FROM score_policy WHERE score IS NULL) AS stored_null_rows, (SELECT ti."notnull" FROM pragma_table_info('score_policy') AS ti WHERE ti.name = 'score') AS not_null_enforced, CASE WHEN (SELECT COUNT(*) FROM score_policy WHERE score IS NULL) = 1 THEN 'check-accepted-unknown' ELSE 'unexpected' END AS contract_evidence;`,
    hints: [
      'CHECK запрещает только выражение FALSE; NULL делает условие UNKNOWN.',
      'pragma_table_info показывает отдельный флаг `notnull` для колонки score.',
      'stored_null_rows должен быть 1, not_null_enforced — 0.'
    ]
  }
};

export const nullLogicAuthoredTaskEvidence: Readonly<Record<string, readonly NullLogicEvidenceTag[]>> = {
  'task-141': ['three-valued-logic', 'unknown-classification'],
  'task-142': ['where-unknown', 'explicit-null-branch'],
  'task-143': ['not-in-trap', 'null-safe-anti-join'],
  'task-144': ['null-safe-equality', 'pairwise-comparison'],
  'task-145': ['business-fallback', 'missingness-preservation', 'blank-normalization', 'nullif'],
  'task-146': ['safe-division', 'zero-denominator', 'nullif'],
  'task-147': ['aggregate-null-semantics', 'denominator-proof'],
  'task-148': ['explicit-null-order', 'deterministic-order'],
  'task-149': ['outer-join-presence', 'nullable-attribute'],
  'task-150': ['check-unknown', 'not-null-contract', 'schema-metadata']
};

export function advancedNullLogicTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedNullLogicTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedNullLogicTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}

export const nullLogicAuthoredTaskIds = Object.freeze(Object.keys(taskOverrides));
