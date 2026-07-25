export type TaskMode = 'lesson' | 'practice' | 'interview' | 'puzzle';
export type Difficulty = 'База' | 'Рабочий' | 'Продвинутый' | 'Экспертный';

export interface ModuleGuide {
  summary: string;
  mentalModel: string;
  example: string;
  checklist: string[];
  commonMistakes: string[];
}

export interface SqlTask {
  id: string;
  module: string;
  title: string;
  description: string;
  topic: string;
  difficulty: Difficulty;
  mode: TaskMode;
  xp: number;
  starter: string;
  solution: string;
  hints: string[];
  guide: ModuleGuide;
}

export const modules = [
  ['sql-thinking', 'SQL-мышление', 'Как читать схему и превращать вопрос в запрос'],
  ['select', 'SELECT и выражения', 'Поля, псевдонимы, вычисления и DISTINCT'],
  ['filtering', 'Фильтрация', 'WHERE, NULL, LIKE, BETWEEN, IN'],
  ['sorting', 'Сортировка и лимиты', 'ORDER BY, LIMIT, OFFSET'],
  ['aggregates', 'Агрегации', 'COUNT, SUM, AVG, MIN, MAX'],
  ['grouping', 'GROUP BY и HAVING', 'Группы, фильтрация групп и отчёты'],
  ['joins', 'Связи таблиц', 'INNER, LEFT, self join и анти-join'],
  ['subqueries', 'Подзапросы', 'Скалярные, коррелированные и EXISTS'],
  ['cte', 'CTE и этапы запроса', 'Читаемые этапы и рекурсивные запросы'],
  ['windows', 'Оконные функции', 'RANK, LAG, LEAD и накопительные итоги'],
  ['dates', 'Дата и время', 'Периоды, интервалы и временные отчёты'],
  ['text', 'Строки и очистка', 'CASE, COALESCE и нормализация данных'],
  ['set-ops', 'Операции над множествами', 'UNION, INTERSECT, EXCEPT'],
  ['data-quality', 'Качество данных', 'Дубли, пропуски и аномалии'],
  ['indexes', 'Индексы', 'Составные индексы и селективность'],
  ['explain', 'EXPLAIN', 'Планы выполнения и поиск узких мест'],
  ['transactions', 'Транзакции', 'ACID и безопасные изменения'],
  ['schema', 'Проектирование схемы', 'Ключи, ограничения и нормализация'],
  ['support', 'IT Support Analytics', 'SLA, очереди, инженеры и сервисы'],
  ['final', 'Финальный проект', 'Аналитическая витрина вымышленной компании T-Bonk']
] as const;

const guide = (
  summary: string,
  mentalModel: string,
  example: string,
  checklist: string[],
  commonMistakes: string[]
): ModuleGuide => ({ summary, mentalModel, example, checklist, commonMistakes });

export const moduleGuides: Record<string, ModuleGuide> = {
  'sql-thinking': guide(
    'Переводим рабочий вопрос в точную форму результата.',
    'Сначала представь итоговую таблицу: одна строка — что, один столбец — что. После этого выбирай FROM, фильтр и порядок.',
    'SELECT ticket_id, service FROM tickets ORDER BY ticket_id;',
    ['Назови сущность одной строки', 'Перечисли нужные столбцы', 'Определи фильтр', 'Задай стабильную сортировку'],
    ['Начинать писать SQL до понимания результата', 'Использовать SELECT *', 'Не задавать порядок строк']
  ),
  select: guide(
    'Выбираем поля и создаём вычисляемые показатели.',
    'SELECT — это контракт результата. Выражение становится новым столбцом, AS даёт ему понятное имя.',
    'SELECT ticket_id, resolution_minutes - sla_minutes AS breach_minutes FROM tickets;',
    ['Выбери только нужные поля', 'Дай вычислению псевдоним', 'Проверь тип результата'],
    ['SELECT *', 'Безымянные вычисления', 'Путать DISTINCT и GROUP BY']
  ),
  filtering: guide(
    'Оставляем только строки, соответствующие условиям.',
    'WHERE проверяет каждую строку отдельно. NULL — неизвестное значение, поэтому требует IS NULL.',
    "SELECT * FROM tickets WHERE priority = 'Critical' AND resolution_minutes IS NOT NULL;",
    ['Раздели условия на независимые проверки', 'Проверь AND/OR', 'Обработай NULL явно'],
    ['= NULL', 'Неверные скобки с OR', 'Фильтровать агрегат через WHERE']
  ),
  sorting: guide(
    'Делаем порядок результата предсказуемым.',
    'ORDER BY сравнивает строки слева направо. Вторичный ключ устраняет случайный порядок при равенстве.',
    'ORDER BY resolution_minutes DESC, ticket_id ASC LIMIT 5;',
    ['Выбери главный критерий', 'Укажи ASC/DESC', 'Добавь tie-breaker', 'LIMIT применяй после сортировки'],
    ['LIMIT без ORDER BY', 'Забывать направление', 'Нестабильный порядок при равенстве']
  ),
  aggregates: guide(
    'Сворачиваем набор строк в показатели.',
    'Агрегат отвечает на вопрос о множестве строк: сколько, среднее, минимум, максимум или сумма.',
    'SELECT COUNT(*) AS total, ROUND(AVG(resolution_minutes), 1) AS avg_minutes FROM tickets;',
    ['Определи набор строк', 'Выбери агрегат', 'Реши, нужно ли исключить NULL', 'Назови показатель'],
    ['COUNT(column) вместо COUNT(*) без понимания NULL', 'AVG по незакрытым обращениям', 'Смешивать обычные поля и агрегаты без GROUP BY']
  ),
  grouping: guide(
    'Считаем показатели отдельно для каждой категории.',
    'GROUP BY создаёт корзины, агрегаты считают внутри корзины, HAVING фильтрует уже готовые группы.',
    'SELECT service, COUNT(*) FROM tickets GROUP BY service HAVING COUNT(*) >= 2;',
    ['Выбери ключ группы', 'Добавь агрегаты', 'WHERE — до группировки', 'HAVING — после'],
    ['Фильтровать COUNT через WHERE', 'Не включать выбранное поле в GROUP BY', 'Группировать по лишним столбцам']
  ),
  joins: guide(
    'Соединяем сущности по ключам.',
    'JOIN строит пары строк. INNER оставляет совпадения, LEFT сохраняет все строки слева.',
    'FROM tickets t JOIN engineers e ON e.engineer_id = t.engineer_id',
    ['Определи левую и правую таблицу', 'Найди внешний и первичный ключ', 'Выбери INNER или LEFT', 'Проверь размножение строк'],
    ['JOIN без ON', 'Связывать поля разных смыслов', 'COUNT(*) после LEFT JOIN']
  ),
  subqueries: guide(
    'Используем результат одного запроса внутри другого.',
    'Внутренний запрос вычисляет значение или набор, внешний применяет его как условие.',
    'WHERE resolution_minutes > (SELECT AVG(resolution_minutes) FROM tickets)',
    ['Запусти подзапрос отдельно', 'Проверь число возвращаемых столбцов', 'Сопоставь оператор =, IN или EXISTS'],
    ['Скалярный подзапрос возвращает много строк', 'Повторная работа вместо CTE', 'NULL в NOT IN']
  ),
  cte: guide(
    'Разбиваем сложный SQL на именованные этапы.',
    'CTE — временный результат только для текущего запроса. Каждый этап должен иметь одно понятное назначение.',
    'WITH stats AS (...) SELECT * FROM stats;',
    ['Дай этапу смысловое имя', 'Проверь CTE отдельно', 'Во внешнем запросе используй готовые показатели'],
    ['CTE без пользы для читаемости', 'Ссылки на несуществующие алиасы', 'Слишком много логики в одном этапе']
  ),
  windows: guide(
    'Считаем показатели по соседним строкам, не теряя детализацию.',
    'Оконная функция видит набор строк, но возвращает значение для каждой строки. PARTITION BY задаёт независимые окна.',
    'ROW_NUMBER() OVER (PARTITION BY service ORDER BY resolution_minutes DESC)',
    ['Определи раздел', 'Задай порядок внутри окна', 'Выбери ROW_NUMBER, RANK, LAG или SUM', 'Проверь tie-breaker'],
    ['Путать GROUP BY и окно', 'Окно без ORDER BY там, где важна последовательность', 'Фильтровать оконную функцию в WHERE того же уровня']
  ),
  dates: guide(
    'Работаем с периодами и временной гранулярностью.',
    'Дата отвечает на вопросы «когда» и «за какой период». Сначала выбери единицу анализа: день, неделя, месяц или скользящее окно.',
    "date(created_at), datetime(created_at, '+3 hours')",
    ['Определи timezone', 'Выбери границы периода', 'Сгруппируй по нужной гранулярности', 'Проверь включительность границ'],
    ['Сравнивать строки дат разных форматов', 'Забывать timezone', 'Использовать BETWEEN для полуоткрытых интервалов']
  ),
  text: guide(
    'Нормализуем строки и кодируем условия.',
    'Строковые функции очищают представление, CASE создаёт категорию, COALESCE выбирает первое известное значение.',
    "CASE WHEN priority = 'Critical' THEN 'P1' ELSE 'Other' END",
    ['Нормализуй пробелы и регистр', 'Определи порядок WHEN', 'Добавь ELSE', 'Не скрывай важный NULL без причины'],
    ['CASE без ELSE', 'LOWER без TRIM', 'COALESCE маскирует проблему качества']
  ),
  'set-ops': guide(
    'Объединяем совместимые результаты.',
    'UNION складывает наборы и удаляет дубли, UNION ALL сохраняет все строки, INTERSECT и EXCEPT сравнивают множества.',
    'SELECT service FROM tickets UNION SELECT service FROM incidents;',
    ['Сопоставь число и смысл столбцов', 'Выбери ALL осознанно', 'Сортируй итоговый набор один раз'],
    ['UNION вместо UNION ALL без причины', 'Несовместимые типы столбцов', 'ORDER BY внутри веток']
  ),
  'data-quality': guide(
    'Измеряем и локализуем аномалии данных.',
    'Сначала посчитай проблему, затем выведи конкретные строки. Дубликат определяется бизнес-ключом, а не полным совпадением записи.',
    'GROUP BY email HAVING COUNT(*) > 1',
    ['Определи бизнес-ключ', 'Посчитай NULL и дубли', 'Выведи проблемные ID', 'Не исправляй до измерения'],
    ['COUNT(*) без детализации', 'Считать пустую строку и NULL одинаково', 'Удалять дубли без правила выбора']
  ),
  indexes: guide(
    'Ускоряем доступ к строкам ценой дополнительной записи и места.',
    'Индекс — отсортированная структура. Полезен, если предикат достаточно селективен и соответствует порядку столбцов индекса.',
    'CREATE INDEX idx_tickets_service_status ON tickets(service, status);',
    ['Найди частый запрос', 'Проверь WHERE/JOIN/ORDER BY', 'Определи порядок столбцов', 'Сравни план до и после'],
    ['Индексировать каждый столбец', 'Игнорировать порядок составного индекса', 'Оптимизировать без EXPLAIN']
  ),
  explain: guide(
    'Читаем путь выполнения запроса.',
    'План показывает операции: сканирование, поиск по индексу, временную сортировку и порядок соединения.',
    'EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE service = \'VPN\';',
    ['Найди SCAN и SEARCH', 'Сопоставь операцию с фильтром', 'Проверь временную сортировку', 'Измерь результат изменения'],
    ['Считать стоимость точным временем', 'Игнорировать объём данных', 'Добавлять индекс без повторного плана']
  ),
  transactions: guide(
    'Объединяем изменения в одну атомарную операцию.',
    'Транзакция либо фиксирует все изменения, либо откатывает их. Сначала проверка, затем изменение, затем контроль.',
    'BEGIN; UPDATE ...; SELECT changes(); COMMIT;',
    ['Открой транзакцию', 'Проверь затронутые строки', 'Подготовь ROLLBACK', 'Фиксируй только после контроля'],
    ['UPDATE без WHERE', 'COMMIT до проверки', 'Длинная транзакция блокирует других']
  ),
  schema: guide(
    'Проектируем таблицы, ограничения и связи.',
    'Схема хранит инварианты: типы, обязательность, уникальность и ссылочную целостность.',
    'CREATE TABLE services (service_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);',
    ['Определи сущности', 'Выбери первичные ключи', 'Добавь NOT NULL/UNIQUE/CHECK', 'Зафиксируй внешние ключи'],
    ['Хранить список в одном поле', 'Полагаться только на UI', 'Не индексировать внешние ключи']
  ),
  support: guide(
    'Строим метрики поддержки и SLA.',
    'Операционная метрика должна иметь период, набор строк, числитель, знаменатель и объяснимое исключение.',
    "SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END)",
    ['Зафиксируй период', 'Раздели backlog и closed flow', 'Определи SLA breach', 'Добавь детализацию для проверки'],
    ['Среднее без распределения', 'Смешивать открытые и закрытые обращения', 'Процент без знаменателя']
  ),
  final: guide(
    'Собираем итоговую витрину из проверяемых этапов.',
    'Финальный SQL — это конвейер: базовый набор, обогащение, метрики, ранжирование и стабильный вывод.',
    'WITH base AS (...), metrics AS (...) SELECT * FROM metrics ORDER BY ...;',
    ['Опиши итоговую строку', 'Проверь каждый CTE', 'Добавь валидационные срезы', 'Проверь план', 'Документируй метрики'],
    ['Один гигантский SELECT', 'Непроверенные промежуточные результаты', 'Скрытая бизнес-логика']
  )
};

const makeTasks = (moduleIndex: number, moduleId: string, guideData: ModuleGuide): SqlTask[] => {
  const base = moduleIndex * 6 + 1;
  const titles = ['Разогрев', 'Рабочий запрос', 'Проверка деталей', 'Интервью', 'SQL-пазл', 'Итог модуля'];
  const modes: TaskMode[] = ['lesson', 'practice', 'practice', 'interview', 'puzzle', 'practice'];
  const difficulties: Difficulty[] = ['База', 'Рабочий', 'Рабочий', 'Продвинутый', 'Продвинутый', 'Экспертный'];
  return titles.map((title, offset) => {
    const taskNumber = String(base + offset).padStart(3, '0');
    return {
      id: `task-${taskNumber}`,
      module: moduleId,
      title: `${title}: ${guideData.summary}`,
      description: guideData.mentalModel,
      topic: guideData.summary,
      difficulty: difficulties[offset],
      mode: modes[offset],
      xp: 20 + moduleIndex * 3 + offset * 5,
      starter: '-- Напиши запрос\n',
      solution: taskSolutions[moduleId][offset],
      hints: [guideData.checklist[0], guideData.checklist[1], guideData.example],
      guide: guideData
    };
  });
};

const taskSolutions: Record<string, string[]> = {
  'sql-thinking': [
    'SELECT ticket_id, service, status FROM tickets ORDER BY ticket_id;',
    "SELECT ticket_id, priority FROM tickets WHERE status = 'Open' ORDER BY ticket_id;",
    'SELECT ticket_id, service, resolution_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY service, ticket_id;',
    "SELECT ticket_id, service FROM tickets WHERE status = 'Closed' ORDER BY service, ticket_id;",
    'SELECT customer_id, segment FROM customers ORDER BY segment, customer_id;',
    'SELECT ticket_id, service, priority, status FROM tickets ORDER BY priority, ticket_id;'
  ],
  select: [
    'SELECT ticket_id, service FROM tickets ORDER BY ticket_id;',
    'SELECT ticket_id, resolution_minutes - sla_minutes AS delta_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY ticket_id;',
    'SELECT DISTINCT service FROM tickets ORDER BY service;',
    'SELECT customer_id, region, segment FROM customers ORDER BY customer_id;',
    'SELECT engineer_id, name, level FROM engineers ORDER BY level, engineer_id;',
    'SELECT ticket_id, service, priority, status FROM tickets ORDER BY ticket_id;'
  ],
  filtering: [
    "SELECT ticket_id FROM tickets WHERE priority = 'Critical' ORDER BY ticket_id;",
    "SELECT ticket_id, service FROM tickets WHERE status = 'Open' AND priority IN ('High', 'Critical') ORDER BY ticket_id;",
    'SELECT ticket_id FROM tickets WHERE resolution_minutes IS NULL ORDER BY ticket_id;',
    "SELECT customer_id, email FROM customers WHERE email LIKE '%@example.com' ORDER BY customer_id;",
    "SELECT ticket_id, service FROM tickets WHERE service BETWEEN 'Billing' AND 'VPN' ORDER BY service, ticket_id;",
    "SELECT ticket_id, priority FROM tickets WHERE NOT (status = 'Closed' OR priority = 'Low') ORDER BY ticket_id;"
  ],
  sorting: [
    'SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY resolution_minutes DESC, ticket_id LIMIT 5;',
    'SELECT ticket_id, priority FROM tickets ORDER BY CASE priority WHEN \'Critical\' THEN 1 WHEN \'High\' THEN 2 WHEN \'Medium\' THEN 3 ELSE 4 END, ticket_id;',
    'SELECT customer_id, region FROM customers ORDER BY region, customer_id LIMIT 4 OFFSET 2;',
    'SELECT ticket_id, service, created_at FROM tickets ORDER BY created_at DESC, ticket_id DESC;',
    'SELECT engineer_id, name FROM engineers ORDER BY lower(name), engineer_id;',
    'SELECT ticket_id, service FROM tickets ORDER BY service ASC, ticket_id ASC LIMIT 10;'
  ],
  aggregates: [
    'SELECT COUNT(*) AS total_tickets FROM tickets;',
    "SELECT COUNT(*) AS closed_tickets, ROUND(AVG(resolution_minutes), 1) AS avg_minutes FROM tickets WHERE status = 'Closed';",
    'SELECT MIN(resolution_minutes) AS min_minutes, MAX(resolution_minutes) AS max_minutes FROM tickets;',
    'SELECT COUNT(resolution_minutes) AS known_resolution_count FROM tickets;',
    'SELECT SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches FROM tickets WHERE status = \'Closed\';',
    'SELECT ROUND(AVG(COALESCE(resolution_minutes, 0)), 1) AS avg_with_open FROM tickets;'
  ],
  grouping: [
    'SELECT service, COUNT(*) AS tickets_count FROM tickets GROUP BY service ORDER BY service;',
    'SELECT priority, COUNT(*) AS tickets_count FROM tickets GROUP BY priority HAVING COUNT(*) >= 2 ORDER BY tickets_count DESC, priority;',
    "SELECT service, ROUND(AVG(resolution_minutes), 1) AS avg_minutes FROM tickets WHERE status = 'Closed' GROUP BY service ORDER BY avg_minutes DESC, service;",
    'SELECT engineer_id, COUNT(*) AS assigned_count FROM tickets GROUP BY engineer_id ORDER BY assigned_count DESC, engineer_id;',
    'SELECT region, segment, COUNT(*) AS customers_count FROM customers GROUP BY region, segment ORDER BY region, segment;',
    'SELECT status, COUNT(*) AS tickets_count FROM tickets GROUP BY status ORDER BY tickets_count DESC, status;'
  ],
  joins: [
    'SELECT t.ticket_id, e.name FROM tickets t JOIN engineers e ON e.engineer_id = t.engineer_id ORDER BY t.ticket_id;',
    'SELECT c.customer_id, c.region, t.ticket_id FROM customers c LEFT JOIN tickets t ON t.customer_id = c.customer_id ORDER BY c.customer_id, t.ticket_id;',
    'SELECT e.engineer_id, e.name, COUNT(t.ticket_id) AS ticket_count FROM engineers e LEFT JOIN tickets t ON t.engineer_id = e.engineer_id GROUP BY e.engineer_id, e.name ORDER BY ticket_count DESC, e.engineer_id;',
    'SELECT t.ticket_id, c.segment, e.level FROM tickets t JOIN customers c ON c.customer_id = t.customer_id JOIN engineers e ON e.engineer_id = t.engineer_id ORDER BY t.ticket_id;',
    'SELECT c.customer_id FROM customers c LEFT JOIN tickets t ON t.customer_id = c.customer_id WHERE t.ticket_id IS NULL ORDER BY c.customer_id;',
    'SELECT t1.ticket_id, t2.ticket_id AS later_ticket FROM tickets t1 JOIN tickets t2 ON t1.customer_id = t2.customer_id AND t1.ticket_id < t2.ticket_id ORDER BY t1.ticket_id, later_ticket;'
  ],
  subqueries: [
    'SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes > (SELECT AVG(resolution_minutes) FROM tickets WHERE resolution_minutes IS NOT NULL) ORDER BY resolution_minutes DESC;',
    'SELECT customer_id FROM customers WHERE customer_id IN (SELECT customer_id FROM tickets WHERE priority = \'Critical\') ORDER BY customer_id;',
    'SELECT e.engineer_id, e.name FROM engineers e WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.engineer_id = e.engineer_id AND t.status = \'Open\') ORDER BY e.engineer_id;',
    'SELECT ticket_id, service FROM tickets t WHERE resolution_minutes = (SELECT MAX(t2.resolution_minutes) FROM tickets t2 WHERE t2.service = t.service) ORDER BY service, ticket_id;',
    'SELECT customer_id FROM customers WHERE NOT EXISTS (SELECT 1 FROM tickets WHERE tickets.customer_id = customers.customer_id) ORDER BY customer_id;',
    'SELECT ticket_id FROM tickets WHERE service IN (SELECT service FROM tickets GROUP BY service HAVING COUNT(*) >= 2) ORDER BY ticket_id;'
  ],
  cte: [
    'WITH open_tickets AS (SELECT * FROM tickets WHERE status = \'Open\') SELECT ticket_id, service FROM open_tickets ORDER BY ticket_id;',
    'WITH service_stats AS (SELECT service, COUNT(*) AS total FROM tickets GROUP BY service) SELECT service, total FROM service_stats ORDER BY total DESC, service;',
    'WITH base AS (SELECT ticket_id, service, resolution_minutes FROM tickets WHERE resolution_minutes IS NOT NULL), ranked AS (SELECT *, RANK() OVER (ORDER BY resolution_minutes DESC) AS rnk FROM base) SELECT ticket_id, service, resolution_minutes FROM ranked WHERE rnk <= 3 ORDER BY rnk, ticket_id;',
    'WITH customer_counts AS (SELECT customer_id, COUNT(*) AS ticket_count FROM tickets GROUP BY customer_id) SELECT customer_id, ticket_count FROM customer_counts WHERE ticket_count > 1 ORDER BY customer_id;',
    'WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM nums WHERE n < 5) SELECT n FROM nums;',
    'WITH closed AS (SELECT service, resolution_minutes FROM tickets WHERE status = \'Closed\'), metrics AS (SELECT service, COUNT(*) AS total, ROUND(AVG(resolution_minutes), 1) AS avg_minutes FROM closed GROUP BY service) SELECT * FROM metrics ORDER BY total DESC, service;'
  ],
  windows: [
    'SELECT ticket_id, service, resolution_minutes, ROW_NUMBER() OVER (PARTITION BY service ORDER BY resolution_minutes DESC, ticket_id) AS rn FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY service, rn;',
    'SELECT ticket_id, created_at, LAG(created_at) OVER (ORDER BY created_at, ticket_id) AS previous_created_at FROM tickets ORDER BY created_at, ticket_id;',
    'SELECT ticket_id, service, resolution_minutes, SUM(resolution_minutes) OVER (PARTITION BY service ORDER BY created_at, ticket_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY service, created_at, ticket_id;',
    'SELECT engineer_id, name, level, DENSE_RANK() OVER (ORDER BY level DESC) AS level_rank FROM engineers ORDER BY level_rank, engineer_id;',
    'SELECT ticket_id, service, resolution_minutes, AVG(resolution_minutes) OVER (PARTITION BY service) AS service_avg FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY service, ticket_id;',
    'SELECT ticket_id, service, resolution_minutes, NTILE(4) OVER (ORDER BY resolution_minutes) AS quartile FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY quartile, resolution_minutes, ticket_id;'
  ],
  dates: [
    "SELECT date(created_at) AS day, COUNT(*) AS tickets_count FROM tickets GROUP BY date(created_at) ORDER BY day;",
    "SELECT ticket_id, created_at FROM tickets WHERE created_at >= datetime('now', '-7 days') ORDER BY created_at, ticket_id;",
    "SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS tickets_count FROM tickets GROUP BY month ORDER BY month;",
    "SELECT ticket_id, ROUND(julianday(closed_at) - julianday(created_at), 2) AS duration_days FROM tickets WHERE closed_at IS NOT NULL ORDER BY ticket_id;",
    "SELECT ticket_id, datetime(created_at, '+3 hours') AS moscow_time FROM tickets ORDER BY ticket_id;",
    "SELECT date(created_at, 'start of month') AS month_start, COUNT(*) AS tickets_count FROM tickets GROUP BY month_start ORDER BY month_start;"
  ],
  text: [
    "SELECT customer_id, lower(trim(email)) AS normalized_email FROM customers ORDER BY customer_id;",
    "SELECT ticket_id, CASE WHEN priority = 'Critical' THEN 'P1' WHEN priority = 'High' THEN 'P2' ELSE 'P3/P4' END AS priority_group FROM tickets ORDER BY ticket_id;",
    "SELECT customer_id, COALESCE(email, 'missing') AS email_state FROM customers ORDER BY customer_id;",
    "SELECT ticket_id, substr(service, 1, 3) AS service_prefix FROM tickets ORDER BY ticket_id;",
    "SELECT customer_id, replace(phone, ' ', '') AS compact_phone FROM customers ORDER BY customer_id;",
    "SELECT ticket_id, printf('%s-%04d', service, ticket_id) AS external_key FROM tickets ORDER BY ticket_id;"
  ],
  'set-ops': [
    "SELECT service FROM tickets WHERE status = 'Open' UNION SELECT service FROM tickets WHERE priority = 'Critical' ORDER BY service;",
    "SELECT service FROM tickets WHERE status = 'Open' UNION ALL SELECT service FROM tickets WHERE status = 'Closed' ORDER BY service;",
    'SELECT customer_id FROM customers INTERSECT SELECT customer_id FROM tickets ORDER BY customer_id;',
    'SELECT customer_id FROM customers EXCEPT SELECT customer_id FROM tickets ORDER BY customer_id;',
    "SELECT 'ticket' AS source, ticket_id AS entity_id FROM tickets UNION ALL SELECT 'customer', customer_id FROM customers ORDER BY source, entity_id;",
    'SELECT region FROM customers UNION SELECT service FROM tickets ORDER BY 1;'
  ],
  'data-quality': [
    'SELECT email, COUNT(*) AS duplicate_count FROM customers WHERE email IS NOT NULL GROUP BY lower(trim(email)) HAVING COUNT(*) > 1 ORDER BY duplicate_count DESC, email;',
    "SELECT customer_id FROM customers WHERE email IS NULL OR trim(email) = '' ORDER BY customer_id;",
    'SELECT ticket_id FROM tickets WHERE closed_at IS NOT NULL AND status <> \'Closed\' ORDER BY ticket_id;',
    'SELECT phone, COUNT(*) AS uses FROM customers WHERE phone IS NOT NULL GROUP BY replace(phone, \' \', \'\') HAVING COUNT(*) > 1 ORDER BY uses DESC;',
    'SELECT engineer_id, COUNT(*) AS ticket_count FROM tickets GROUP BY engineer_id HAVING COUNT(*) > 3 ORDER BY ticket_count DESC;',
    'SELECT customer_id, email, phone FROM customers WHERE email IS NULL AND phone IS NULL ORDER BY customer_id;'
  ],
  indexes: [
    'SELECT ticket_id FROM tickets WHERE service = \'VPN\' AND status = \'Open\' ORDER BY ticket_id;',
    'SELECT ticket_id, created_at FROM tickets WHERE customer_id = 3 ORDER BY created_at DESC, ticket_id DESC;',
    'SELECT engineer_id, COUNT(*) AS tickets_count FROM tickets GROUP BY engineer_id ORDER BY tickets_count DESC;',
    'SELECT ticket_id FROM tickets WHERE lower(service) = \'vpn\' ORDER BY ticket_id;',
    'SELECT ticket_id, resolution_minutes FROM tickets WHERE service = \'Billing\' ORDER BY resolution_minutes DESC, ticket_id;',
    'SELECT customer_id, ticket_id FROM tickets WHERE customer_id BETWEEN 1 AND 5 ORDER BY customer_id, ticket_id;'
  ],
  explain: [
    'EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE service = \'VPN\';',
    'EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE customer_id = 3 ORDER BY created_at DESC;',
    'EXPLAIN QUERY PLAN SELECT t.ticket_id, e.name FROM tickets t JOIN engineers e ON e.engineer_id = t.engineer_id;',
    'EXPLAIN QUERY PLAN SELECT service, COUNT(*) FROM tickets GROUP BY service;',
    'EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE lower(service) = \'vpn\';',
    'EXPLAIN QUERY PLAN SELECT * FROM tickets ORDER BY resolution_minutes DESC LIMIT 10;'
  ],
  transactions: [
    "SELECT ticket_id, status FROM tickets WHERE status = 'Open' ORDER BY ticket_id;",
    'SELECT changes() AS changed_rows;',
    'SELECT ticket_id, status FROM tickets WHERE ticket_id = 1;',
    'SELECT customer_id, email FROM customers WHERE email IS NULL ORDER BY customer_id;',
    'SELECT COUNT(*) AS tickets_count FROM tickets;',
    'SELECT service, COUNT(*) AS tickets_count FROM tickets GROUP BY service ORDER BY service;'
  ],
  schema: [
    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name;",
    'PRAGMA table_info(tickets);',
    'PRAGMA foreign_key_list(tickets);',
    'SELECT sql FROM sqlite_master WHERE name = \'tickets\';',
    "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name;",
    'PRAGMA index_list(tickets);'
  ],
  support: [
    "SELECT service, COUNT(*) AS open_count FROM tickets WHERE status = 'Open' GROUP BY service ORDER BY open_count DESC, service;",
    "SELECT service, ROUND(AVG(resolution_minutes), 1) AS avg_resolution FROM tickets WHERE status = 'Closed' GROUP BY service ORDER BY avg_resolution DESC, service;",
    "SELECT engineer_id, COUNT(*) AS assigned, SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open_count FROM tickets GROUP BY engineer_id ORDER BY open_count DESC, engineer_id;",
    "SELECT service, SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches FROM tickets WHERE status = 'Closed' GROUP BY service ORDER BY breaches DESC, service;",
    "SELECT date(created_at) AS day, COUNT(*) AS opened, SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS currently_closed FROM tickets GROUP BY day ORDER BY day;",
    "SELECT priority, COUNT(*) AS open_count FROM tickets WHERE status = 'Open' GROUP BY priority ORDER BY CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END;"
  ],
  final: [
    "WITH closed AS (SELECT service, resolution_minutes, sla_minutes FROM tickets WHERE status = 'Closed'), metrics AS (SELECT service, COUNT(*) AS tickets_count, ROUND(AVG(resolution_minutes), 1) AS avg_minutes, SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches FROM closed GROUP BY service) SELECT service, tickets_count, avg_minutes, breaches FROM metrics ORDER BY breaches DESC, avg_minutes DESC, service;",
    'WITH workload AS (SELECT engineer_id, COUNT(*) AS assigned, SUM(CASE WHEN status = \'Open\' THEN 1 ELSE 0 END) AS open_count FROM tickets GROUP BY engineer_id) SELECT e.name, w.assigned, w.open_count FROM workload w JOIN engineers e ON e.engineer_id = w.engineer_id ORDER BY w.open_count DESC, e.name;',
    'WITH customer_activity AS (SELECT customer_id, COUNT(*) AS tickets_count, MAX(created_at) AS last_ticket_at FROM tickets GROUP BY customer_id) SELECT c.customer_id, c.segment, COALESCE(a.tickets_count, 0) AS tickets_count, a.last_ticket_at FROM customers c LEFT JOIN customer_activity a ON a.customer_id = c.customer_id ORDER BY tickets_count DESC, c.customer_id;',
    "WITH daily AS (SELECT date(created_at) AS day, COUNT(*) AS opened FROM tickets GROUP BY day), ranked AS (SELECT day, opened, SUM(opened) OVER (ORDER BY day) AS cumulative_opened FROM daily) SELECT * FROM ranked ORDER BY day;",
    'WITH base AS (SELECT service, status, resolution_minutes, sla_minutes FROM tickets), quality AS (SELECT service, COUNT(*) AS total, SUM(CASE WHEN resolution_minutes IS NULL THEN 1 ELSE 0 END) AS missing_resolution FROM base GROUP BY service) SELECT * FROM quality ORDER BY missing_resolution DESC, service;',
    "WITH closed AS (SELECT * FROM tickets WHERE status = 'Closed'), metrics AS (SELECT service, COUNT(*) AS volume, ROUND(AVG(resolution_minutes), 1) AS avg_minutes, SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches FROM closed GROUP BY service), ranked AS (SELECT *, RANK() OVER (ORDER BY breaches DESC, avg_minutes DESC) AS risk_rank FROM metrics) SELECT * FROM ranked ORDER BY risk_rank, service;"
  ]
};

export const tasks = modules.flatMap((module, index) => makeTasks(index, module[0], moduleGuides[module[0]]));

export const achievements = [
  { id: 'first-query', title: 'Первый SELECT', description: 'Решить первую задачу', threshold: 1 },
  { id: 'ten', title: 'Разогнался', description: 'Решить 10 задач', threshold: 10 },
  { id: 'half', title: 'Половина пути', description: 'Решить 60 задач', threshold: 60 },
  { id: 'all', title: 'SQL Engineer', description: 'Решить все 120 задач', threshold: 120 }
];
