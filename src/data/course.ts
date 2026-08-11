export type TaskMode = 'lesson' | 'practice' | 'interview' | 'puzzle';
export type Difficulty = 'База' | 'Рабочий' | 'Продвинутый' | 'Экспертный';

export interface ModuleGuide {
  summary: string;
  mentalModel: string;
  example: string;
  checklist: string[];
  commonMistakes: string[];
}

export interface LearningTaskContract {
  problemContract: string;
  contextId: string;
  solutionFamily: string;
  expectedGrain: string;
  stateRules: string[];
  adversarialCases: string[];
  remediationConcepts: string[];
  transferFromTaskIds: string[];
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
  evaluationContractId?: string;
  learningContract?: LearningTaskContract;
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
  ['cte', 'CTE', 'Читаемые этапы и рекурсивные запросы'],
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
    'Сначала представь итоговую таблицу: что означает одна строка и какие исходные столбцы нужны. Затем выбери источник через FROM.',
    'SELECT ticket_id, service FROM tickets;',
    ['Назови сущность одной строки', 'Перечисли нужные столбцы', 'Выбери таблицу-источник', 'Реши, значимы ли одинаковые проекции'],
    ['Начинать писать SQL до понимания результата', 'Использовать SELECT *', 'Случайно удалять одинаковые проекции через DISTINCT']
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
    'Считаем показатели, не схлопывая строки.',
    'Оконная функция видит соседние строки или группу, но сохраняет каждую исходную строку.',
    'RANK() OVER (ORDER BY COUNT(*) DESC)',
    ['Определи окно', 'Выбери PARTITION BY', 'Задай ORDER BY внутри OVER', 'Отделяй сортировку окна от итоговой'],
    ['Путать GROUP BY и окно', 'Забывать порядок внутри OVER', 'Ожидать уникальные номера от RANK']
  ),
  dates: guide(
    'Строим отчёты по календарным периодам.',
    'Дата хранится как значение, а функции date/strftime преобразуют её в день, неделю или месяц.',
    "SELECT strftime('%Y-%m', created_at) AS month FROM tickets;",
    ['Определи нужную гранулярность', 'Нормализуй дату', 'Группируй по тому же выражению', 'Сортируй хронологически'],
    ['Сравнивать даты как произвольный текст', 'Смешивать часовые пояса', 'Терять периоды без событий']
  ),
  text: guide(
    'Нормализуем строки и формируем категории.',
    'CASE создаёт бизнес-классификацию, COALESCE выбирает первое известное значение.',
    "CASE WHEN priority = 'Critical' THEN 'P1' ELSE 'Other' END",
    ['Сформулируй категории сверху вниз', 'Добавь ELSE', 'Нормализуй регистр и пробелы'],
    ['CASE без ELSE', 'Сравнение строк разного регистра', 'Подмена NULL пустой строкой без причины']
  ),
  'set-ops': guide(
    'Объединяем результаты совместимых SELECT.',
    'UNION работает вертикально: одинаковое число столбцов и совместимые типы. UNION удаляет дубли, UNION ALL сохраняет.',
    'SELECT service FROM tickets WHERE status = \'Open\' UNION SELECT service FROM tickets WHERE priority = \'Critical\';',
    ['Сверь число столбцов', 'Сверь смысл столбцов', 'Выбери UNION или UNION ALL', 'ORDER BY ставь в конце'],
    ['Несовместимые столбцы', 'Лишнее удаление дублей', 'ORDER BY внутри каждой части']
  ),
  'data-quality': guide(
    'Находим пропуски, дубли и подозрительные значения.',
    'Проверка качества — это запрос, который возвращает строки, требующие расследования, а не автоматически удаляет их.',
    'SELECT email, COUNT(*) FROM customers GROUP BY email HAVING COUNT(*) > 1;',
    ['Определи правило качества', 'Верни идентификаторы проблемных строк', 'Сначала измерь, потом исправляй'],
    ['Удалять данные до проверки', 'Считать NULL обычным дублем', 'Не сохранять причину аномалии']
  ),
  indexes: guide(
    'Подбираем индекс под конкретный путь доступа.',
    'B-tree полезен, когда запрос быстро сужает набор по левым столбцам индекса.',
    'CREATE INDEX idx_tickets_service ON tickets(service);',
    ['Начни с частого запроса', 'Оцени селективность', 'Проверь порядок составного индекса', 'Сверь план'],
    ['Индексировать всё', 'Игнорировать стоимость записи', 'Неверный порядок столбцов']
  ),
  explain: guide(
    'Читаем план выполнения вместо догадок.',
    'EXPLAIN QUERY PLAN показывает, сканирует ли SQLite таблицу или использует индекс и в каком порядке соединяет таблицы.',
    'EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE service = \'VPN\';',
    ['Найди SCAN или SEARCH', 'Проверь используемый индекс', 'Оцени раннюю фильтрацию', 'Сравни план после изменения'],
    ['Оптимизация без измерения', 'Смотреть только время на маленькой базе', 'Считать любой индекс полезным']
  ),
  transactions: guide(
    'Делаем изменения атомарными и обратимыми.',
    'Транзакция объединяет несколько действий: либо применяются все, либо ни одно.',
    'BEGIN; UPDATE ...; SELECT ...; ROLLBACK;',
    ['Начни транзакцию', 'Ограничь UPDATE через WHERE', 'Проверь изменённые строки', 'COMMIT или ROLLBACK явно'],
    ['UPDATE без WHERE', 'Долгая транзакция', 'Нет проверки перед COMMIT']
  ),
  schema: guide(
    'Проектируем таблицы с явными правилами целостности.',
    'Схема хранит бизнес-инварианты: типы, NOT NULL, UNIQUE, CHECK и связи должны предотвращать невозможные состояния.',
    'CREATE TABLE audit_log(id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, action TEXT NOT NULL);',
    ['Определи ключ', 'Отметь обязательные поля', 'Добавь ограничения', 'Проверь будущие запросы'],
    ['Хранить несколько значений в одном поле', 'Нет внешних ключей', 'Избыточные nullable-поля']
  ),
  support: guide(
    'Превращаем журнал обращений в операционные показатели.',
    'Метрика должна иметь чёткий числитель, знаменатель, период и бизнес-интерпретацию.',
    'SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches',
    ['Определи период', 'Зафиксируй статус выборки', 'Обработай незакрытые обращения', 'Добавь детализацию для проверки'],
    ['Смешивать backlog и закрытые', 'Считать среднее без выбросов', 'Метрика без периода']
  ),
  final: guide(
    'Собираем многоэтапный аналитический отчёт.',
    'Финальный запрос — конвейер: подготовка данных, расчёт метрик, ранжирование и стабильный вывод.',
    'WITH base AS (...), metrics AS (...) SELECT ... FROM metrics;',
    ['Разбей задачу на этапы', 'Проверь каждый CTE', 'Назови показатели', 'Добавь контрольную сортировку'],
    ['Один огромный SELECT', 'Необъяснимые алиасы', 'Нет проверки промежуточных результатов']
  )
};

const services = ['VPN', 'LMS', 'VDI', 'Email', 'Access'];
const priorities = ['Critical', 'High', 'Medium', 'Low'];
const ticketIds = [1001, 1003, 1004, 1005, 1006, 1008];
const modes: TaskMode[] = ['lesson', 'practice', 'interview', 'puzzle'];
const difficulties: Difficulty[] = ['База', 'Рабочий', 'Продвинутый', 'Экспертный'];
type Recipe = (variant: number) => Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

const recipes: Record<string, Recipe> = {
  'sql-thinking': v => v === 5 ? ({
    title: 'Контракт результата: Critical обращения',
    description: 'Покажи ticket_id, service и status для всех Critical-обращений независимо от сервиса. Результат должен быть стабильно отсортирован.',
    starter: 'SELECT\n  ticket_id,\n  service,\n  status\nFROM tickets\nWHERE ',
    solution: "SELECT ticket_id, service, status FROM tickets WHERE priority = 'Critical' ORDER BY ticket_id;",
    hints: ['Одна строка результата — одно обращение.', "Фильтр сравнивает priority со строкой 'Critical'.", 'Добавь ORDER BY ticket_id.']
  }) : ({
    title: `Контракт результата: ${services[v % services.length]}`,
    description: `Покажи ticket_id, service и status для сервиса ${services[v % services.length]}. Результат должен быть стабильно отсортирован.`,
    starter: 'SELECT\n  ticket_id,\n  service,\n  status\nFROM tickets\nWHERE ',
    solution: `SELECT ticket_id, service, status FROM tickets WHERE service = '${services[v % services.length]}' ORDER BY ticket_id;`,
    hints: ['Сначала сформулируй одну строку результата.', `Фильтр сравнивает service со строкой '${services[v % services.length]}'.`, 'Добавь ORDER BY ticket_id.']
  }),
  select: v => ({
    title: `Вычисляемое отклонение SLA ${v + 1}`,
    description: 'Выведи номер обращения, фактическое время, SLA и разницу между ними. Незакрытые обращения исключи.',
    starter: 'SELECT\n  ticket_id,\n  resolution_minutes,\n  sla_minutes,\n  \nFROM tickets\nWHERE ',
    solution: 'SELECT ticket_id, resolution_minutes, sla_minutes, resolution_minutes - sla_minutes AS delta_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY ticket_id;',
    hints: ['Разность — обычное выражение в SELECT.', 'Назови вычисление delta_minutes.', 'Исключи NULL через IS NOT NULL.']
  }),
  filtering: v => ({
    title: `Фильтр ${priorities[v % priorities.length]} + ${services[(v + 1) % services.length]}`,
    description: `Найди закрытые обращения приоритета ${priorities[v % priorities.length]} или сервиса ${services[(v + 1) % services.length]}.`,
    starter: 'SELECT ticket_id, service, priority, status\nFROM tickets\nWHERE ',
    solution: `SELECT ticket_id, service, priority, status FROM tickets WHERE status = 'Closed' AND (priority = '${priorities[v % priorities.length]}' OR service = '${services[(v + 1) % services.length]}') ORDER BY ticket_id;`,
    hints: ['Сначала ограничь status.', 'Условия с OR объедини скобками.', 'Строки заключаются в одинарные кавычки.']
  }),
  sorting: v => v < 3 ? ({
    title: `Топ-${(v % 3) + 2} долгих обращений`,
    description: `Покажи ${(v % 3) + 2} закрытых обращения с самым большим временем решения. При равенстве выше должен быть меньший ticket_id.`,
    starter: 'SELECT ticket_id, resolution_minutes\nFROM tickets\nWHERE resolution_minutes IS NOT NULL\nORDER BY ',
    solution: `SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY resolution_minutes DESC, ticket_id ASC LIMIT ${(v % 3) + 2};`,
    hints: ['Главная сортировка — resolution_minutes DESC.', 'ticket_id нужен как tie-breaker.', 'LIMIT ставится после ORDER BY.']
  }) : ({
    title: `Топ-${(v % 3) + 2} быстрых обращений`,
    description: `Покажи ${(v % 3) + 2} закрытых обращения с самым маленьким временем решения. При равенстве выше должен быть меньший ticket_id.`,
    starter: 'SELECT ticket_id, resolution_minutes\nFROM tickets\nWHERE resolution_minutes IS NOT NULL\nORDER BY ',
    solution: `SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY resolution_minutes ASC, ticket_id ASC LIMIT ${(v % 3) + 2};`,
    hints: ['Главная сортировка — resolution_minutes ASC.', 'ticket_id нужен как tie-breaker.', 'LIMIT ставится после ORDER BY.']
  }),
  aggregates: v => ({
    title: `Сводка закрытых обращений ${v + 1}`,
    description: 'Верни количество закрытых обращений, минимальное, максимальное и среднее время решения, округлённое до одного знака.',
    starter: 'SELECT\n  COUNT(*) AS closed_count,\n  \nFROM tickets\nWHERE ',
    solution: "SELECT COUNT(*) AS closed_count, MIN(resolution_minutes) AS min_minutes, MAX(resolution_minutes) AS max_minutes, ROUND(AVG(resolution_minutes), 1) AS avg_minutes FROM tickets WHERE status = 'Closed';",
    hints: ['Все показатели считаются по одному набору строк.', "Фильтр status = 'Closed'.", 'Для среднего используй ROUND(..., 1).']
  }),
  grouping: v => v < 3 ? ({
    title: `Сервисы минимум с ${(v % 3) + 1} обращениями`,
    description: `Посчитай обращения по сервисам и оставь группы, где не меньше ${(v % 3) + 1} строк.`,
    starter: 'SELECT service, COUNT(*) AS tickets_count\nFROM tickets\nGROUP BY service\nHAVING ',
    solution: `SELECT service, COUNT(*) AS tickets_count FROM tickets GROUP BY service HAVING COUNT(*) >= ${(v % 3) + 1} ORDER BY tickets_count DESC, service;`,
    hints: ['COUNT(*) фильтруется через HAVING.', `Порог: >= ${(v % 3) + 1}.`, 'Сортируй по псевдониму и service.']
  }) : ({
    title: `Приоритеты минимум с ${(v % 3) + 1} обращениями`,
    description: `Посчитай обращения по приоритетам и оставь группы, где не меньше ${(v % 3) + 1} строк.`,
    starter: 'SELECT priority, COUNT(*) AS tickets_count\nFROM tickets\nGROUP BY priority\nHAVING ',
    solution: `SELECT priority, COUNT(*) AS tickets_count FROM tickets GROUP BY priority HAVING COUNT(*) >= ${(v % 3) + 1} ORDER BY tickets_count DESC, priority;`,
    hints: ['COUNT(*) фильтруется через HAVING.', `Порог: >= ${(v % 3) + 1}.`, 'Сортируй по псевдониму и priority.']
  }),
  joins: v => ({
    title: `Назначения инженеров ${v + 1}`,
    description: 'Соедини обращения и инженеров. Покажи ticket_id, имя, уровень инженера и сервис.',
    starter: 'SELECT t.ticket_id, e.name, e.level, t.service\nFROM tickets t\nJOIN engineers e ON ',
    solution: 'SELECT t.ticket_id, e.name, e.level, t.service FROM tickets t JOIN engineers e ON e.engineer_id = t.engineer_id ORDER BY t.ticket_id;',
    hints: ['Внешний ключ находится в tickets.', 'Свяжи engineer_id обеих таблиц.', 'Используй алиасы t и e.']
  }),
  subqueries: v => v < 4 ? ({
    title: `Выше среднего по ${priorities[v % priorities.length]}`,
    description: `Найди закрытые обращения приоритета ${priorities[v % priorities.length]}, которые решались дольше среднего среди закрытых обращений того же приоритета.`,
    starter: 'SELECT ticket_id, priority, resolution_minutes\nFROM tickets\nWHERE priority = ',
    solution: `SELECT ticket_id, priority, resolution_minutes FROM tickets WHERE priority = '${priorities[v % priorities.length]}' AND resolution_minutes > (SELECT AVG(resolution_minutes) FROM tickets WHERE priority = '${priorities[v % priorities.length]}' AND resolution_minutes IS NOT NULL) ORDER BY resolution_minutes DESC, ticket_id;`,
    hints: ['Подзапрос должен вернуть одно среднее.', 'Внутри и снаружи используй одинаковый priority.', 'NULL не должен участвовать в AVG.']
  }) : ({
    title: `Выше среднего в сервисе ${services[(v - 4) * 3]}`,
    description: `Найди закрытые обращения сервиса ${services[(v - 4) * 3]}, которые решались дольше среднего среди закрытых обращений этого сервиса.`,
    starter: 'SELECT ticket_id, service, resolution_minutes\nFROM tickets\nWHERE service = ',
    solution: `SELECT ticket_id, service, resolution_minutes FROM tickets WHERE service = '${services[(v - 4) * 3]}' AND resolution_minutes > (SELECT AVG(resolution_minutes) FROM tickets WHERE service = '${services[(v - 4) * 3]}' AND resolution_minutes IS NOT NULL) ORDER BY resolution_minutes DESC, ticket_id;`,
    hints: ['Подзапрос должен вернуть одно среднее.', 'Внутри и снаружи используй одинаковый service.', 'NULL не должен участвовать в AVG.']
  }),
  cte: v => ({
    title: `CTE нагрузки сервисов ${v + 1}`,
    description: 'Через CTE посчитай обращения и среднее время решения по сервисам. Оставь только сервисы с закрытыми обращениями.',
    starter: 'WITH service_stats AS (\n  SELECT\n    service,\n    COUNT(*) AS tickets_count,\n    ROUND(AVG(resolution_minutes), 1) AS avg_minutes\n  FROM tickets\n  GROUP BY service\n)\nSELECT ',
    solution: 'WITH service_stats AS (SELECT service, COUNT(*) AS tickets_count, ROUND(AVG(resolution_minutes), 1) AS avg_minutes FROM tickets GROUP BY service) SELECT service, tickets_count, avg_minutes FROM service_stats WHERE avg_minutes IS NOT NULL ORDER BY tickets_count DESC, service;',
    hints: ['CTE уже вычисляет показатели.', 'Во внешнем SELECT перечисли три поля.', 'Отсутствие закрытых обращений проявится как avg_minutes IS NULL.']
  }),
  windows: v => ({
    title: `Рейтинг обращений внутри сервиса ${v + 1}`,
    description: 'Для каждого закрытого обращения присвой место по длительности внутри своего сервиса: самое долгое — первое.',
    starter: 'SELECT\n  ticket_id,\n  service,\n  resolution_minutes,\n  RANK() OVER (\n    PARTITION BY \n    ORDER BY \n  ) AS duration_rank\nFROM tickets\nWHERE ',
    solution: 'SELECT ticket_id, service, resolution_minutes, RANK() OVER (PARTITION BY service ORDER BY resolution_minutes DESC) AS duration_rank FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY service, duration_rank, ticket_id;',
    hints: ['Окно делится по service.', 'Внутри сервиса сортируй resolution_minutes DESC.', 'После окна добавь итоговый ORDER BY.']
  }),
  dates: v => ({
    title: `Дневная динамика обращений ${v + 1}`,
    description: 'Посчитай количество обращений по календарным дням.',
    starter: "SELECT date(created_at) AS created_day, COUNT(*) AS tickets_count\nFROM tickets\nGROUP BY ",
    solution: 'SELECT date(created_at) AS created_day, COUNT(*) AS tickets_count FROM tickets GROUP BY date(created_at) ORDER BY created_day;',
    hints: ['Нормализуй дату через date().', 'Группируй по тому же выражению.', 'Сортируй по created_day.']
  }),
  text: v => ({
    title: `Классификация приоритета ${v + 1}`,
    description: "Создай поле priority_group: Critical и High относятся к 'Urgent', остальные — к 'Normal'.",
    starter: 'SELECT\n  ticket_id,\n  priority,\n  CASE\n    WHEN \n    ELSE \n  END AS priority_group\nFROM tickets\nORDER BY ticket_id;',
    solution: "SELECT ticket_id, priority, CASE WHEN priority IN ('Critical', 'High') THEN 'Urgent' ELSE 'Normal' END AS priority_group FROM tickets ORDER BY ticket_id;",
    hints: ['Удобно использовать IN.', "Для Critical и High верни 'Urgent'.", "Добавь ELSE 'Normal'."]
  }),
  'set-ops': v => ({
    title: `Сервисы риска ${v + 1}`,
    description: 'Собери уникальный список сервисов, у которых есть открытые или Critical-обращения.',
    starter: "SELECT service FROM tickets WHERE status = 'Open'\n\nSELECT service FROM tickets WHERE priority = 'Critical'\nORDER BY service;",
    solution: "SELECT service FROM tickets WHERE status = 'Open' UNION SELECT service FROM tickets WHERE priority = 'Critical' ORDER BY service;",
    hints: ['Между SELECT нужен UNION.', 'UNION сам удаляет дубли.', 'ORDER BY применяется к общему результату.']
  }),
  'data-quality': v => ({
    title: `Дубли контактных email ${v + 1}`,
    description: 'Найди непустые email, которые встречаются у нескольких клиентов.',
    starter: 'SELECT email, COUNT(*) AS duplicates_count\nFROM customers\nWHERE \nGROUP BY email\nHAVING ',
    solution: 'SELECT email, COUNT(*) AS duplicates_count FROM customers WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1 ORDER BY email;',
    hints: ['NULL исключи до группировки.', 'Дубли — группы с COUNT(*) > 1.', 'Верни сам email и количество.']
  }),
  indexes: v => v === 5 ? ({
    title: 'План составного фильтра Critical + Closed',
    description: 'Проверь план поиска закрытых Critical-обращений. Составной индекс по priority и status уже создан.',
    starter: 'EXPLAIN QUERY PLAN\nSELECT ticket_id, priority, status\nFROM tickets\nWHERE ',
    solution: "EXPLAIN QUERY PLAN SELECT ticket_id, priority, status FROM tickets WHERE priority = 'Critical' AND status = 'Closed';",
    hints: ['Запрос начинается с EXPLAIN QUERY PLAN.', "Фильтр использует priority = 'Critical' и status = 'Closed'.", 'В результате ожидается SEARCH по составному индексу.']
  }) : ({
    title: `План поиска ${services[v % services.length]}`,
    description: `Проверь план поиска обращений сервиса ${services[v % services.length]}. Индекс по service уже создан.`,
    starter: 'EXPLAIN QUERY PLAN\nSELECT ticket_id, service\nFROM tickets\nWHERE ',
    solution: `EXPLAIN QUERY PLAN SELECT ticket_id, service FROM tickets WHERE service = '${services[v % services.length]}';`,
    hints: ['Запрос начинается с EXPLAIN QUERY PLAN.', `Фильтр: service = '${services[v % services.length]}'.`, 'В результате ожидается SEARCH с индексом.']
  }),
  explain: v => ({
    title: `План JOIN инженеров ${v + 1}`,
    description: 'Получи план соединения tickets и engineers для Critical-обращений.',
    starter: "EXPLAIN QUERY PLAN\nSELECT t.ticket_id, e.name\nFROM tickets t\nJOIN engineers e ON \nWHERE t.priority = 'Critical';",
    solution: "EXPLAIN QUERY PLAN SELECT t.ticket_id, e.name FROM tickets t JOIN engineers e ON e.engineer_id = t.engineer_id WHERE t.priority = 'Critical';",
    hints: ['Сначала допиши условие ON.', 'Свяжи engineer_id.', 'EXPLAIN стоит перед SELECT.']
  }),
  transactions: v => ({
    title: `Безопасное закрытие обращения ${ticketIds[v % ticketIds.length]}`,
    description: `В транзакции измени status обращения ${ticketIds[v % ticketIds.length]} на Closed, проверь результат SELECT и откати изменение.`,
    starter: `BEGIN;\nUPDATE tickets\nSET status = 'Closed'\nWHERE \n\nSELECT ticket_id, status FROM tickets WHERE ticket_id = ${ticketIds[v % ticketIds.length]};\n\n`,
    solution: `BEGIN; UPDATE tickets SET status = 'Closed' WHERE ticket_id = ${ticketIds[v % ticketIds.length]}; SELECT ticket_id, status FROM tickets WHERE ticket_id = ${ticketIds[v % ticketIds.length]}; ROLLBACK;`,
    hints: [`WHERE ticket_id = ${ticketIds[v % ticketIds.length]}.`, 'Проверочный SELECT должен быть внутри транзакции.', 'Заверши ROLLBACK.']
  }),
  schema: v => ({
    title: `Схема журнала аудита ${v + 1}`,
    description: 'Создай таблицу audit_log с id INTEGER PRIMARY KEY, обязательными ticket_id и action TEXT. Затем выведи её структуру.',
    starter: 'CREATE TABLE audit_log (\n  id INTEGER PRIMARY KEY,\n  \n);\n\nPRAGMA table_info(audit_log);',
    solution: 'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, action TEXT NOT NULL); PRAGMA table_info(audit_log);',
    hints: ['Добавь ticket_id INTEGER NOT NULL.', 'Добавь action TEXT NOT NULL.', 'PRAGMA должен выполниться после CREATE TABLE.']
  }),
  support: v => ({
    title: `SLA по сервисам ${v + 1}`,
    description: 'По каждому сервису посчитай закрытые обращения и число нарушений SLA.',
    starter: 'SELECT\n  service,\n  COUNT(*) AS closed_count,\n  SUM(CASE WHEN \n      THEN 1 ELSE 0 END) AS breaches\nFROM tickets\nWHERE \nGROUP BY service\nORDER BY ',
    solution: "SELECT service, COUNT(*) AS closed_count, SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches FROM tickets WHERE status = 'Closed' GROUP BY service ORDER BY breaches DESC, service;",
    hints: ["Фильтр status = 'Closed'.", 'Нарушение: resolution_minutes > sla_minutes.', 'Сортируй по breaches DESC.']
  }),
  final: v => ({
    title: `Финальная витрина сервисов ${v + 1}`,
    description: 'Собери по сервисам количество обращений, нарушения SLA, среднее время решения и место по нагрузке.',
    starter: 'WITH service_metrics AS (\n  SELECT\n    service,\n    COUNT(*) AS tickets_count,\n    SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches,\n    ROUND(AVG(resolution_minutes), 1) AS avg_minutes\n  FROM tickets\n  GROUP BY service\n)\nSELECT\n  service,\n  tickets_count,\n  breaches,\n  avg_minutes,\n  RANK() OVER (ORDER BY ) AS load_rank\nFROM service_metrics\nORDER BY ',
    solution: 'WITH service_metrics AS (SELECT service, COUNT(*) AS tickets_count, SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches, ROUND(AVG(resolution_minutes), 1) AS avg_minutes FROM tickets GROUP BY service) SELECT service, tickets_count, breaches, avg_minutes, RANK() OVER (ORDER BY tickets_count DESC) AS load_rank FROM service_metrics ORDER BY load_rank, service;',
    hints: ['В окне сортируй tickets_count DESC.', 'Итоговая сортировка — load_rank, service.', 'AVG автоматически игнорирует NULL.']
  })
};

export const tasks: SqlTask[] = modules.flatMap(([module, topic], moduleIndex) =>
  Array.from({ length: 6 }, (_, taskIndex) => {
    const globalIndex = moduleIndex * 6 + taskIndex;
    const recipe = recipes[module](taskIndex);
    return {
      id: `task-${String(globalIndex + 1).padStart(3, '0')}`,
      module,
      topic,
      difficulty: difficulties[Math.min(3, Math.floor(globalIndex / 30))],
      mode: modes[globalIndex % modes.length],
      xp: 60 + (globalIndex % 8) * 15,
      guide: moduleGuides[module],
      ...recipe
    };
  })
);

export const achievements = [
  { id: 'first-query', title: 'Первый запрос', description: 'Правильно решить первую задачу', threshold: 1 },
  { id: 'ten-tasks', title: 'Разогрев окончен', description: 'Решить 10 задач', threshold: 10 },
  { id: 'quarter', title: 'Четверть пути', description: 'Решить 30 задач', threshold: 30 },
  { id: 'half', title: 'SQL-мидпоинт', description: 'Решить 60 задач', threshold: 60 },
  { id: 'interview-ready', title: 'Interview Ready', description: 'Решить 90 задач', threshold: 90 },
  { id: 'academy', title: 'SQL Academy', description: 'Решить все 120 задач', threshold: 120 }
];
