import type { Difficulty, ModuleGuide, SqlTask, TaskMode } from './course';

export const advancedModules = [
  ['dml', 'DML и безопасные изменения', 'INSERT, UPDATE, DELETE, UPSERT и контроль результата'],
  ['schema-evolution', 'Views и развитие схемы', 'Ограничения, представления и безопасная эволюция'],
  ['null-logic-advanced', 'NULL: продвинутая логика', 'UNKNOWN, COALESCE, NULLIF и null-safe patterns'],
  ['conditional-aggregation', 'Условные метрики', 'CASE внутри агрегатов, доли и cohort-style отчёты'],
  ['advanced-joins', 'Semi, anti и relational division', 'EXISTS, NOT EXISTS и запросы «для всех»'],
  ['recursive-cte', 'Рекурсивные CTE', 'Иерархии, пути, уровни и защита от циклов'],
  ['window-frames', 'Оконные frames', 'Running totals, moving windows, gaps and islands'],
  ['json-sql', 'JSON в SQL', 'Извлечение, фильтрация и агрегация semi-structured данных'],
  ['sql-security', 'Безопасность SQL', 'Параметризация, injection patterns и least privilege'],
  ['concurrency', 'Конкурентность и изоляция', 'Savepoint, lost update, write safety и retry reasoning'],
  ['pagination-patterns', 'Production pagination', 'Keyset pagination, stable cursors и большие выборки'],
  ['incident-investigation', 'SQL-расследование инцидента', 'Профилирование, гипотезы, доказательства и итоговый отчёт']
] as const;

export type AdvancedModuleId = typeof advancedModules[number][0];

const guide = (
  summary: string,
  mentalModel: string,
  example: string,
  checklist: string[],
  commonMistakes: string[]
): ModuleGuide => ({ summary, mentalModel, example, checklist, commonMistakes });

export const advancedGuides: Record<AdvancedModuleId, ModuleGuide> = {
  dml: guide(
    'Изменяем данные так, чтобы область воздействия была проверяемой и обратимой.',
    'Любое изменение состоит из target set, mutation и verification. Сначала докажи SELECT-ом, какие строки изменятся, затем выполни DML в транзакции.',
    "BEGIN; UPDATE tickets SET status = 'Closed' WHERE ticket_id = 1002; SELECT changes(); ROLLBACK;",
    ['Собери target SELECT', 'Оцени число строк', 'Используй транзакцию', 'Проверь итог', 'COMMIT или ROLLBACK явно'],
    ['UPDATE/DELETE без WHERE', 'UPSERT без понимания conflict key', 'Нет проверки changes()', 'Смешивание нескольких целей в одном изменении']
  ),
  'schema-evolution': guide(
    'Закрепляем правила данных в схеме и даём потребителям стабильные представления.',
    'Таблица хранит факты, constraint запрещает невозможное состояние, view фиксирует безопасный контракт чтения.',
    "CREATE TEMP VIEW closed_tickets AS SELECT * FROM tickets WHERE status = 'Closed';",
    ['Определи инвариант', 'Выбери constraint', 'Спроектируй обратимую миграцию', 'Сохрани совместимость view', 'Проверь schema metadata'],
    ['Правила только в UI', 'Breaking rename без compatibility layer', 'View с SELECT *', 'Миграция без проверки существующих данных']
  ),
  'null-logic-advanced': guide(
    'Управляем UNKNOWN явно, не превращая NULL автоматически в пустую строку или ноль.',
    'NULL означает неизвестность или неприменимость. Выбирай поведение отдельно для фильтра, вычисления, сортировки и агрегата.',
    "SELECT customer_id, COALESCE(email, 'missing') FROM customers;",
    ['Определи смысл NULL', 'Проверь TRUE/FALSE/UNKNOWN', 'Используй IS NULL', 'Применяй COALESCE осознанно', 'Тестируй пустые строки отдельно'],
    ['= NULL', 'NOT IN при возможном NULL', 'COALESCE без business meaning', 'Смешивание NULL и пустой строки']
  ),
  'conditional-aggregation': guide(
    'Строим несколько согласованных метрик по одному набору строк.',
    'Сначала фиксируется denominator, затем каждый CASE формирует отдельный numerator внутри той же группы.',
    "SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END)",
    ['Зафиксируй набор строк', 'Назови denominator', 'Определи каждый CASE', 'Избегай integer division', 'Добавь контрольные counts'],
    ['Разные фильтры у числителя и знаменателя', 'Деление INTEGER', 'ELSE NULL вместо ELSE 0 без причины', 'Процент без периода']
  ),
  'advanced-joins': guide(
    'Выражаем existence-условия без случайного размножения строк.',
    'EXISTS и NOT EXISTS отвечают на вопрос о наличии связи. Relational division отвечает на вопрос «есть связи со всеми требуемыми значениями».',
    'WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.customer_id)',
    ['Сформулируй existence question', 'Выбери EXISTS/NOT EXISTS', 'Свяжи коррелированные ключи', 'Проверь дубли', 'Для «всех» сравни количества множеств'],
    ['LEFT JOIN + IS NULL без проверки кардинальности', 'NOT IN с NULL', 'COUNT(*) после many-to-many', 'DISTINCT как маскировка ошибки']
  ),
  'recursive-cte': guide(
    'Обходим иерархию через anchor и recursive step.',
    'Anchor создаёт первый уровень. Recursive member добавляет следующий уровень, пока новые строки существуют или не достигнут guard limit.',
    'WITH RECURSIVE tree AS (SELECT ... UNION ALL SELECT ... FROM tree JOIN ...) SELECT * FROM tree;',
    ['Определи anchor', 'Определи переход parent→child', 'Добавь depth', 'Защити от циклов', 'Задай стабильный вывод'],
    ['Нет условия остановки', 'UNION ALL при циклических данных без path guard', 'Перепутаны parent/child', 'Потеря корневой строки']
  ),
  'window-frames': guide(
    'Считаем метрики по соседним строкам без потери детализации.',
    'PARTITION задаёт независимые последовательности, ORDER BY — направление, frame — какие строки вокруг текущей участвуют в расчёте.',
    'SUM(value) OVER (PARTITION BY key ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)',
    ['Определи partition', 'Задай детерминированный order', 'Выбери ROWS/RANGE', 'Укажи границы frame', 'Проверь ties'],
    ['Frame по умолчанию без понимания', 'ORDER BY неуникален', 'RANGE вместо ROWS', 'Оконный результат фильтруется в том же SELECT без subquery']
  ),
  'json-sql': guide(
    'Извлекаем JSON-поля, сохраняя различие отсутствующего ключа, JSON null и SQL NULL.',
    'JSON — строковое представление структуры. Сначала проверь json_valid, затем извлекай типизированные поля и только после этого агрегируй.',
    "SELECT json_extract(payload, '$.channel') FROM ticket_events;",
    ['Проверь json_valid', 'Укажи точный path', 'Проверь json_type', 'Нормализуй извлечённый тип', 'Не индексируй произвольный path без измерения'],
    ['Предполагать одинаковую схему всех payload', 'Путать JSON null и SQL NULL', 'Сравнивать числа как текст', 'Извлекать поле многократно вместо CTE']
  ),
  'sql-security': guide(
    'Отделяем SQL-код от пользовательских данных и сокращаем полномочия.',
    'Параметризация передаёт структуру запроса отдельно от значений. Whitelist применяется к идентификаторам, которые нельзя bind-ить как обычные значения.',
    'SELECT * FROM tickets WHERE ticket_id = ?;',
    ['Bind values', 'Whitelist identifiers', 'Не логируй секреты', 'Ограничь роль', 'Проверяй dynamic SQL'],
    ['Конкатенация ввода', 'Экранирование как единственная защита', 'Приложение под owner-role', 'Секреты в query logs']
  ),
  concurrency: guide(
    'Рассуждаем о том, что может измениться между чтением и записью.',
    'Transaction boundary защищает группу действий, но isolation level определяет, какие параллельные изменения видны и какие конфликты возможны.',
    'SAVEPOINT before_change; UPDATE ...; ROLLBACK TO before_change;',
    ['Определи invariant', 'Назови read/write set', 'Выбери transaction boundary', 'Предусмотри conflict/retry', 'Делай операции idempotent'],
    ['Read-modify-write без версии', 'Долгая транзакция', 'Автоматический retry неидемпотентной операции', 'Игнорирование deadlock/locked errors']
  ),
  'pagination-patterns': guide(
    'Получаем стабильные страницы без дорогого OFFSET на больших наборах.',
    'Keyset cursor хранит последние значения полного ORDER BY. Следующая страница использует строгий предикат после этого ключа.',
    'WHERE (created_at, ticket_id) > (?, ?) ORDER BY created_at, ticket_id LIMIT 20',
    ['Задай полный стабильный order', 'Cursor содержит все sort keys', 'Используй строгий >/<', 'Сохрани направление', 'Проверь новые строки между страницами'],
    ['Cursor только по неуникальному полю', 'OFFSET на глубокой странице', 'Смена сортировки между запросами', '>= вызывает повтор строки']
  ),
  'incident-investigation': guide(
    'Строим доказуемое SQL-расследование от симптома к проверяемой причине.',
    'Каждый запрос либо измеряет масштаб, либо проверяет гипотезу, либо локализует конкретные строки. Итоговый вывод должен быть воспроизводим.',
    'WITH baseline AS (...), anomaly AS (...) SELECT ...;',
    ['Зафиксируй период', 'Сними baseline', 'Проверь качество данных', 'Разрежь по измерениям', 'Сохрани evidence query'],
    ['Сразу искать виноватую строку', 'Менять данные во время диагностики', 'Вывод по одному среднему', 'Нет контрольной группы']
  )
};

const modes: TaskMode[] = ['lesson', 'practice', 'interview', 'puzzle'];
const difficulties: Difficulty[] = ['Рабочий', 'Продвинутый', 'Экспертный'];
const services = ['VPN', 'LMS', 'VDI', 'Email', 'Access'];
const priorities = ['Critical', 'High', 'Medium', 'Low'];

type TaskRecipe = (variant: number) => Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

const recipes: Record<AdvancedModuleId, TaskRecipe> = {
  dml: variant => {
    const service = services[variant % services.length];
    return {
      title: `UPSERT настройки сервиса ${service} · ${variant + 1}`,
      description: `Создай временную таблицу service_settings, добавь timeout для ${service}, затем UPSERT-ом увеличь его и верни итоговую строку.`,
      starter: `CREATE TEMP TABLE service_settings(service TEXT PRIMARY KEY, timeout_minutes INTEGER NOT NULL);\nINSERT INTO service_settings VALUES ('${service}', ${30 + variant});\n\n-- UPSERT\n\nSELECT service, timeout_minutes FROM service_settings ORDER BY service;`,
      solution: `CREATE TEMP TABLE service_settings(service TEXT PRIMARY KEY, timeout_minutes INTEGER NOT NULL); INSERT INTO service_settings VALUES ('${service}', ${30 + variant}); INSERT INTO service_settings(service, timeout_minutes) VALUES ('${service}', ${45 + variant}) ON CONFLICT(service) DO UPDATE SET timeout_minutes = excluded.timeout_minutes; SELECT service, timeout_minutes FROM service_settings ORDER BY service;`,
      hints: ['Conflict key — service.', 'Используй ON CONFLICT(service) DO UPDATE.', `Итоговый timeout: ${45 + variant}.`]
    };
  },
  'schema-evolution': variant => {
    const limit = 60 + variant * 15;
    return {
      title: `Совместимое view SLA · ${variant + 1}`,
      description: `Создай TEMP VIEW strict_sla_${variant + 1}, которое возвращает ticket_id, service и sla_minutes только для SLA не больше ${limit}.`,
      starter: `CREATE TEMP VIEW strict_sla_${variant + 1} AS\nSELECT \nFROM tickets\nWHERE ;\n\nSELECT * FROM strict_sla_${variant + 1} ORDER BY ticket_id;`,
      solution: `CREATE TEMP VIEW strict_sla_${variant + 1} AS SELECT ticket_id, service, sla_minutes FROM tickets WHERE sla_minutes <= ${limit}; SELECT ticket_id, service, sla_minutes FROM strict_sla_${variant + 1} ORDER BY ticket_id;`,
      hints: ['Не используй SELECT * внутри view.', `Фильтр sla_minutes <= ${limit}.`, 'После CREATE VIEW выполни контрольный SELECT.']
    };
  },
  'null-logic-advanced': variant => {
    const fallback = `missing-${variant + 1}`;
    return {
      title: `NULL-safe контакты · ${variant + 1}`,
      description: `Верни customer_id и contact_email. Для NULL или пустой строки используй '${fallback}'.`,
      starter: `SELECT\n  customer_id,\n  \nFROM customers\nORDER BY customer_id;`,
      solution: `SELECT customer_id, COALESCE(NULLIF(TRIM(email), ''), '${fallback}') AS contact_email FROM customers ORDER BY customer_id;`,
      hints: ['TRIM убирает пробелы.', "NULLIF(..., '') превращает пустую строку в NULL.", 'COALESCE задаёт fallback.']
    };
  },
  'conditional-aggregation': variant => {
    const priority = priorities[variant % priorities.length];
    const minimumSla = 45 + variant * 15;
    return {
      title: `Доля ${priority} при SLA ≥ ${minimumSla} · ${variant + 1}`,
      description: `По каждому сервису среди обращений с SLA не меньше ${minimumSla} посчитай все строки, обращения ${priority} и их процент с одним знаком.`,
      starter: `SELECT\n  service,\n  COUNT(*) AS total_count,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS target_count,\n  ROUND(100.0 *  / COUNT(*), 1) AS target_rate\nFROM tickets\nWHERE sla_minutes >= ${minimumSla}\nGROUP BY service\nORDER BY target_rate DESC, service;`,
      solution: `SELECT service, COUNT(*) AS total_count, SUM(CASE WHEN priority = '${priority}' THEN 1 ELSE 0 END) AS target_count, ROUND(100.0 * SUM(CASE WHEN priority = '${priority}' THEN 1 ELSE 0 END) / COUNT(*), 1) AS target_rate FROM tickets WHERE sla_minutes >= ${minimumSla} GROUP BY service ORDER BY target_rate DESC, service;`,
      hints: [`Сначала ограничь sla_minutes >= ${minimumSla}.`, `CASE проверяет priority = '${priority}'.`, '100.0 предотвращает integer division.']
    };
  },
  'advanced-joins': variant => {
    const status = variant % 2 ? 'Open' : 'Closed';
    const minimumCustomerId = variant + 1;
    return {
      title: `Клиенты #${minimumCustomerId}+ без ${status}-обращений`,
      description: `Среди клиентов с customer_id >= ${minimumCustomerId} найди тех, у кого нет ни одного обращения со status = '${status}'.`,
      starter: `SELECT c.customer_id, c.region\nFROM customers c\nWHERE c.customer_id >= ${minimumCustomerId}\n  AND \nORDER BY c.customer_id;`,
      solution: `SELECT c.customer_id, c.region FROM customers c WHERE c.customer_id >= ${minimumCustomerId} AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.customer_id AND t.status = '${status}') ORDER BY c.customer_id;`,
      hints: [`Внешний фильтр customer_id >= ${minimumCustomerId}.`, 'Используй NOT EXISTS.', `Внутренний фильтр status = '${status}'.`]
    };
  },
  'recursive-cte': variant => {
    const root = (variant % 9) + 1;
    const maxDepth = variant + 1;
    return {
      title: `Дерево от узла ${root} до depth ${maxDepth}`,
      description: `Через WITH RECURSIVE верни service_id, name и depth для узла ${root} и потомков не глубже ${maxDepth}.`,
      starter: `WITH RECURSIVE service_path(service_id, name, depth) AS (\n  SELECT service_id, name, 0\n  FROM service_tree\n  WHERE service_id = ${root}\n  UNION ALL\n  SELECT \n  FROM service_tree child\n  JOIN service_path parent ON \n  WHERE parent.depth < ${maxDepth}\n)\nSELECT * FROM service_path ORDER BY depth, service_id;`,
      solution: `WITH RECURSIVE service_path(service_id, name, depth) AS (SELECT service_id, name, 0 FROM service_tree WHERE service_id = ${root} UNION ALL SELECT child.service_id, child.name, parent.depth + 1 FROM service_tree child JOIN service_path parent ON child.parent_id = parent.service_id WHERE parent.depth < ${maxDepth}) SELECT service_id, name, depth FROM service_path ORDER BY depth, service_id;`,
      hints: ['Recursive step выбирает child.', 'child.parent_id = parent.service_id.', `Guard: parent.depth < ${maxDepth}.`]
    };
  },
  'window-frames': variant => {
    const width = (variant % 3) + 1;
    const minimumEventId = variant + 1;
    return {
      title: `Moving window ${width + 1} с event #${minimumEventId}+`,
      description: `Для ticket_events с event_id >= ${minimumEventId} посчитай moving_count по ticket_id в окне текущая строка + ${width} предыдущих.`,
      starter: `SELECT\n  ticket_id,\n  event_id,\n  COUNT(*) OVER (\n    PARTITION BY ticket_id\n    ORDER BY event_at, event_id\n    ROWS BETWEEN  PRECEDING AND CURRENT ROW\n  ) AS moving_count\nFROM ticket_events\nWHERE event_id >= ${minimumEventId}\nORDER BY ticket_id, event_at, event_id;`,
      solution: `SELECT ticket_id, event_id, COUNT(*) OVER (PARTITION BY ticket_id ORDER BY event_at, event_id ROWS BETWEEN ${width} PRECEDING AND CURRENT ROW) AS moving_count FROM ticket_events WHERE event_id >= ${minimumEventId} ORDER BY ticket_id, event_at, event_id;`,
      hints: [`Сначала event_id >= ${minimumEventId}.`, `Frame начинается ${width} PRECEDING.`, 'event_id — tie-breaker.']
    };
  },
  'json-sql': variant => {
    const channel = ['web', 'email', 'chat'][variant % 3];
    const minimumEventId = variant + 1;
    return {
      title: `JSON ${channel} с event #${minimumEventId}+`,
      description: `Верни event_id, ticket_id и channel из JSON payload для channel '${channel}' и event_id >= ${minimumEventId}.`,
      starter: `SELECT\n  event_id,\n  ticket_id,\n  \nFROM ticket_events\nWHERE json_valid(payload)\n  AND \n  AND event_id >= ${minimumEventId}\nORDER BY event_id;`,
      solution: `SELECT event_id, ticket_id, json_extract(payload, '$.channel') AS channel FROM ticket_events WHERE json_valid(payload) AND json_extract(payload, '$.channel') = '${channel}' AND event_id >= ${minimumEventId} ORDER BY event_id;`,
      hints: ['Сначала json_valid(payload).', `Сравни channel с '${channel}'.`, `Добавь event_id >= ${minimumEventId}.`]
    };
  },
  'sql-security': variant => {
    const risk = variant % 2;
    const minimumSampleId = variant + 1;
    return {
      title: `Аудит риска ${risk} с sample #${minimumSampleId}+`,
      description: `Верни sample_id и input_text для request_samples с risk_level = ${risk} и sample_id >= ${minimumSampleId}, а также quote().`,
      starter: `SELECT\n  sample_id,\n  input_text,\n  \nFROM request_samples\nWHERE risk_level = ${risk}\n  AND \nORDER BY sample_id;`,
      solution: `SELECT sample_id, input_text, quote(input_text) AS quoted_value FROM request_samples WHERE risk_level = ${risk} AND sample_id >= ${minimumSampleId} ORDER BY sample_id;`,
      hints: ['quote(input_text) показывает SQL literal representation.', `Фильтр risk_level = ${risk}.`, `Добавь sample_id >= ${minimumSampleId}.`]
    };
  },
  concurrency: variant => {
    const delta = 5 + variant;
    return {
      title: `Savepoint rehearsal +${delta} · ${variant + 1}`,
      description: `Создай временный счётчик, увеличь его на ${delta} внутри SAVEPOINT, откати к savepoint и верни исходное значение.`,
      starter: `CREATE TEMP TABLE counters(id INTEGER PRIMARY KEY, value INTEGER NOT NULL);\nINSERT INTO counters VALUES (1, 100);\nBEGIN;\nSAVEPOINT before_change;\nUPDATE counters SET value = value + ${delta} WHERE id = 1;\n\nSELECT id, value FROM counters;\nCOMMIT;`,
      solution: `CREATE TEMP TABLE counters(id INTEGER PRIMARY KEY, value INTEGER NOT NULL); INSERT INTO counters VALUES (1, 100); BEGIN; SAVEPOINT before_change; UPDATE counters SET value = value + ${delta} WHERE id = 1; ROLLBACK TO before_change; RELEASE before_change; SELECT id, value FROM counters; COMMIT;`,
      hints: ['ROLLBACK TO before_change отменяет изменение.', 'После отката RELEASE savepoint.', 'Итоговое value должно быть 100.']
    };
  },
  'pagination-patterns': variant => {
    const cursor = 1000 + variant;
    const limit = (variant % 4) + 2;
    return {
      title: `Keyset после #${cursor} · ${variant + 1}`,
      description: `Верни следующие ${limit} обращений после ticket_id ${cursor} без OFFSET.`,
      starter: `SELECT ticket_id, service, status\nFROM tickets\nWHERE \nORDER BY ticket_id\nLIMIT ${limit};`,
      solution: `SELECT ticket_id, service, status FROM tickets WHERE ticket_id > ${cursor} ORDER BY ticket_id ASC LIMIT ${limit};`,
      hints: [`Строгий cursor predicate: ticket_id > ${cursor}.`, 'ORDER BY совпадает с cursor key.', `LIMIT ${limit}.`]
    };
  },
  'incident-investigation': variant => {
    const service = services[variant % services.length];
    const day = String((variant % 6) + 1).padStart(2, '0');
    const since = `2026-07-${day}`;
    return {
      title: `Профиль ${service} с ${since}`,
      description: `Для сервиса ${service} с даты ${since} верни total, open_count, closed_count, null_resolution и avg_closed_minutes.`,
      starter: `SELECT\n  COUNT(*) AS total,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS open_count,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS closed_count,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS null_resolution,\n  ROUND(AVG(CASE WHEN  THEN resolution_minutes END), 1) AS avg_closed_minutes\nFROM tickets\nWHERE service = '${service}'\n  AND date(created_at) >= '${since}';`,
      solution: `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open_count, SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closed_count, SUM(CASE WHEN resolution_minutes IS NULL THEN 1 ELSE 0 END) AS null_resolution, ROUND(AVG(CASE WHEN status = 'Closed' THEN resolution_minutes END), 1) AS avg_closed_minutes FROM tickets WHERE service = '${service}' AND date(created_at) >= '${since}';`,
      hints: [`Фильтр service = '${service}'.`, `Период начинается с ${since}.`, 'AVG получает только Closed значения.']
    };
  }
};

export const advancedTasks: SqlTask[] = advancedModules.flatMap(([module, topic], moduleIndex) =>
  Array.from({ length: 10 }, (_, taskIndex) => {
    const globalIndex = 120 + moduleIndex * 10 + taskIndex;
    return {
      id: `task-${String(globalIndex + 1).padStart(3, '0')}`,
      module,
      topic,
      difficulty: difficulties[Math.min(difficulties.length - 1, Math.floor(moduleIndex / 4))],
      mode: modes[(globalIndex + taskIndex) % modes.length],
      xp: 120 + (globalIndex % 7) * 20,
      guide: advancedGuides[module],
      evaluationPolicy: 'disposable-script',
      ...recipes[module](taskIndex)
    };
  })
);
