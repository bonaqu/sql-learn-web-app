export type ErrorAtlasCategory = 'syntax' | 'runtime' | 'logical' | 'performance';

export type ErrorAtlasEntry = {
  id: string;
  category: ErrorAtlasCategory;
  title: string;
  symptom: string;
  cause: string;
  checks: string[];
  brokenSql: string;
  fixedSql: string;
  rule: string;
};

export const errorAtlas: ErrorAtlasEntry[] = [
  {
    id: 'syntax-trailing-comma',
    category: 'syntax',
    title: 'Лишняя запятая перед FROM',
    symptom: 'SQLite сообщает near "FROM": syntax error.',
    cause: 'SELECT-список закончился запятой, поэтому parser ждёт ещё одно выражение.',
    checks: ['Смотри на token в сообщении.', 'Проверь символ перед ним.', 'Сократи запрос до минимального SELECT.'],
    brokenSql: 'SELECT ticket_id, service, FROM tickets;',
    fixedSql: 'SELECT ticket_id, service FROM tickets ORDER BY ticket_id;',
    rule: 'Syntax error часто вызван token, который стоит непосредственно перед указанным местом.'
  },
  {
    id: 'syntax-clause-order',
    category: 'syntax',
    title: 'Неверный порядок clauses',
    symptom: 'Parser падает около WHERE, GROUP BY или ORDER BY.',
    cause: 'Синтаксический порядок SELECT → FROM → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT нарушен.',
    checks: ['Разнеси clauses по строкам.', 'Сверь их порядок.', 'Не ставь HAVING до GROUP BY.'],
    brokenSql: "SELECT service, COUNT(*) FROM tickets ORDER BY service WHERE status = 'Closed' GROUP BY service;",
    fixedSql: "SELECT service, COUNT(*) FROM tickets WHERE status = 'Closed' GROUP BY service ORDER BY service;",
    rule: 'Clause имеет фиксированное место независимо от порядка, в котором ты придумал запрос.'
  },
  {
    id: 'runtime-unknown-column',
    category: 'runtime',
    title: 'no such column',
    symptom: 'Запрос распарсился, но база не находит столбец.',
    cause: 'Опечатка, неверный alias либо поле принадлежит другой таблице.',
    checks: ['Открой PRAGMA table_info.', 'Проверь alias в FROM/JOIN.', 'Квалифицируй поле через alias.column.'],
    brokenSql: 'SELECT t.owner_id FROM tickets t;',
    fixedSql: 'SELECT t.engineer_id FROM tickets t ORDER BY t.ticket_id;',
    rule: 'Runtime schema error лечится чтением реальной схемы, а не угадыванием названия.'
  },
  {
    id: 'runtime-ambiguous-column',
    category: 'runtime',
    title: 'ambiguous column name',
    symptom: 'После JOIN база не понимает, из какой таблицы взять одинаково названное поле.',
    cause: 'Столбец есть в нескольких источниках, но выбран без alias.',
    checks: ['Найди одинаковые имена.', 'Дай таблицам короткие alias.', 'Квалифицируй SELECT и ORDER BY.'],
    brokenSql: 'SELECT customer_id FROM customers c JOIN tickets t ON t.customer_id = c.customer_id;',
    fixedSql: 'SELECT c.customer_id FROM customers c JOIN tickets t ON t.customer_id = c.customer_id ORDER BY c.customer_id;',
    rule: 'После JOIN предпочитай явный alias даже там, где база пока может догадаться.'
  },
  {
    id: 'logical-not-in-null',
    category: 'logical',
    title: 'NOT IN и NULL дают UNKNOWN',
    symptom: 'Запрос выполняется, но неожиданно возвращает ноль строк.',
    cause: 'NULL в подзапросе превращает сравнение NOT IN в UNKNOWN.',
    checks: ['Запусти подзапрос отдельно.', 'Посчитай NULL в ключе.', 'Перепиши через NOT EXISTS.'],
    brokenSql: 'SELECT customer_id FROM customers WHERE customer_id NOT IN (SELECT customer_id FROM tickets);',
    fixedSql: 'SELECT c.customer_id FROM customers c WHERE NOT EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.customer_id) ORDER BY c.customer_id;',
    rule: 'Для anti-join по nullable источнику безопаснее NOT EXISTS.'
  },
  {
    id: 'logical-left-join-filter',
    category: 'logical',
    title: 'WHERE превратил LEFT JOIN в INNER',
    symptom: 'Строки без совпадения справа исчезли.',
    cause: 'Условие по правой таблице в WHERE отклоняет NULL-extended строки.',
    checks: ['Определи, фильтруешь совпадение или результат.', 'Перенеси условие в ON.', 'Сравни counts до и после JOIN.'],
    brokenSql: "SELECT c.customer_id, t.ticket_id FROM customers c LEFT JOIN tickets t ON t.customer_id = c.customer_id WHERE t.status = 'Open';",
    fixedSql: "SELECT c.customer_id, t.ticket_id FROM customers c LEFT JOIN tickets t ON t.customer_id = c.customer_id AND t.status = 'Open' ORDER BY c.customer_id, t.ticket_id;",
    rule: 'Фильтр в ON ограничивает совпадения; фильтр в WHERE ограничивает итоговые строки.'
  },
  {
    id: 'logical-join-multiplication',
    category: 'logical',
    title: 'JOIN размножил строки',
    symptom: 'COUNT или SUM стали больше ожидаемого.',
    cause: 'Обе стороны имеют несколько строк на ключ, и JOIN создаёт комбинации.',
    checks: ['Назови grain обеих сторон.', 'Посчитай строки на join key.', 'Предагрегируй many-side либо используй EXISTS.'],
    brokenSql: 'SELECT t.service, COUNT(*) FROM tickets t JOIN ticket_events e ON e.ticket_id = t.ticket_id GROUP BY t.service;',
    fixedSql: 'SELECT service, COUNT(*) AS tickets_count FROM tickets GROUP BY service ORDER BY tickets_count DESC, service;',
    rule: 'До JOIN проговори ожидаемую кардинальность one-to-one, one-to-many или many-to-many.'
  },
  {
    id: 'logical-unstable-limit',
    category: 'logical',
    title: 'LIMIT без стабильной сортировки',
    symptom: 'Одинаковый запрос может показать другой набор строк.',
    cause: 'SQL не гарантирует естественный порядок, а основной sort key может иметь ties.',
    checks: ['Добавь ORDER BY.', 'Добавь уникальный tie-breaker.', 'Проверь направление каждого ключа.'],
    brokenSql: 'SELECT ticket_id, resolution_minutes FROM tickets LIMIT 5;',
    fixedSql: 'SELECT ticket_id, resolution_minutes FROM tickets ORDER BY resolution_minutes DESC, ticket_id ASC LIMIT 5;',
    rule: 'Pagination и top-N обязаны иметь полный детерминированный ORDER BY.'
  },
  {
    id: 'performance-full-scan',
    category: 'performance',
    title: 'Полный scan вместо индекса',
    symptom: 'EXPLAIN QUERY PLAN показывает SCAN tickets на селективном фильтре.',
    cause: 'Нет подходящего индекса либо выражение не совпадает с индексированным столбцом.',
    checks: ['Запусти EXPLAIN QUERY PLAN.', 'Проверь WHERE/JOIN/ORDER BY.', 'Сопоставь порядок полей индекса.'],
    brokenSql: "EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE lower(service) = 'vpn';",
    fixedSql: "EXPLAIN QUERY PLAN SELECT ticket_id, status FROM tickets WHERE service = 'VPN';",
    rule: 'Не добавляй индекс наугад: сначала зафиксируй query shape и план.'
  },
  {
    id: 'performance-deep-offset',
    category: 'performance',
    title: 'Глубокий OFFSET',
    symptom: 'Поздние страницы становятся всё медленнее.',
    cause: 'База всё равно проходит и отбрасывает предыдущие строки.',
    checks: ['Задай полный ORDER BY.', 'Сохрани последний sort key.', 'Используй keyset predicate.'],
    brokenSql: 'SELECT ticket_id, created_at FROM tickets ORDER BY created_at, ticket_id LIMIT 20 OFFSET 100000;',
    fixedSql: "SELECT ticket_id, created_at FROM tickets WHERE created_at > '2026-07-03 00:00:00' OR (created_at = '2026-07-03 00:00:00' AND ticket_id > 1005) ORDER BY created_at, ticket_id LIMIT 20;",
    rule: 'Cursor должен содержать все поля стабильной сортировки.'
  },
  {
    id: 'performance-over-indexing',
    category: 'performance',
    title: 'Индекс на всё подряд',
    symptom: 'Чтение почти не ускорилось, а INSERT/UPDATE и размер базы ухудшились.',
    cause: 'Индекс не соответствует частому query pattern либо имеет низкую селективность.',
    checks: ['Собери реальные запросы.', 'Сравни план до/после.', 'Удали дублирующие индексы.'],
    brokenSql: 'CREATE INDEX idx_tickets_status ON tickets(status);',
    fixedSql: "EXPLAIN QUERY PLAN SELECT ticket_id FROM tickets WHERE priority = 'Critical' AND status = 'Closed';",
    rule: 'У индекса должен быть конкретный потребитель и измеримый эффект.'
  },
  {
    id: 'performance-select-star',
    category: 'performance',
    title: 'SELECT * в рабочем контракте',
    symptom: 'Передаются лишние данные и ломается возможность покрывающего индекса.',
    cause: 'Запрос не фиксирует, какие поля реально нужны потребителю.',
    checks: ['Опиши форму результата.', 'Перечисли используемые поля.', 'Проверь, нужен ли тяжёлый payload.'],
    brokenSql: "SELECT * FROM tickets WHERE service = 'VPN';",
    fixedSql: "SELECT ticket_id, status, priority FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;",
    rule: 'SELECT-список — часть контракта и оптимизации, а не косметика.'
  }
];
