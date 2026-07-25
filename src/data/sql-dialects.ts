export type SqlDialect = 'sqlite' | 'postgresql' | 'mysql' | 'sqlserver';

export interface DialectPattern {
  id: string;
  title: string;
  concept: string;
  portableGuidance: string;
  examples: Record<SqlDialect, string>;
  notes: Partial<Record<SqlDialect, string>>;
}

export const dialects: Array<{ id: SqlDialect; title: string; role: string }> = [
  { id: 'sqlite', title: 'SQLite', role: 'Локальная практика и offline engine SQL Academy' },
  { id: 'postgresql', title: 'PostgreSQL', role: 'Production analytics, JSON, rich SQL features' },
  { id: 'mysql', title: 'MySQL', role: 'Широко используемый web/backend SQL' },
  { id: 'sqlserver', title: 'SQL Server', role: 'Enterprise и Microsoft ecosystem' }
];

export const dialectPatterns: DialectPattern[] = [
  {
    id: 'limit-page',
    title: 'Ограничение результата',
    concept: 'Получить первые N строк после стабильной сортировки.',
    portableGuidance: 'ORDER BY обязателен для предсказуемого результата. Синтаксис ограничения отличается.',
    examples: {
      sqlite: 'SELECT * FROM tickets ORDER BY ticket_id LIMIT 10;',
      postgresql: 'SELECT * FROM tickets ORDER BY ticket_id LIMIT 10;',
      mysql: 'SELECT * FROM tickets ORDER BY ticket_id LIMIT 10;',
      sqlserver: 'SELECT TOP (10) * FROM tickets ORDER BY ticket_id;'
    },
    notes: { sqlserver: 'Для OFFSET/FETCH нужен ORDER BY.' }
  },
  {
    id: 'upsert',
    title: 'UPSERT',
    concept: 'Вставить строку или обновить её при конфликте ключа.',
    portableGuidance: 'Сначала определи conflict key и поведение при гонке. Синтаксис сильно зависит от СУБД.',
    examples: {
      sqlite: "INSERT INTO settings(key, value) VALUES('timeout','30') ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
      postgresql: "INSERT INTO settings(key, value) VALUES('timeout','30') ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value;",
      mysql: "INSERT INTO settings(`key`, value) VALUES('timeout','30') ON DUPLICATE KEY UPDATE value = VALUES(value);",
      sqlserver: "MERGE settings AS target USING (VALUES ('timeout','30')) AS source([key], value) ON target.[key] = source.[key] WHEN MATCHED THEN UPDATE SET value = source.value WHEN NOT MATCHED THEN INSERT([key], value) VALUES(source.[key], source.value);"
    },
    notes: {
      mysql: 'В новых версиях предпочтительнее alias inserted row вместо VALUES() там, где доступно.',
      sqlserver: 'MERGE требует особенно осторожного тестирования concurrency semantics.'
    }
  },
  {
    id: 'date-month',
    title: 'Группировка по месяцу',
    concept: 'Нормализовать timestamp до календарного месяца.',
    portableGuidance: 'Не сравнивай форматированный текст, если СУБД поддерживает date type/truncation.',
    examples: {
      sqlite: "SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) FROM tickets GROUP BY month;",
      postgresql: "SELECT date_trunc('month', created_at) AS month, COUNT(*) FROM tickets GROUP BY month;",
      mysql: "SELECT DATE_FORMAT(created_at, '%Y-%m-01') AS month, COUNT(*) FROM tickets GROUP BY month;",
      sqlserver: "SELECT DATEFROMPARTS(YEAR(created_at), MONTH(created_at), 1) AS month, COUNT(*) FROM tickets GROUP BY DATEFROMPARTS(YEAR(created_at), MONTH(created_at), 1);"
    },
    notes: { sqlite: 'Даты часто хранятся как ISO text, integer epoch или Julian day.' }
  },
  {
    id: 'boolean',
    title: 'Логический тип',
    concept: 'Хранить и фильтровать boolean-состояние.',
    portableGuidance: 'Не полагайся на одинаковое физическое представление TRUE/FALSE.',
    examples: {
      sqlite: 'SELECT * FROM requests WHERE approved = 1;',
      postgresql: 'SELECT * FROM requests WHERE approved IS TRUE;',
      mysql: 'SELECT * FROM requests WHERE approved = TRUE;',
      sqlserver: 'SELECT * FROM requests WHERE approved = CAST(1 AS bit);'
    },
    notes: {
      sqlite: 'Отдельного storage class BOOLEAN нет; обычно используются 0/1 и CHECK.',
      sqlserver: 'Используется тип bit.'
    }
  },
  {
    id: 'string-concat',
    title: 'Конкатенация строк',
    concept: 'Собрать display value из нескольких полей.',
    portableGuidance: 'NULL-поведение и оператор отличаются. Явно реши, должен ли NULL обнулять весь результат.',
    examples: {
      sqlite: "SELECT name || ' · ' || level FROM engineers;",
      postgresql: "SELECT name || ' · ' || level FROM engineers;",
      mysql: "SELECT CONCAT(name, ' · ', level) FROM engineers;",
      sqlserver: "SELECT CONCAT(name, ' · ', level) FROM engineers;"
    },
    notes: { mysql: 'Оператор || обычно означает OR, если не включён специальный SQL mode.' }
  },
  {
    id: 'json-extract',
    title: 'Извлечение JSON',
    concept: 'Получить scalar value по JSON path.',
    portableGuidance: 'Проверяй тип результата: JSON value, JSON text и SQL scalar — не одно и то же.',
    examples: {
      sqlite: "SELECT json_extract(payload, '$.channel') FROM ticket_events;",
      postgresql: "SELECT payload ->> 'channel' FROM ticket_events;",
      mysql: "SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.channel')) FROM ticket_events;",
      sqlserver: "SELECT JSON_VALUE(payload, '$.channel') FROM ticket_events;"
    },
    notes: {
      postgresql: 'Часто payload хранится как jsonb и индексируется GIN/expression indexes.',
      sqlite: 'JSON-функции работают поверх TEXT/BLOB representation.'
    }
  },
  {
    id: 'null-safe-equality',
    title: 'NULL-safe equality',
    concept: 'Считать два NULL равными в конкретном сравнении.',
    portableGuidance: 'Обычный `=` возвращает UNKNOWN при NULL. Используй диалектный null-safe оператор или явную логику.',
    examples: {
      sqlite: 'SELECT * FROM a JOIN b ON a.value IS b.value;',
      postgresql: 'SELECT * FROM a JOIN b ON a.value IS NOT DISTINCT FROM b.value;',
      mysql: 'SELECT * FROM a JOIN b ON a.value <=> b.value;',
      sqlserver: 'SELECT * FROM a JOIN b ON a.value = b.value OR (a.value IS NULL AND b.value IS NULL);'
    },
    notes: {}
  },
  {
    id: 'filtered-count',
    title: 'Условный COUNT',
    concept: 'Посчитать строки, удовлетворяющие условию.',
    portableGuidance: 'CASE внутри SUM/COUNT наиболее переносим. FILTER выразительнее, но поддерживается не везде.',
    examples: {
      sqlite: "SELECT COUNT(*) FILTER (WHERE status = 'Open') FROM tickets;",
      postgresql: "SELECT COUNT(*) FILTER (WHERE status = 'Open') FROM tickets;",
      mysql: "SELECT SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) FROM tickets;",
      sqlserver: "SELECT SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) FROM tickets;"
    },
    notes: { sqlite: 'Современный SQLite поддерживает FILTER для агрегатов.' }
  },
  {
    id: 'generated-id',
    title: 'Получение сгенерированного ID',
    concept: 'Вставить строку и получить созданный primary key.',
    portableGuidance: 'Не делай отдельный SELECT MAX(id). Используй атомарный механизм текущей СУБД.',
    examples: {
      sqlite: "INSERT INTO audit_log(action) VALUES('created') RETURNING id;",
      postgresql: "INSERT INTO audit_log(action) VALUES('created') RETURNING id;",
      mysql: "INSERT INTO audit_log(action) VALUES('created'); SELECT LAST_INSERT_ID();",
      sqlserver: "INSERT INTO audit_log(action) OUTPUT INSERTED.id VALUES('created');"
    },
    notes: {}
  },
  {
    id: 'explain',
    title: 'План выполнения',
    concept: 'Получить план доступа и соединений.',
    portableGuidance: 'Названия операторов и формат плана различаются; ищи scans, seeks/searches, join order и cardinality estimates.',
    examples: {
      sqlite: "EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE service = 'VPN';",
      postgresql: "EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM tickets WHERE service = 'VPN';",
      mysql: "EXPLAIN ANALYZE SELECT * FROM tickets WHERE service = 'VPN';",
      sqlserver: "SET STATISTICS XML ON; SELECT * FROM tickets WHERE service = 'VPN'; SET STATISTICS XML OFF;"
    },
    notes: { postgresql: 'ANALYZE выполняет запрос; на изменяющих запросах нужна особая осторожность.' }
  }
];

export function dialectPatternById(id: string) {
  return dialectPatterns.find(pattern => pattern.id === id);
}
