import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type JsonSqlEvidenceTag =
  | 'json-validity'
  | 'guarded-extraction'
  | 'sql-null'
  | 'missing-path'
  | 'json-null'
  | 'json-type'
  | 'typed-extraction'
  | 'boolean-extraction'
  | 'array-expansion'
  | 'empty-array'
  | 'object-expansion'
  | 'key-type-audit'
  | 'safe-json-update'
  | 'json-remove'
  | 'json-aggregation'
  | 'deterministic-json-order'
  | 'duplicate-key-audit'
  | 'schema-version'
  | 'required-field'
  | 'quality-report';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-191': {
    title: 'Классифицируй JSON до извлечения полей',
    description: 'Раздели SQL NULL, invalid JSON и валидные object/array/scalar документы. Любая JSON-функция кроме json_valid должна вызываться только внутри ветки валидного документа, чтобы повреждённая строка не обрушила весь отчёт.',
    starter: `CREATE TEMP TABLE raw_documents(doc_id INTEGER PRIMARY KEY, document TEXT);
INSERT INTO raw_documents VALUES
  (1, NULL),
  (2, '{bad json'),
  (3, '{"service":"VPN"}'),
  (4, '[1,2]'),
  (5, '42');

SELECT doc_id,
       CASE
         WHEN  THEN 'sql-null'
         WHEN  THEN 'invalid-json'
         ELSE 'valid-' || json_type(document)
       END AS document_state
FROM raw_documents
ORDER BY doc_id;`,
    solution: `CREATE TEMP TABLE raw_documents(doc_id INTEGER PRIMARY KEY, document TEXT); INSERT INTO raw_documents VALUES (1, NULL), (2, '{bad json'), (3, '{"service":"VPN"}'), (4, '[1,2]'), (5, '42'); SELECT doc_id, CASE WHEN document IS NULL THEN 'sql-null' WHEN json_valid(document) = 0 THEN 'invalid-json' ELSE 'valid-' || json_type(document) END AS document_state FROM raw_documents ORDER BY doc_id;`,
    hints: [
      'SQL NULL проверяется до json_valid.',
      'Invalid JSON определяется json_valid(document) = 0.',
      'json_type(document) вызывается только в ELSE для валидного документа.'
    ]
  },
  'task-192': {
    title: 'Различи SQL NULL, missing path и JSON null',
    description: 'Для пути `$.value` верни отдельные состояния: SQL NULL документа, invalid JSON, отсутствующий path, явный JSON null и известное typed value. Не используй один COALESCE: он уничтожит происхождение отсутствия.',
    starter: `CREATE TEMP TABLE value_documents(doc_id INTEGER PRIMARY KEY, document TEXT);
INSERT INTO value_documents VALUES
  (1, NULL),
  (2, '{bad'),
  (3, '{}'),
  (4, '{"value":null}'),
  (5, '{"value":0}'),
  (6, '{"value":"ok"}');

SELECT doc_id,
       CASE
         WHEN  THEN 'sql-null-document'
         WHEN  THEN 'invalid-json'
         WHEN  THEN 'missing-path'
         WHEN  THEN 'json-null'
         ELSE 'value-' || json_type(document, '$.value')
       END AS value_state
FROM value_documents
ORDER BY doc_id;`,
    solution: `CREATE TEMP TABLE value_documents(doc_id INTEGER PRIMARY KEY, document TEXT); INSERT INTO value_documents VALUES (1, NULL), (2, '{bad'), (3, '{}'), (4, '{"value":null}'), (5, '{"value":0}'), (6, '{"value":"ok"}'); SELECT doc_id, CASE WHEN document IS NULL THEN 'sql-null-document' WHEN json_valid(document) = 0 THEN 'invalid-json' WHEN json_type(document, '$.value') IS NULL THEN 'missing-path' WHEN json_type(document, '$.value') = 'null' THEN 'json-null' ELSE 'value-' || json_type(document, '$.value') END AS value_state FROM value_documents ORDER BY doc_id;`,
    hints: [
      'json_type(path) возвращает SQL NULL для отсутствующего path.',
      "Явный JSON null возвращает строку type = 'null'.",
      'Порядок CASE защищает json_type от invalid JSON.'
    ]
  },
  'task-193': {
    title: 'Извлеки значения вместе с JSON-типами',
    description: 'Из валидного payload извлеки count, label и enabled, но рядом верни json_type каждого пути. Булево JSON true извлекается как 1; типовая колонка должна сохранить факт `true`, чтобы integer 1 не выглядел тем же контрактом.',
    starter: `CREATE TEMP TABLE typed_payloads(payload_id INTEGER PRIMARY KEY, document TEXT NOT NULL);
INSERT INTO typed_payloads VALUES
  (1, '{"count":3,"label":"ready","enabled":true}'),
  (2, '{"count":"3","label":7,"enabled":false}');

SELECT payload_id,
       json_extract(document, '$.count') AS count_value,
       json_type(document, '$.count') AS count_type,
       json_extract(document, '$.label') AS label_value,
       json_type(document, '$.label') AS label_type,
       json_extract(document, '$.enabled') AS enabled_value,
       json_type(document, '$.enabled') AS enabled_type
FROM typed_payloads
WHERE
ORDER BY payload_id;`,
    solution: `CREATE TEMP TABLE typed_payloads(payload_id INTEGER PRIMARY KEY, document TEXT NOT NULL); INSERT INTO typed_payloads VALUES (1, '{"count":3,"label":"ready","enabled":true}'), (2, '{"count":"3","label":7,"enabled":false}'); SELECT payload_id, json_extract(document, '$.count') AS count_value, json_type(document, '$.count') AS count_type, json_extract(document, '$.label') AS label_value, json_type(document, '$.label') AS label_type, json_extract(document, '$.enabled') AS enabled_value, json_type(document, '$.enabled') AS enabled_type FROM typed_payloads WHERE json_valid(document) = 1 ORDER BY payload_id;`,
    hints: [
      'json_extract возвращает SQL value, json_type — JSON contract type.',
      'JSON true/false извлекаются как 1/0, но type остаётся true/false.',
      'WHERE json_valid(document) = 1 делает границу явной.'
    ]
  },
  'task-194': {
    title: 'Разверни JSON array и сохрани пустые документы',
    description: 'Разверни `$.tags` через json_each, но сохрани одну summary-строку для документов с пустым, отсутствующим или неверно типизированным tags. Подменяй неподходящий path на безопасный `[]`, затем агрегируй tag_count и sorted_tags.',
    starter: `CREATE TEMP TABLE tag_documents(doc_id INTEGER PRIMARY KEY, document TEXT NOT NULL);
INSERT INTO tag_documents VALUES
  (1, '{"tags":["vpn","urgent"]}'),
  (2, '{"tags":[]}'),
  (3, '{}'),
  (4, '{"tags":"vpn"}');

WITH expanded AS (
  SELECT d.doc_id, j.value AS tag
  FROM tag_documents d
  LEFT JOIN json_each(
    CASE WHEN  THEN d.document ELSE '{"tags":[]}' END,
    '$.tags'
  ) j ON true
), ordered AS (
  SELECT doc_id, tag FROM expanded ORDER BY doc_id, tag
)
SELECT doc_id, COUNT(tag) AS tag_count, GROUP_CONCAT(tag, ',') AS sorted_tags
FROM ordered
GROUP BY doc_id
ORDER BY doc_id;`,
    solution: `CREATE TEMP TABLE tag_documents(doc_id INTEGER PRIMARY KEY, document TEXT NOT NULL); INSERT INTO tag_documents VALUES (1, '{"tags":["vpn","urgent"]}'), (2, '{"tags":[]}'), (3, '{}'), (4, '{"tags":"vpn"}'); WITH expanded AS (SELECT d.doc_id, j.value AS tag FROM tag_documents d LEFT JOIN json_each(CASE WHEN json_valid(d.document) = 1 AND json_type(d.document, '$.tags') = 'array' THEN d.document ELSE '{"tags":[]}' END, '$.tags') j ON true), ordered AS (SELECT doc_id, tag FROM expanded ORDER BY doc_id, tag) SELECT doc_id, COUNT(tag) AS tag_count, GROUP_CONCAT(tag, ',') AS sorted_tags FROM ordered GROUP BY doc_id ORDER BY doc_id;`,
    hints: [
      "Разворачивай path только если json_type(...)= 'array'.",
      'Безопасный fallback-документ содержит пустой tags array.',
      'LEFT JOIN сохраняет doc_id даже при нуле элементов.'
    ]
  },
  'task-195': {
    title: 'Проведи аудит ключей JSON object',
    description: 'Разверни object `$.metrics` и верни каждый key, JSON type и значение. Документ без object должен дать summary с key_count 0, а не ошибку. Отдельная агрегация считает numeric_keys и null_keys.',
    starter: `-- Напиши решение с нуля:
-- создай documents с metrics object, пустым object и неверным array,
-- безопасно разверни json_each,
-- посчитай key_count, numeric_keys и null_keys.`,
    solution: `CREATE TEMP TABLE metric_documents(doc_id INTEGER PRIMARY KEY, document TEXT NOT NULL); INSERT INTO metric_documents VALUES (1, '{"metrics":{"latency":120,"errors":2,"note":null}}'), (2, '{"metrics":{}}'), (3, '{"metrics":[]}'); WITH expanded AS (SELECT d.doc_id, j.key, j.type, j.value FROM metric_documents d LEFT JOIN json_each(CASE WHEN json_type(d.document, '$.metrics') = 'object' THEN d.document ELSE '{"metrics":{}}' END, '$.metrics') j ON true) SELECT doc_id, COUNT(key) AS key_count, SUM(CASE WHEN type IN ('integer','real') THEN 1 ELSE 0 END) AS numeric_keys, SUM(CASE WHEN type = 'null' THEN 1 ELSE 0 END) AS null_keys FROM expanded GROUP BY doc_id ORDER BY doc_id;`,
    hints: [
      'json_each возвращает key, value и type для каждого свойства object.',
      'Неподходящий path заменяется на пустой object.',
      'COUNT(key) остаётся нулём у сохранённой LEFT JOIN summary-строки.'
    ]
  },
  'task-196': {
    title: 'Обнови JSON без строковой конкатенации',
    description: 'Для валидных профилей установи `preferences.theme = dark`, увеличь revision и удали deprecated path. Используй json_set/json_remove; invalid JSON должен сохраниться неизменным и получить state `not-updated`.',
    starter: `CREATE TEMP TABLE profile_documents(profile_id INTEGER PRIMARY KEY, document TEXT NOT NULL);
INSERT INTO profile_documents VALUES
  (1, '{"revision":1,"preferences":{"theme":"light"},"deprecated":true}'),
  (2, '{bad');

WITH updated AS (
  SELECT profile_id,
         CASE WHEN json_valid(document) = 1 THEN
           json_remove(
             json_set(document,
               '$.preferences.theme', 'dark',
               '$.revision',
             ),
             '$.deprecated'
           )
         ELSE document END AS new_document,
         CASE WHEN json_valid(document) = 1 THEN 'updated' ELSE 'not-updated' END AS update_state
  FROM profile_documents
)
SELECT profile_id, update_state,
       CASE WHEN update_state = 'updated' THEN json_extract(new_document, '$.preferences.theme') END AS theme,
       CASE WHEN update_state = 'updated' THEN json_extract(new_document, '$.revision') END AS revision,
       CASE WHEN update_state = 'updated' THEN json_type(new_document, '$.deprecated') END AS deprecated_type
FROM updated
ORDER BY profile_id;`,
    solution: `CREATE TEMP TABLE profile_documents(profile_id INTEGER PRIMARY KEY, document TEXT NOT NULL); INSERT INTO profile_documents VALUES (1, '{"revision":1,"preferences":{"theme":"light"},"deprecated":true}'), (2, '{bad'); WITH updated AS (SELECT profile_id, CASE WHEN json_valid(document) = 1 THEN json_remove(json_set(document, '$.preferences.theme', 'dark', '$.revision', json_extract(document, '$.revision') + 1), '$.deprecated') ELSE document END AS new_document, CASE WHEN json_valid(document) = 1 THEN 'updated' ELSE 'not-updated' END AS update_state FROM profile_documents) SELECT profile_id, update_state, CASE WHEN update_state = 'updated' THEN json_extract(new_document, '$.preferences.theme') END AS theme, CASE WHEN update_state = 'updated' THEN json_extract(new_document, '$.revision') END AS revision, CASE WHEN update_state = 'updated' THEN json_type(new_document, '$.deprecated') END AS deprecated_type FROM updated ORDER BY profile_id;`,
    hints: [
      'json_set принимает path/value pairs и не требует ручной сборки JSON.',
      'Revision вычисляется из guarded valid document.',
      'json_remove удаляет path; json_type после удаления возвращает SQL NULL.'
    ]
  },
  'task-197': {
    title: 'Собери детерминированные JSON aggregates',
    description: 'Из relational rows собери по сервису JSON array ticket_ids и JSON object priority_by_ticket. Порядок входных строк должен быть зафиксирован в ordered CTE, чтобы сериализация была воспроизводимой.',
    starter: `-- Напиши решение с нуля:
-- создай tickets нескольких сервисов,
-- предварительно отсортируй по service,ticket_id,
-- собери json_group_array и json_group_object.`,
    solution: `CREATE TEMP TABLE aggregate_tickets(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL, priority TEXT NOT NULL); INSERT INTO aggregate_tickets VALUES (3, 'VPN', 'High'), (1, 'VPN', 'Critical'), (2, 'LMS', 'Low'), (4, 'LMS', 'High'); WITH ordered AS (SELECT ticket_id, service, priority FROM aggregate_tickets ORDER BY service, ticket_id) SELECT service, json_group_array(ticket_id) AS ticket_ids, json_group_object(CAST(ticket_id AS TEXT), priority) AS priority_by_ticket FROM ordered GROUP BY service ORDER BY service;`,
    hints: [
      'Aggregate input упорядочивается до GROUP BY.',
      'Ключ json_group_object явно приводится к тексту.',
      'Обе JSON-агрегации используют один ordered source set.'
    ]
  },
  'task-198': {
    title: 'Обнаружь duplicate keys вместо доверия json_extract',
    description: 'JSON object может содержать повторяющиеся labels. Разверни object через json_each и найди keys с COUNT(*) > 1; верни duplicate_count и значения в порядке появления. Не полагайся на то, какое значение выберет json_extract.',
    starter: `CREATE TEMP TABLE duplicate_documents(doc_id INTEGER PRIMARY KEY, document TEXT NOT NULL);
INSERT INTO duplicate_documents VALUES
  (1, '{"role":"user","role":"admin","active":true}'),
  (2, '{"role":"viewer","active":false}');

WITH expanded AS (
  SELECT d.doc_id, j.key, j.value, CAST(j.id AS INTEGER) AS occurrence_order
  FROM duplicate_documents d
  JOIN json_each(d.document) j
  WHERE
), grouped AS (
  SELECT doc_id, key, COUNT(*) AS duplicate_count,
         GROUP_CONCAT(value, ' > ') AS values_seen
  FROM (SELECT * FROM expanded ORDER BY doc_id, key, occurrence_order)
  GROUP BY doc_id, key
)
SELECT doc_id, key, duplicate_count, values_seen
FROM grouped
WHERE duplicate_count > 1
ORDER BY doc_id, key;`,
    solution: `CREATE TEMP TABLE duplicate_documents(doc_id INTEGER PRIMARY KEY, document TEXT NOT NULL); INSERT INTO duplicate_documents VALUES (1, '{"role":"user","role":"admin","active":true}'), (2, '{"role":"viewer","active":false}'); WITH expanded AS (SELECT d.doc_id, j.key, j.value, CAST(j.id AS INTEGER) AS occurrence_order FROM duplicate_documents d JOIN json_each(d.document) j WHERE json_valid(d.document) = 1), grouped AS (SELECT doc_id, key, COUNT(*) AS duplicate_count, GROUP_CONCAT(value, ' > ') AS values_seen FROM (SELECT * FROM expanded ORDER BY doc_id, key, occurrence_order) GROUP BY doc_id, key) SELECT doc_id, key, duplicate_count, values_seen FROM grouped WHERE duplicate_count > 1 ORDER BY doc_id, key;`,
    hints: [
      'json_each сохраняет каждое повторяющееся свойство отдельной строкой.',
      'GROUP BY doc_id,key выявляет duplicate_count.',
      'Порядок occurrence_order делает values_seen воспроизводимым.'
    ]
  },
  'task-199': {
    title: 'Проверь versioned JSON contract',
    description: 'Классифицируй документы по contract version 2: invalid, unsupported-version, missing required service, wrong service type или valid. Все path/type вызовы должны быть защищены valid JSON веткой.',
    starter: `-- Напиши решение с нуля:
-- создай документы разных versions и нарушений,
-- проверь validity, version, required path и type по порядку,
-- верни contract_state.`,
    solution: `CREATE TEMP TABLE versioned_documents(doc_id INTEGER PRIMARY KEY, document TEXT NOT NULL); INSERT INTO versioned_documents VALUES (1, '{bad'), (2, '{"version":1,"service":"VPN"}'), (3, '{"version":2}'), (4, '{"version":2,"service":7}'), (5, '{"version":2,"service":"LMS"}'); SELECT doc_id, CASE WHEN json_valid(document) = 0 THEN 'invalid-json' WHEN json_extract(document, '$.version') <> 2 OR json_type(document, '$.version') <> 'integer' THEN 'unsupported-version' WHEN json_type(document, '$.service') IS NULL THEN 'missing-service' WHEN json_type(document, '$.service') <> 'text' THEN 'wrong-service-type' ELSE 'valid-v2' END AS contract_state FROM versioned_documents ORDER BY doc_id;`,
    hints: [
      'Validity всегда проверяется первой.',
      'Version требует и значение 2, и JSON type integer.',
      'Missing path и wrong type — разные contract failures.'
    ]
  },
  'task-200': {
    title: 'Собери отчёт качества JSON-колонки',
    description: 'По смешанному набору документов посчитай SQL NULL, invalid JSON, missing `$.score`, JSON null, wrong type и valid numeric score. Категории должны быть взаимоисключающими, а reconciliation_gap — нулевым.',
    starter: `-- Напиши решение с нуля:
-- создай шесть видов документов,
-- классифицируй каждую строку guarded CASE,
-- агрегируй категории и reconciliation gap.`,
    solution: `CREATE TEMP TABLE quality_documents(doc_id INTEGER PRIMARY KEY, document TEXT); INSERT INTO quality_documents VALUES (1, NULL), (2, '{bad'), (3, '{}'), (4, '{"score":null}'), (5, '{"score":"90"}'), (6, '{"score":90}'), (7, '{"score":75.5}'); WITH classified AS (SELECT doc_id, CASE WHEN document IS NULL THEN 'sql-null' WHEN json_valid(document) = 0 THEN 'invalid-json' WHEN json_type(document, '$.score') IS NULL THEN 'missing-path' WHEN json_type(document, '$.score') = 'null' THEN 'json-null' WHEN json_type(document, '$.score') NOT IN ('integer','real') THEN 'wrong-type' ELSE 'valid-number' END AS quality_state FROM quality_documents), report AS (SELECT COUNT(*) AS total_rows, SUM(quality_state = 'sql-null') AS sql_null_rows, SUM(quality_state = 'invalid-json') AS invalid_rows, SUM(quality_state = 'missing-path') AS missing_rows, SUM(quality_state = 'json-null') AS json_null_rows, SUM(quality_state = 'wrong-type') AS wrong_type_rows, SUM(quality_state = 'valid-number') AS valid_number_rows FROM classified) SELECT total_rows, sql_null_rows, invalid_rows, missing_rows, json_null_rows, wrong_type_rows, valid_number_rows, total_rows - sql_null_rows - invalid_rows - missing_rows - json_null_rows - wrong_type_rows - valid_number_rows AS reconciliation_gap FROM report;`,
    hints: [
      'Один ordered CASE присваивает каждой строке ровно одну категорию.',
      'Numeric JSON types — integer и real.',
      'Сумма категорий должна совпасть с total_rows.'
    ]
  }
};

export const jsonSqlAuthoredTaskEvidence: Readonly<Record<string, readonly JsonSqlEvidenceTag[]>> = {
  'task-191': ['json-validity', 'guarded-extraction', 'sql-null'],
  'task-192': ['sql-null', 'missing-path', 'json-null', 'json-type'],
  'task-193': ['typed-extraction', 'boolean-extraction', 'json-type'],
  'task-194': ['array-expansion', 'empty-array', 'guarded-extraction'],
  'task-195': ['object-expansion', 'key-type-audit'],
  'task-196': ['safe-json-update', 'json-remove', 'json-validity'],
  'task-197': ['json-aggregation', 'deterministic-json-order'],
  'task-198': ['duplicate-key-audit', 'object-expansion'],
  'task-199': ['schema-version', 'required-field', 'json-type'],
  'task-200': ['quality-report', 'json-validity', 'missing-path', 'json-null']
};

export function advancedJsonSqlTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedJsonSqlTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedJsonSqlTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}

export const jsonSqlAuthoredTaskIds = Object.freeze(Object.keys(taskOverrides));
