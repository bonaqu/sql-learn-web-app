import { moduleGuides, modules, tasks } from './course';

export type CourseModuleId = typeof modules[number][0];
export type CurriculumSectionKind = 'concept' | 'workflow' | 'pitfalls';

export interface CurriculumSection {
  id: string;
  kind: CurriculumSectionKind;
  title: string;
  lead: string;
  paragraphs: string[];
  bullets: string[];
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export interface KnowledgeCheck {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface RunnableExample {
  id: string;
  title: string;
  description: string;
  sql: string;
}

export interface CurriculumLesson {
  id: string;
  module: CourseModuleId;
  title: string;
  subtitle: string;
  minutes: number;
  prerequisites: CourseModuleId[];
  objectives: string[];
  sections: CurriculumSection[];
  glossary: GlossaryEntry[];
  example: RunnableExample;
  check: KnowledgeCheck;
  practiceTaskIds: string[];
}

export interface CurriculumCheckpoint {
  id: string;
  title: string;
  description: string;
  moduleIds: CourseModuleId[];
  taskIds: string[];
  passingScore: number;
  criteria: string[];
}

export interface ProjectDeliverable {
  id: string;
  title: string;
  description: string;
  acceptance: string[];
  starterSql: string;
}

export interface CapstoneProject {
  id: string;
  title: string;
  summary: string;
  scenario: string;
  estimatedMinutes: number;
  moduleIds: CourseModuleId[];
  deliverables: ProjectDeliverable[];
  rubric: Array<{ id: string; title: string; weight: number; description: string }>;
}

type Blueprint = {
  prerequisites: CourseModuleId[];
  objectives: string[];
  glossary: GlossaryEntry[];
  exampleSql: string;
  exampleDescription: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

const blueprints: Record<CourseModuleId, Blueprint> = {
  'sql-thinking': {
    prerequisites: [],
    objectives: ['Формулировать форму результата до написания SQL', 'Выбирать сущность одной строки', 'Добавлять проверяемую сортировку'],
    glossary: [
      { term: 'Гранулярность', definition: 'Что именно представляет одна строка результата.' },
      { term: 'Контракт результата', definition: 'Набор столбцов, строк, порядка и правил NULL, который должен вернуть запрос.' }
    ],
    exampleSql: "SELECT ticket_id, service, status FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;",
    exampleDescription: 'Запрос сначала фиксирует гранулярность «одно обращение — одна строка», затем ограничивает сервис и задаёт стабильный порядок.',
    question: 'Что полезнее сделать до первого ключевого слова SELECT?',
    options: ['Выбрать индекс', 'Описать одну строку и столбцы результата', 'Добавить LIMIT', 'Сразу открыть EXPLAIN'],
    correctIndex: 1,
    explanation: 'Сначала фиксируется контракт результата. Остальные конструкции выбираются уже под него.'
  },
  select: {
    prerequisites: ['sql-thinking'],
    objectives: ['Выбирать только нужные поля', 'Создавать вычисляемые столбцы', 'Давать выражениям понятные алиасы'],
    glossary: [
      { term: 'Проекция', definition: 'Выбор столбцов и выражений, которые попадут в результат.' },
      { term: 'Алиас', definition: 'Имя столбца или таблицы внутри запроса.' }
    ],
    exampleSql: 'SELECT ticket_id, resolution_minutes, sla_minutes, resolution_minutes - sla_minutes AS delta_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY ticket_id;',
    exampleDescription: 'Вычисляемое поле превращает два исходных значения в операционный показатель отклонения от SLA.',
    question: 'Зачем задавать AS для вычисляемого выражения?',
    options: ['Чтобы ускорить запрос', 'Чтобы результат имел понятный контракт', 'Чтобы исключить NULL', 'Чтобы включить DISTINCT'],
    correctIndex: 1,
    explanation: 'Алиас не ускоряет вычисление, но делает результат стабильным и понятным потребителю.'
  },
  filtering: {
    prerequisites: ['select'],
    objectives: ['Разделять условия на независимые предикаты', 'Корректно работать с NULL', 'Контролировать приоритет AND и OR'],
    glossary: [
      { term: 'Предикат', definition: 'Условие, которое для строки даёт TRUE, FALSE или UNKNOWN.' },
      { term: 'Трёхзначная логика', definition: 'Логика SQL, где NULL приводит к состоянию UNKNOWN.' }
    ],
    exampleSql: "SELECT ticket_id, priority, status FROM tickets WHERE status = 'Closed' AND (priority = 'Critical' OR priority = 'High') ORDER BY ticket_id;",
    exampleDescription: 'Скобки делают бизнес-условие явным: закрытое обращение и один из двух срочных приоритетов.',
    question: 'Как правильно проверить отсутствие значения?',
    options: ['column = NULL', 'column <> NULL', 'column IS NULL', 'NULL(column)'],
    correctIndex: 2,
    explanation: 'NULL не равен даже самому себе, поэтому используются IS NULL и IS NOT NULL.'
  },
  sorting: {
    prerequisites: ['filtering'],
    objectives: ['Задавать главный ключ сортировки', 'Добавлять tie-breaker', 'Использовать LIMIT только после ORDER BY'],
    glossary: [
      { term: 'Tie-breaker', definition: 'Дополнительный ключ, который делает порядок стабильным при равенстве основного.' },
      { term: 'Пагинация', definition: 'Выдача результата частями через порядок, LIMIT и OFFSET или keyset-подход.' }
    ],
    exampleSql: 'SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY resolution_minutes DESC, ticket_id ASC LIMIT 5;',
    exampleDescription: 'Вторичная сортировка по ticket_id исключает случайное переставление строк с одинаковой длительностью.',
    question: 'Почему LIMIT без ORDER BY опасен?',
    options: ['LIMIT не работает без индекса', 'Состав выбранных строк не гарантирован', 'LIMIT удаляет дубли', 'SQLite возвращает ошибку'],
    correctIndex: 1,
    explanation: 'Без явного порядка база не обязана возвращать одни и те же первые строки.'
  },
  aggregates: {
    prerequisites: ['sorting'],
    objectives: ['Выбирать агрегат под бизнес-вопрос', 'Понимать разницу COUNT(*) и COUNT(column)', 'Контролировать участие NULL'],
    glossary: [
      { term: 'Агрегат', definition: 'Функция, сворачивающая множество строк в одно значение.' },
      { term: 'Кардинальность', definition: 'Количество строк или уникальных значений в наборе.' }
    ],
    exampleSql: "SELECT COUNT(*) AS closed_count, MIN(resolution_minutes) AS min_minutes, MAX(resolution_minutes) AS max_minutes, ROUND(AVG(resolution_minutes), 1) AS avg_minutes FROM tickets WHERE status = 'Closed';",
    exampleDescription: 'Несколько агрегатов считают разные характеристики одного и того же отфильтрованного набора.',
    question: 'Что не учитывает COUNT(resolution_minutes)?',
    options: ['Нули', 'Отрицательные значения', 'NULL', 'Дубли'],
    correctIndex: 2,
    explanation: 'COUNT(column) считает только известные значения, тогда как COUNT(*) считает строки.'
  },
  grouping: {
    prerequisites: ['aggregates'],
    objectives: ['Создавать группы правильной гранулярности', 'Разделять WHERE и HAVING', 'Не добавлять лишние ключи группировки'],
    glossary: [
      { term: 'GROUP BY', definition: 'Разделение набора на группы с одинаковыми ключами.' },
      { term: 'HAVING', definition: 'Фильтр уже сформированных групп и агрегатов.' }
    ],
    exampleSql: 'SELECT service, COUNT(*) AS tickets_count FROM tickets GROUP BY service HAVING COUNT(*) >= 2 ORDER BY tickets_count DESC, service;',
    exampleDescription: 'WHERE отсутствует, потому что условие относится не к отдельной строке, а к размеру группы.',
    question: 'Где фильтровать группы с COUNT(*) > 3?',
    options: ['WHERE', 'HAVING', 'ORDER BY', 'ON'],
    correctIndex: 1,
    explanation: 'COUNT появляется после группировки, поэтому условие относится к HAVING.'
  },
  joins: {
    prerequisites: ['grouping'],
    objectives: ['Находить первичный и внешний ключ', 'Выбирать INNER или LEFT по смыслу', 'Диагностировать размножение строк'],
    glossary: [
      { term: 'Внешний ключ', definition: 'Поле, ссылающееся на ключ строки другой таблицы.' },
      { term: 'Кардинальность связи', definition: 'Соотношение строк между сущностями: один-к-одному, один-ко-многим и другие.' }
    ],
    exampleSql: 'SELECT t.ticket_id, t.service, e.name, e.level FROM tickets t JOIN engineers e ON e.engineer_id = t.engineer_id ORDER BY t.ticket_id;',
    exampleDescription: 'JOIN обогащает обращение атрибутами инженера по явной связи engineer_id.',
    question: 'Когда LEFT JOIN предпочтительнее INNER JOIN?',
    options: ['Когда нужно удалить дубли', 'Когда нужно сохранить все строки левой таблицы', 'Когда нет условия ON', 'Когда нужна сортировка'],
    correctIndex: 1,
    explanation: 'LEFT JOIN сохраняет строки слева даже при отсутствии совпадения справа.'
  },
  subqueries: {
    prerequisites: ['joins'],
    objectives: ['Различать скалярный и табличный подзапрос', 'Выбирать IN, EXISTS или сравнение', 'Избегать NOT IN с NULL'],
    glossary: [
      { term: 'Скалярный подзапрос', definition: 'Подзапрос, возвращающий одно значение.' },
      { term: 'Корреляция', definition: 'Ссылка внутреннего запроса на текущую строку внешнего.' }
    ],
    exampleSql: 'SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes > (SELECT AVG(resolution_minutes) FROM tickets WHERE resolution_minutes IS NOT NULL) ORDER BY resolution_minutes DESC;',
    exampleDescription: 'Внутренний запрос создаёт одно пороговое значение, внешний сравнивает с ним строки.',
    question: 'Какой оператор лучше выражает проверку существования связанной строки?',
    options: ['LIKE', 'EXISTS', 'BETWEEN', 'DISTINCT'],
    correctIndex: 1,
    explanation: 'EXISTS отвечает именно на вопрос «есть ли хотя бы одна подходящая строка».'
  },
  cte: {
    prerequisites: ['subqueries'],
    objectives: ['Разбивать SQL на этапы', 'Давать CTE предметные имена', 'Проверять промежуточные результаты'],
    glossary: [
      { term: 'CTE', definition: 'Именованный временный результат внутри одного SQL-выражения.' },
      { term: 'Конвейер запроса', definition: 'Последовательность этапов подготовки, расчёта и вывода.' }
    ],
    exampleSql: 'WITH service_stats AS (SELECT service, COUNT(*) AS tickets_count, ROUND(AVG(resolution_minutes), 1) AS avg_minutes FROM tickets GROUP BY service) SELECT service, tickets_count, avg_minutes FROM service_stats WHERE avg_minutes IS NOT NULL ORDER BY tickets_count DESC, service;',
    exampleDescription: 'CTE отделяет расчёт метрик от итоговой фильтрации и сортировки.',
    question: 'Главная практическая польза CTE в аналитическом запросе?',
    options: ['Всегда ускоряет выполнение', 'Делает этапы явными и проверяемыми', 'Автоматически создаёт индекс', 'Заменяет транзакцию'],
    correctIndex: 1,
    explanation: 'CTE прежде всего улучшает структуру и проверяемость; ускорение не гарантируется.'
  },
  windows: {
    prerequisites: ['cte'],
    objectives: ['Сохранять исходные строки при расчёте метрик', 'Использовать PARTITION BY', 'Различать RANK и ROW_NUMBER'],
    glossary: [
      { term: 'Окно', definition: 'Набор строк, доступный оконной функции для текущей строки.' },
      { term: 'PARTITION BY', definition: 'Разделение результата на независимые окна.' }
    ],
    exampleSql: 'SELECT ticket_id, service, resolution_minutes, RANK() OVER (PARTITION BY service ORDER BY resolution_minutes DESC) AS duration_rank FROM tickets WHERE resolution_minutes IS NOT NULL ORDER BY service, duration_rank, ticket_id;',
    exampleDescription: 'Ранг считается внутри сервиса, но каждая строка обращения остаётся в результате.',
    question: 'Чем окно принципиально отличается от GROUP BY?',
    options: ['Окно всегда быстрее', 'Окно сохраняет детализацию строк', 'Окно не поддерживает сортировку', 'GROUP BY работает только с числами'],
    correctIndex: 1,
    explanation: 'Оконная функция добавляет показатель к строкам, а GROUP BY обычно схлопывает их.'
  },
  dates: {
    prerequisites: ['windows'],
    objectives: ['Нормализовать временную гранулярность', 'Группировать по тому же выражению даты', 'Строить хронологический порядок'],
    glossary: [
      { term: 'Временная гранулярность', definition: 'Уровень детализации периода: час, день, неделя, месяц.' },
      { term: 'Календарный бакет', definition: 'Интервал, в который попадают события при временной агрегации.' }
    ],
    exampleSql: "SELECT date(created_at) AS created_day, COUNT(*) AS tickets_count FROM tickets GROUP BY date(created_at) ORDER BY created_day;",
    exampleDescription: 'date() приводит timestamp к единой дневной гранулярности до группировки.',
    question: 'Почему опасно группировать timestamp как исходную строку?',
    options: ['Нельзя использовать COUNT', 'Каждый момент может стать отдельной группой', 'SQLite удалит часовой пояс', 'ORDER BY перестанет работать'],
    correctIndex: 1,
    explanation: 'Без нормализации почти каждое событие имеет уникальный timestamp.'
  },
  text: {
    prerequisites: ['dates'],
    objectives: ['Строить категории через CASE', 'Использовать COALESCE осознанно', 'Нормализовать регистр и пробелы'],
    glossary: [
      { term: 'CASE', definition: 'Условное выражение, возвращающее значение по первому совпавшему условию.' },
      { term: 'COALESCE', definition: 'Первое не-NULL значение из списка.' }
    ],
    exampleSql: "SELECT ticket_id, priority, CASE WHEN priority IN ('Critical', 'High') THEN 'Urgent' ELSE 'Normal' END AS priority_group FROM tickets ORDER BY ticket_id;",
    exampleDescription: 'CASE переносит бизнес-классификацию приоритета в явное вычисляемое поле.',
    question: 'Зачем почти всегда нужен ELSE в CASE?',
    options: ['Для сортировки', 'Чтобы явно определить остальные случаи', 'Чтобы создать индекс', 'Чтобы убрать DISTINCT'],
    correctIndex: 1,
    explanation: 'Без ELSE неохваченные строки получают NULL, часто неожиданно для отчёта.'
  },
  'set-ops': {
    prerequisites: ['text'],
    objectives: ['Сверять структуру объединяемых SELECT', 'Различать UNION и UNION ALL', 'Применять общий ORDER BY'],
    glossary: [
      { term: 'UNION', definition: 'Вертикальное объединение совместимых результатов с удалением дублей.' },
      { term: 'UNION ALL', definition: 'Вертикальное объединение с сохранением всех строк.' }
    ],
    exampleSql: "SELECT service FROM tickets WHERE status = 'Open' UNION SELECT service FROM tickets WHERE priority = 'Critical' ORDER BY service;",
    exampleDescription: 'Два независимых критерия формируют единый уникальный список сервисов риска.',
    question: 'Когда выбирать UNION ALL?',
    options: ['Когда дубли значимы или уже исключены', 'Когда нужны разные числа столбцов', 'Когда нет ORDER BY', 'Только для строковых полей'],
    correctIndex: 0,
    explanation: 'UNION ALL не тратит работу на удаление дублей и сохраняет их смысл.'
  },
  'data-quality': {
    prerequisites: ['set-ops'],
    objectives: ['Формулировать проверяемое правило качества', 'Возвращать проблемные идентификаторы', 'Сначала измерять, затем исправлять'],
    glossary: [
      { term: 'Аномалия', definition: 'Значение или комбинация значений, нарушающая ожидаемое правило.' },
      { term: 'Профилирование данных', definition: 'Измерение распределений, пропусков, дублей и диапазонов.' }
    ],
    exampleSql: 'SELECT email, COUNT(*) AS duplicates_count FROM customers WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1 ORDER BY email;',
    exampleDescription: 'Проверка возвращает сами дубли и их частоту, не изменяя исходные данные.',
    question: 'Какой первый безопасный шаг при обнаружении дублей?',
    options: ['DELETE', 'Посчитать и вывести проблемные строки', 'Добавить DISTINCT во все отчёты', 'Отключить UNIQUE'],
    correctIndex: 1,
    explanation: 'Сначала нужно измерить масштаб и понять причину, не уничтожая данные.'
  },
  indexes: {
    prerequisites: ['data-quality'],
    objectives: ['Связывать индекс с конкретным запросом', 'Оценивать селективность', 'Понимать левый префикс составного индекса'],
    glossary: [
      { term: 'Селективность', definition: 'Насколько сильно условие сокращает число строк.' },
      { term: 'Левый префикс', definition: 'Начальные столбцы составного индекса, которые определяют доступные пути поиска.' }
    ],
    exampleSql: "EXPLAIN QUERY PLAN SELECT ticket_id FROM tickets WHERE service = 'VPN';",
    exampleDescription: 'План показывает, использует ли запрос существующий индекс idx_tickets_service.',
    question: 'Что чаще всего делает индекс бесполезным для запроса?',
    options: ['Наличие ORDER BY', 'Условие не использует левую часть индекса', 'Короткое имя индекса', 'COUNT(*) в SELECT'],
    correctIndex: 1,
    explanation: 'B-tree организован по порядку столбцов, поэтому пропуск левого префикса ограничивает поиск.'
  },
  explain: {
    prerequisites: ['indexes'],
    objectives: ['Различать SCAN и SEARCH', 'Проверять используемый индекс', 'Сравнивать план до и после изменения'],
    glossary: [
      { term: 'SCAN', definition: 'Чтение большого диапазона или всей таблицы.' },
      { term: 'SEARCH', definition: 'Доступ по индексу или ключу с более узким набором строк.' }
    ],
    exampleSql: "EXPLAIN QUERY PLAN SELECT t.ticket_id, e.name FROM tickets t JOIN engineers e ON e.engineer_id = t.engineer_id WHERE t.service = 'VPN';",
    exampleDescription: 'План позволяет увидеть отдельно путь к tickets и lookup строки engineers.',
    question: 'Что следует сделать после изменения индекса?',
    options: ['Считать оптимизацию завершённой', 'Повторно сравнить план и измерение', 'Удалить WHERE', 'Заменить JOIN на UNION'],
    correctIndex: 1,
    explanation: 'Оптимизация подтверждается повторным планом и измерением, а не предположением.'
  },
  transactions: {
    prerequisites: ['explain'],
    objectives: ['Объединять изменения атомарно', 'Проверять UPDATE до COMMIT', 'Использовать ROLLBACK для безопасной репетиции'],
    glossary: [
      { term: 'Атомарность', definition: 'Все действия транзакции применяются вместе или не применяются вовсе.' },
      { term: 'ROLLBACK', definition: 'Отмена изменений текущей транзакции.' }
    ],
    exampleSql: "BEGIN; UPDATE tickets SET status = status WHERE ticket_id = 1001; ROLLBACK; SELECT ticket_id, status FROM tickets WHERE ticket_id = 1001;",
    exampleDescription: 'Безопасная репетиция выполняет изменение и откатывает его до контрольного SELECT.',
    question: 'Главная защита от массового ошибочного UPDATE?',
    options: ['ORDER BY', 'Точная WHERE и проверка внутри транзакции', 'DISTINCT', 'VIEW'],
    correctIndex: 1,
    explanation: 'Ограничение строк и проверка перед COMMIT снижают риск необратимого изменения.'
  },
  schema: {
    prerequisites: ['transactions'],
    objectives: ['Выбирать первичный ключ', 'Кодировать инварианты ограничениями', 'Минимизировать необоснованные nullable-поля'],
    glossary: [
      { term: 'Ограничение', definition: 'Правило схемы, запрещающее некорректное состояние данных.' },
      { term: 'Нормализация', definition: 'Разделение сущностей и зависимостей для уменьшения аномалий.' }
    ],
    exampleSql: "CREATE TEMP TABLE escalation_rules(rule_id INTEGER PRIMARY KEY, service TEXT NOT NULL, priority TEXT NOT NULL, UNIQUE(service, priority)); PRAGMA table_info(escalation_rules);",
    exampleDescription: 'Временная таблица демонстрирует ключ, обязательные поля и уникальность бизнес-комбинации.',
    question: 'Где надёжнее закрепить обязательность business-critical поля?',
    options: ['Только в UI', 'Через NOT NULL или CHECK в схеме', 'В комментарии', 'Через ORDER BY'],
    correctIndex: 1,
    explanation: 'Ограничение схемы защищает данные независимо от конкретного клиента или UI.'
  },
  support: {
    prerequisites: ['schema'],
    objectives: ['Определять числитель и знаменатель метрики', 'Разделять backlog и closed flow', 'Добавлять детализацию для проверки'],
    glossary: [
      { term: 'SLA breach', definition: 'Случай, когда фактическое время превышает согласованное SLA.' },
      { term: 'Backlog', definition: 'Незавершённые обращения, ожидающие обработки или решения.' }
    ],
    exampleSql: "SELECT service, COUNT(*) AS closed_count, SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches, ROUND(100.0 * SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) / COUNT(*), 1) AS breach_rate FROM tickets WHERE status = 'Closed' GROUP BY service ORDER BY breach_rate DESC, service;",
    exampleDescription: 'Метрика явно фиксирует набор закрытых обращений, число нарушений и процент внутри сервиса.',
    question: 'Почему нельзя смешивать открытые обращения со средним временем решения?',
    options: ['У них нет service', 'У незакрытых строк фактическое время часто NULL', 'Они всегда Critical', 'GROUP BY запрещает это'],
    correctIndex: 1,
    explanation: 'Незакрытые обращения ещё не имеют окончательной длительности и искажают показатель.'
  },
  final: {
    prerequisites: ['support'],
    objectives: ['Строить многоэтапную витрину', 'Проверять каждый CTE', 'Документировать итоговые метрики и сортировку'],
    glossary: [
      { term: 'Витрина данных', definition: 'Подготовленный набор метрик и измерений для конкретного аналитического сценария.' },
      { term: 'Readiness', definition: 'Готовность запроса к повторяемому использованию: корректность, объяснимость и производительность.' }
    ],
    exampleSql: "WITH closed AS (SELECT service, engineer_id, resolution_minutes, sla_minutes FROM tickets WHERE status = 'Closed'), metrics AS (SELECT service, COUNT(*) AS tickets_count, ROUND(AVG(resolution_minutes), 1) AS avg_minutes, SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches FROM closed GROUP BY service) SELECT service, tickets_count, avg_minutes, breaches FROM metrics ORDER BY breaches DESC, avg_minutes DESC, service;",
    exampleDescription: 'Финальная витрина отделяет базовый набор закрытых обращений от расчёта и презентации метрик.',
    question: 'Что делает финальный аналитический SQL поддерживаемым?',
    options: ['Максимум вложенности', 'Понятные этапы, имена, проверки и стабильный вывод', 'SELECT *', 'Отсутствие комментариев и алиасов'],
    correctIndex: 1,
    explanation: 'Поддерживаемость определяется ясным конвейером и проверяемым контрактом результата.'
  }
};

function lessonFor(module: typeof modules[number], index: number): CurriculumLesson {
  const [moduleId, title, subtitle] = module;
  const guide = moduleGuides[moduleId];
  const blueprint = blueprints[moduleId];
  const sections: CurriculumSection[] = [
    {
      id: `${moduleId}-concept`,
      kind: 'concept',
      title: 'Модель и смысл',
      lead: guide.summary,
      paragraphs: [guide.mentalModel, `Связывай каждую конструкцию с контрактом результата: ${subtitle.toLowerCase()}.`],
      bullets: blueprint.objectives
    },
    {
      id: `${moduleId}-workflow`,
      kind: 'workflow',
      title: 'Рабочий алгоритм',
      lead: 'Используй короткий повторяемый цикл вместо попытки написать весь запрос сразу.',
      paragraphs: ['Сформулируй ожидаемую таблицу, собери минимальный запрос, проверь промежуточный результат и только затем усложняй.'],
      bullets: guide.checklist
    },
    {
      id: `${moduleId}-pitfalls`,
      kind: 'pitfalls',
      title: 'Ошибки и диагностика',
      lead: 'Проверяй не только синтаксис, но и форму результата, число строк, NULL и стабильность порядка.',
      paragraphs: ['Если запрос выполняется, но ответ неверный, сравни гранулярность, набор строк и момент применения каждого фильтра.'],
      bullets: guide.commonMistakes
    }
  ];

  return {
    id: `lesson-${moduleId}`,
    module: moduleId,
    title,
    subtitle,
    minutes: 12 + (index % 4) * 3,
    prerequisites: blueprint.prerequisites,
    objectives: blueprint.objectives,
    sections,
    glossary: blueprint.glossary,
    example: {
      id: `example-${moduleId}`,
      title: `Runnable example · ${title}`,
      description: blueprint.exampleDescription,
      sql: blueprint.exampleSql
    },
    check: {
      id: `check-${moduleId}`,
      question: blueprint.question,
      options: blueprint.options,
      correctIndex: blueprint.correctIndex,
      explanation: blueprint.explanation
    },
    practiceTaskIds: tasks.filter(task => task.module === moduleId).slice(0, 3).map(task => task.id)
  };
}

export const curriculumLessons = modules.map(lessonFor);

export const curriculumCheckpoints: CurriculumCheckpoint[] = [
  {
    id: 'checkpoint-foundation',
    title: 'Checkpoint · Надёжная база',
    description: 'Контракт результата, фильтрация, порядок и базовые метрики.',
    moduleIds: ['sql-thinking', 'select', 'filtering', 'sorting', 'aggregates'],
    taskIds: ['task-001', 'task-007', 'task-013', 'task-019', 'task-025'],
    passingScore: 70,
    criteria: ['Форма результата совпадает', 'NULL обработан явно', 'Порядок детерминирован', 'Метрики названы']
  },
  {
    id: 'checkpoint-query-design',
    title: 'Checkpoint · Сложные запросы',
    description: 'Группировка, связи, подзапросы, CTE и окна.',
    moduleIds: ['grouping', 'joins', 'subqueries', 'cte', 'windows'],
    taskIds: ['task-031', 'task-037', 'task-043', 'task-049', 'task-055'],
    passingScore: 75,
    criteria: ['JOIN не размножает строки неожиданно', 'Этапы CTE проверяемы', 'Окно сохраняет детализацию', 'Гранулярность групп верна']
  },
  {
    id: 'checkpoint-production',
    title: 'Checkpoint · Production SQL',
    description: 'Даты, текст, множества, качество данных и индексы.',
    moduleIds: ['dates', 'text', 'set-ops', 'data-quality', 'indexes'],
    taskIds: ['task-061', 'task-067', 'task-073', 'task-079', 'task-085'],
    passingScore: 78,
    criteria: ['Временная гранулярность явна', 'CASE покрывает остальные случаи', 'UNION выбран осознанно', 'Аномалии измеряются до исправления']
  },
  {
    id: 'checkpoint-support-readiness',
    title: 'Checkpoint · Support Analytics',
    description: 'Планы, транзакции, схема, SLA-метрики и финальная витрина.',
    moduleIds: ['explain', 'transactions', 'schema', 'support', 'final'],
    taskIds: ['task-091', 'task-097', 'task-103', 'task-109', 'task-115'],
    passingScore: 80,
    criteria: ['План подтверждает путь доступа', 'Изменения обратимы', 'Схема хранит инварианты', 'Метрика имеет период и определение', 'Витрина объяснима']
  }
];

export const capstoneProjects: CapstoneProject[] = [
  {
    id: 'project-incident-command',
    title: 'Incident Command Dashboard',
    summary: 'Операционная панель для руководителя смены поддержки.',
    scenario: 'T-Bonk хочет видеть нагрузку, SLA breaches и инженеров, которым требуется помощь, без ручной сверки нескольких отчётов.',
    estimatedMinutes: 75,
    moduleIds: ['joins', 'grouping', 'dates', 'windows', 'support'],
    deliverables: [
      {
        id: 'incident-base',
        title: 'Надёжный базовый набор',
        description: 'Собери обращения с инженером, сервисом, статусом и вычисленным SLA state.',
        acceptance: ['Одна строка — одно обращение', 'LEFT/INNER JOIN выбран по смыслу', 'Незакрытые обращения не получают ложный resolution time'],
        starterSql: 'WITH base AS (\n  SELECT\n    t.ticket_id,\n    t.service,\n    t.status,\n    e.name AS engineer_name\n  FROM tickets t\n  JOIN engineers e ON e.engineer_id = t.engineer_id\n)\nSELECT * FROM base;'
      },
      {
        id: 'incident-metrics',
        title: 'Сервисные метрики',
        description: 'Рассчитай backlog, closed count, breaches и breach rate по сервисам.',
        acceptance: ['Backlog и closed flow разделены', 'Процент имеет явный знаменатель', 'Сервисы сортируются по риску'],
        starterSql: 'WITH base AS (...)\nSELECT service, ...\nFROM base\nGROUP BY service;'
      },
      {
        id: 'incident-ranking',
        title: 'Приоритет внимания',
        description: 'Добавь ранжирование сервисов и инженеров по операционному риску.',
        acceptance: ['Использована оконная функция', 'Tie-breaker делает порядок стабильным', 'Показатель можно объяснить словами'],
        starterSql: 'WITH metrics AS (...)\nSELECT *, RANK() OVER (ORDER BY ...) AS risk_rank\nFROM metrics;'
      }
    ],
    rubric: [
      { id: 'incident-correctness', title: 'Корректность набора', weight: 35, description: 'Гранулярность и JOIN не создают ложные строки.' },
      { id: 'incident-metrics-rubric', title: 'Определение метрик', weight: 30, description: 'Числители, знаменатели и статусы зафиксированы.' },
      { id: 'incident-readability', title: 'Читаемость SQL', weight: 20, description: 'CTE и алиасы отражают предметный смысл.' },
      { id: 'incident-validation', title: 'Проверка результата', weight: 15, description: 'Есть контрольные срезы и стабильная сортировка.' }
    ]
  },
  {
    id: 'project-data-trust',
    title: 'Customer Data Trust Audit',
    summary: 'Аудит качества клиентских контактов и правил целостности.',
    scenario: 'Команда T-Bonk подозревает дубли email, пропуски и неоднозначные правила хранения контактов перед миграцией.',
    estimatedMinutes: 65,
    moduleIds: ['text', 'set-ops', 'data-quality', 'transactions', 'schema'],
    deliverables: [
      {
        id: 'trust-profile',
        title: 'Профиль качества',
        description: 'Измерь NULL, дубли и распределение клиентов по сегментам и регионам.',
        acceptance: ['Проблемные строки можно идентифицировать', 'NULL не считается обычным значением', 'Показатели имеют понятные имена'],
        starterSql: 'SELECT\n  COUNT(*) AS customers_count,\n  SUM(CASE WHEN email IS NULL THEN 1 ELSE 0 END) AS missing_email\nFROM customers;'
      },
      {
        id: 'trust-rules',
        title: 'Правила очистки',
        description: 'Опиши безопасную нормализацию строк и правила выбора канонической записи.',
        acceptance: ['Исходные значения не удаляются без аудита', 'CASE/COALESCE используются осознанно', 'Правило детерминировано'],
        starterSql: 'SELECT customer_id, lower(trim(email)) AS normalized_email\nFROM customers;'
      },
      {
        id: 'trust-schema',
        title: 'Защитная схема',
        description: 'Предложи ограничения и транзакционный план внедрения.',
        acceptance: ['Ограничения кодируют бизнес-инварианты', 'Есть rollback plan', 'Миграция сначала проверяется на копии'],
        starterSql: 'BEGIN;\n-- validate and migrate\nROLLBACK;'
      }
    ],
    rubric: [
      { id: 'trust-coverage', title: 'Покрытие правил', weight: 30, description: 'Проверены пропуски, дубли и нормализация.' },
      { id: 'trust-safety', title: 'Безопасность изменений', weight: 30, description: 'Нет разрушительных действий до проверки.' },
      { id: 'trust-integrity', title: 'Целостность схемы', weight: 25, description: 'Ограничения предотвращают повтор проблемы.' },
      { id: 'trust-evidence', title: 'Доказательства', weight: 15, description: 'Каждый вывод подтверждается запросом.' }
    ]
  },
  {
    id: 'project-executive-mart',
    title: 'T-Bonk SLA Executive Mart',
    summary: 'Финальная витрина SLA для еженедельного operating review.',
    scenario: 'Руководству нужен один повторяемый запрос: объём, среднее время, breaches, trend и рейтинг сервисов с объяснимым планом выполнения.',
    estimatedMinutes: 95,
    moduleIds: ['cte', 'windows', 'indexes', 'explain', 'support', 'final'],
    deliverables: [
      {
        id: 'mart-pipeline',
        title: 'Конвейер витрины',
        description: 'Раздели подготовку, расчёт и презентацию на именованные CTE.',
        acceptance: ['Каждый CTE имеет одно назначение', 'Промежуточные наборы можно проверить', 'Финальная гранулярность задокументирована'],
        starterSql: 'WITH base AS (...),\nmetrics AS (...),\nranked AS (...)\nSELECT * FROM ranked;'
      },
      {
        id: 'mart-trend',
        title: 'Trend и ranking',
        description: 'Добавь дневную динамику и рейтинг сервисов по breaches и времени.',
        acceptance: ['Период нормализован', 'Оконная функция выбрана осознанно', 'Порядок детерминирован'],
        starterSql: "SELECT date(created_at) AS day, service, ...\nFROM tickets\nGROUP BY date(created_at), service;"
      },
      {
        id: 'mart-plan',
        title: 'План и индексная гипотеза',
        description: 'Зафиксируй исходный план, предложи индекс и сравни результат.',
        acceptance: ['Есть EXPLAIN до изменения', 'Индекс связан с фильтром/соединением', 'Учтена стоимость записи'],
        starterSql: "EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE service = 'VPN' AND status = 'Closed';"
      },
      {
        id: 'mart-contract',
        title: 'Контракт для operating review',
        description: 'Опиши каждую метрику, фильтры, период и ограничения интерпретации.',
        acceptance: ['Нет неоднозначных алиасов', 'Backlog не смешан с closed metrics', 'Проверочные строки доступны'],
        starterSql: '-- Метрика: ...\n-- Набор строк: ...\n-- Период: ...\nSELECT ...;'
      }
    ],
    rubric: [
      { id: 'mart-correctness', title: 'Корректность витрины', weight: 35, description: 'Результат соответствует заявленному контракту.' },
      { id: 'mart-architecture', title: 'Архитектура запроса', weight: 25, description: 'Этапы изолированы и повторно проверяемы.' },
      { id: 'mart-performance', title: 'Производительность', weight: 20, description: 'План и индексная гипотеза подтверждены.' },
      { id: 'mart-communication', title: 'Объяснимость', weight: 20, description: 'Метрики можно безопасно использовать в review.' }
    ]
  }
];

export function lessonById(id: string) {
  return curriculumLessons.find(lesson => lesson.id === id);
}

export function lessonForModule(moduleId: string) {
  return curriculumLessons.find(lesson => lesson.module === moduleId);
}

export function curriculumSearch(query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return curriculumLessons;
  return curriculumLessons.filter(lesson => [
    lesson.title,
    lesson.subtitle,
    ...lesson.objectives,
    ...lesson.sections.flatMap(section => [section.title, section.lead, ...section.paragraphs, ...section.bullets]),
    ...lesson.glossary.flatMap(entry => [entry.term, entry.definition]),
    lesson.check.question
  ].join(' ').toLowerCase().includes(needle));
}
