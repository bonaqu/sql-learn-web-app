import type { CourseModuleId } from './curriculum';

export type ConceptCheckKind = 'prediction' | 'explanation' | 'diagnosis' | 'transfer';

export interface RunnableCounterexample {
  prediction: string;
  wrongSql: string;
  correctSql: string;
  explanation: string;
}

export interface CurriculumMisconception {
  id: string;
  label: string;
  explanation: string;
  remediation: string;
  counterexample?: RunnableCounterexample;
}

export interface CurriculumConcept {
  id: string;
  module: CourseModuleId;
  title: string;
  mentalModel: string;
  evidence: string;
  misconceptions: CurriculumMisconception[];
}

const misconception = (
  id: string,
  label: string,
  explanation: string,
  remediation: string,
  counterexample?: RunnableCounterexample
): CurriculumMisconception => ({ id, label, explanation, remediation, counterexample });

const concept = (
  module: CourseModuleId,
  id: string,
  title: string,
  mentalModel: string,
  evidence: string,
  misconceptions: CurriculumMisconception[]
): CurriculumConcept => ({ module, id, title, mentalModel, evidence, misconceptions });

export const conceptInventory = {
  'sql-thinking': [concept(
    'sql-thinking',
    'result-contract',
    'Контракт результата',
    'До синтаксиса фиксируются гранулярность строки, обязательные столбцы, правила NULL и стабильный порядок.',
    'Ученик может словами описать одну строку результата и проверить SQL на минимальном наборе.',
    [
      misconception('syntax-first', 'SQL начинается с синтаксиса', 'Запрос можно написать синтаксически верно, но получить таблицу другой гранулярности.', 'Сначала запиши: «одна строка — …», затем перечисли столбцы и только после этого FROM/WHERE.'),
      misconception('order-is-default', 'Порядок строк возникает сам', 'Без ORDER BY база не обещает повторяемый порядок.', 'Добавь полный ключ сортировки с дополнительным уникальным полем, если порядок входит в контракт.'),
      misconception('select-star-contract', 'SELECT * — нейтральный контракт', 'Состав результата меняется вместе со схемой и скрывает ненужные поля.', 'Перечисли только необходимые поля и дай вычислениям алиасы.')
    ]
  )],
  select: [concept(
    'select',
    'projection-contract',
    'Проекция и вычисляемые поля',
    'SELECT формирует столбцы результата; выражение создаёт новое значение, а алиас закрепляет его смысл.',
    'Ученик отличает выбор исходного поля от вычисления и объясняет тип и имя каждого результата.',
    [
      misconception('alias-speeds-query', 'Алиас ускоряет запрос', 'AS меняет имя результата, но не стоимость вычисления.', 'Объясни алиас как часть контракта результата, а производительность проверяй планом.'),
      misconception('distinct-is-grouping', 'DISTINCT заменяет GROUP BY', 'DISTINCT удаляет одинаковые строки результата, но не вычисляет показатели по группам.', 'Сначала сформулируй, нужны ли уникальные строки или агрегаты по категориям.'),
      misconception('expression-keeps-source-type', 'Любое выражение сохраняет исходный тип', 'Операции и функции могут менять тип и поведение NULL.', 'Проверь выражение отдельно на обычном, NULL и граничном значении.')
    ]
  )],
  filtering: [concept(
    'filtering',
    'three-valued-predicates',
    'Предикаты и трёхзначная логика',
    'WHERE оставляет только TRUE; FALSE и UNKNOWN отбрасываются. Сравнение с NULL обычно даёт UNKNOWN.',
    'Ученик предсказывает строки для TRUE, FALSE и UNKNOWN и ставит скобки вокруг смешанных AND/OR.',
    [
      misconception('null-equality', 'NULL проверяется через =', 'Выражение `email = NULL` не становится TRUE даже для отсутствующего email.', 'Используй IS NULL/IS NOT NULL и отдельно определи смысл отсутствия.', {
        prediction: 'Какие customer_id вернёт сравнение `email = NULL`?',
        wrongSql: 'SELECT customer_id FROM customers WHERE email = NULL ORDER BY customer_id;',
        correctSql: 'SELECT customer_id FROM customers WHERE email IS NULL ORDER BY customer_id;',
        explanation: 'Первый запрос не возвращает строк: сравнение даёт UNKNOWN. Второй явно проверяет отсутствие.'
      }),
      misconception('and-or-left-to-right', 'AND и OR выполняются просто слева направо', 'У AND приоритет выше OR, поэтому бизнес-условие без скобок часто расширяется.', 'Переведи условие в фразу и поставь скобки вокруг альтернатив.'),
      misconception('where-sees-aggregate', 'WHERE может фильтровать COUNT/AVG', 'WHERE выполняется до формирования групп и агрегатов.', 'Фильтруй строки через WHERE, а готовые группы через HAVING.')
    ]
  )],
  sorting: [concept(
    'sorting',
    'deterministic-order',
    'Детерминированный порядок',
    'ORDER BY сравнивает ключи слева направо; полный ключ устраняет неоднозначность при ties.',
    'Повторные запуски и пагинация дают один порядок на неизменных данных.',
    [
      misconception('limit-before-order', 'LIMIT выбирает строки до сортировки', 'Логический результат LIMIT определяется после ORDER BY.', 'Сначала сформулируй полный порядок, затем ограничивай выдачу.'),
      misconception('single-sort-key-stable', 'Одного неуникального ключа всегда достаточно', 'Строки с одинаковым значением могут менять взаимный порядок.', 'Добавь уникальный tie-breaker, обычно первичный ключ.'),
      misconception('offset-is-free', 'Большой OFFSET имеет постоянную стоимость', 'База часто должна пройти и отбросить предыдущие строки.', 'Для больших последовательных страниц используй keyset pagination.')
    ]
  )],
  aggregates: [concept(
    'aggregates',
    'set-to-value',
    'Множество превращается в показатель',
    'Агрегат считает характеристику выбранного набора; COUNT(*) считает строки, COUNT(column) — известные значения.',
    'Learner называет исходный набор, участие NULL и единицу измерения показателя.',
    [
      misconception('count-column-counts-null', 'COUNT(column) считает NULL', 'COUNT(column) пропускает отсутствующие значения.', 'Сравни COUNT(*) и COUNT(column) на одном наборе.'),
      misconception('avg-open-tickets', 'AVG автоматически исключает незавершённые бизнес-события корректно', 'NULL исключается математически, но это не решает, подходит ли набор бизнес-вопросу.', 'Сначала зафиксируй population через WHERE, затем считай AVG.'),
      misconception('aggregate-with-free-column', 'Можно смешать агрегат и произвольное поле', 'Поле вне GROUP BY не имеет однозначного значения для свёрнутого набора.', 'Либо агрегируй поле, либо добавь корректный ключ группировки.')
    ]
  )],
  grouping: [concept(
    'grouping',
    'group-grain',
    'Гранулярность группы',
    'Каждая уникальная комбинация GROUP BY становится одной строкой результата; лишний ключ дробит показатель.',
    'Learner предсказывает число групп до запуска и отличает WHERE от HAVING.',
    [
      misconception('extra-group-key-harmless', 'Лишний ключ GROUP BY не меняет метрику', 'Дополнительный ключ повышает гранулярность и разбивает одну бизнес-группу на несколько.', 'Перед SQL запиши: «одна строка результата — один …».', {
        prediction: 'Сколько строк будет на один service, если добавить status в GROUP BY?',
        wrongSql: 'SELECT service, status, COUNT(*) FROM tickets GROUP BY service, status ORDER BY service, status;',
        correctSql: 'SELECT service, COUNT(*) FROM tickets GROUP BY service ORDER BY service;',
        explanation: 'Первый запрос считает service × status, второй — ровно одну строку на service.'
      }),
      misconception('having-filters-rows', 'HAVING фильтрует исходные строки', 'HAVING применяется к уже сформированным группам.', 'Условие о строке помещай в WHERE, условие о COUNT/SUM — в HAVING.'),
      misconception('group-order-guaranteed', 'GROUP BY одновременно сортирует', 'Порядок групп не является контрактом.', 'Добавляй отдельный ORDER BY для отчёта.')
    ]
  )],
  joins: [concept(
    'joins',
    'join-cardinality',
    'Кардинальность соединения',
    'JOIN строит пары совпавших строк. Число строк определяется отношением ключей, а не видом выбранных столбцов.',
    'Learner прогнозирует multiplicity до JOIN и проверяет count/unique keys после него.',
    [
      misconception('join-only-adds-columns', 'JOIN только добавляет столбцы', 'Связь one-to-many размножает строку левой сущности.', 'Сравни COUNT(*) и COUNT(DISTINCT left_id) до и после JOIN.', {
        prediction: 'Сколько строк даст ticket 1001 после JOIN с его событиями?',
        wrongSql: 'SELECT t.ticket_id, t.service FROM tickets t JOIN ticket_events e ON e.ticket_id = t.ticket_id WHERE t.ticket_id = 1001;',
        correctSql: 'SELECT t.ticket_id, COUNT(e.event_id) AS event_count FROM tickets t LEFT JOIN ticket_events e ON e.ticket_id = t.ticket_id WHERE t.ticket_id = 1001 GROUP BY t.ticket_id;',
        explanation: 'Первый запрос возвращает по строке на событие. Второй явно фиксирует одну строку на ticket.'
      }),
      misconception('left-count-star', 'COUNT(*) после LEFT JOIN считает совпадения справа', 'Даже без совпадения остаётся одна null-extended строка.', 'Считай nullable ключ правой таблицы: COUNT(right.id).'),
      misconception('distinct-fixes-join', 'DISTINCT исправляет неверный JOIN', 'DISTINCT скрывает симптом, но не восстанавливает потерянную гранулярность и метрики.', 'Найди ключи и причину multiplicity до применения DISTINCT.')
    ]
  )],
  subqueries: [concept(
    'subqueries',
    'subquery-contract',
    'Контракт внутреннего запроса',
    'Подзапрос возвращает скаляр, множество или проверку существования; оператор снаружи должен соответствовать форме.',
    'Learner запускает подзапрос отдельно и объясняет число столбцов/строк и NULL-поведение.',
    [
      misconception('scalar-many-rows', 'Скалярное сравнение принимает много строк', 'Оператор = ожидает одно значение.', 'Для множества выбери IN/EXISTS или агрегируй до одного значения.'),
      misconception('not-in-null-safe', 'NOT IN безопасен при NULL', 'NULL внутри множества может превратить результат в UNKNOWN.', 'Используй коррелированный NOT EXISTS или исключи NULL доказанно.'),
      misconception('exists-returns-data', 'EXISTS зависит от выбранных столбцов', 'EXISTS проверяет наличие строки, содержимое SELECT внутри не важно.', 'Используй SELECT 1 и сосредоточься на корреляции.')
    ]
  )],
  cte: [concept(
    'cte',
    'named-query-stages',
    'Именованные этапы запроса',
    'CTE задаёт временный результат одного statement; ценность — явный контракт этапа, а не автоматическое ускорение.',
    'Каждый CTE можно проверить отдельно, а его имя и столбцы описывают одну задачу.',
    [
      misconception('cte-always-faster', 'CTE всегда ускоряет SQL', 'Оптимизатор может встроить или материализовать этап; форма сама по себе не обещает скорость.', 'Сравни EXPLAIN и измерение вместо предположения.'),
      misconception('cte-is-persistent', 'CTE сохраняется как таблица', 'CTE существует только внутри текущего statement.', 'Для повторного контракта используй view/table осознанно.'),
      misconception('many-ctes-equal-clarity', 'Чем больше CTE, тем понятнее запрос', 'Этапы без самостоятельного смысла увеличивают когнитивную нагрузку.', 'Оставляй CTE, который имеет проверяемый вход/выход.')
    ]
  )],
  windows: [concept(
    'windows',
    'window-keeps-detail',
    'Окно сохраняет строки',
    'Оконная функция вычисляет значение по partition/order, не схлопывая исходную детализацию.',
    'Learner отличает итоговую сортировку от ORDER BY внутри OVER и прогнозирует ties.',
    [
      misconception('window-equals-group', 'Окно работает как GROUP BY', 'GROUP BY уменьшает число строк, окно сохраняет каждую исходную строку.', 'Сравни число строк результата обоих вариантов.', {
        prediction: 'Сколько строк останется после COUNT(*) OVER (PARTITION BY service)?',
        wrongSql: 'SELECT service, COUNT(*) FROM tickets GROUP BY service ORDER BY service;',
        correctSql: 'SELECT ticket_id, service, COUNT(*) OVER (PARTITION BY service) AS service_count FROM tickets ORDER BY ticket_id;',
        explanation: 'GROUP BY даёт строку на service; окно оставляет строку на ticket и добавляет показатель.'
      }),
      misconception('rank-is-unique', 'RANK всегда даёт уникальные номера', 'При равных значениях RANK повторяет позицию и оставляет пропуски.', 'Выбери ROW_NUMBER/DENSE_RANK/RANK по требуемому поведению ties.'),
      misconception('outer-order-from-window', 'ORDER BY внутри OVER сортирует финальный вывод', 'Он определяет вычисление окна, но не порядок результирующей таблицы.', 'Добавь внешний ORDER BY отдельно.')
    ]
  )],
  dates: [concept(
    'dates',
    'time-grain',
    'Временная гранулярность',
    'Период определяется нормализованной границей и часовым контекстом; группировка должна использовать тот же ключ.',
    'Learner объясняет inclusive/exclusive границы и не сравнивает произвольные текстовые форматы.',
    [
      misconception('date-text-always-chronological', 'Любой текст даты сортируется хронологически', 'Только нормализованные форматы вроде ISO сохраняют хронологический порядок строк.', 'Приведи даты к одному формату/типу до сравнения.'),
      misconception('between-end-of-day', 'BETWEEN по дате автоматически включает весь последний день', 'Строка времени после полуночи может не попасть в текстовую верхнюю границу.', 'Используй полуинтервал >= start AND < next_boundary.'),
      misconception('missing-periods-appear', 'GROUP BY создаёт периоды без событий', 'Агрегация возвращает только существующие ключи.', 'Для полного календаря соединяйся с календарной таблицей/CTE.')
    ]
  )],
  text: [concept(
    'text',
    'explicit-normalization',
    'Явная нормализация строк',
    'Регистр, пробелы, пустая строка и NULL — разные состояния, которые объединяются только по бизнес-правилу.',
    'Learner строит CASE с полным покрытием и объясняет каждое COALESCE.',
    [
      misconception('empty-equals-null', 'Пустая строка равна NULL', 'Это разные значения и могут означать разные причины.', 'Проверяй NULL и TRIM(value) = "" отдельно.'),
      misconception('coalesce-is-cleaning', 'COALESCE всегда очищает данные', 'Он подставляет значение, но может стереть важное различие неизвестности.', 'Назови бизнес-смысл fallback перед применением.'),
      misconception('case-without-else-complete', 'CASE без ELSE покрывает остальные строки', 'Непопавшие строки получают NULL.', 'Добавь осознанный ELSE или явно прими NULL.')
    ]
  )],
  'set-ops': [concept(
    'set-ops',
    'compatible-vertical-results',
    'Вертикальная совместимость результатов',
    'UNION/INTERSECT/EXCEPT сопоставляют столбцы по позиции и требуют совместимого смысла и типа.',
    'Learner сверяет число/порядок столбцов и выбирает сохранение или удаление дублей.',
    [
      misconception('union-joins-columns', 'UNION соединяет таблицы по горизонтали', 'UNION добавляет строки одного результата под другим.', 'Для столбцов используй JOIN; для строк — set operation.'),
      misconception('union-all-is-unsafe', 'UNION ALL всегда хуже', 'Он сохраняет дубли и часто дешевле; это правильно, если дубли значимы.', 'Выбери семантику дублей до оператора.'),
      misconception('branch-order-persists', 'ORDER BY каждой ветки задаёт общий порядок', 'Финальный порядок задаётся одним ORDER BY после set operation.', 'Сортируй объединённый результат в конце.')
    ]
  )],
  'data-quality': [concept(
    'data-quality',
    'evidence-before-mutation',
    'Сначала измерение, затем исправление',
    'Quality query возвращает воспроизводимый набор подозрительных строк и причину, а не сразу удаляет данные.',
    'Learner показывает идентификаторы, правило и масштаб до mutation.',
    [
      misconception('duplicate-means-delete', 'Любой дубль нужно удалить', 'Повтор может быть допустимым событием или разными сущностями с общим атрибутом.', 'Определи business key и проверь строки вручную/правилом.'),
      misconception('nulls-are-same-duplicate', 'Все NULL образуют один обычный дубль', 'NULL означает неизвестность, и семантика уникальности зависит от правила/СУБД.', 'Определи, считается ли отсутствие нарушением отдельно.'),
      misconception('cleaning-without-audit', 'Исправление не требует сохранённого evidence', 'Без исходного набора нельзя проверить эффект или расследовать ошибку.', 'Сохрани query, counts и период перед DML.')
    ]
  )],
  indexes: [concept(
    'indexes',
    'index-matches-access-path',
    'Индекс под путь доступа',
    'B-tree помогает запросу, когда фильтр/порядок использует левый префикс индекса с достаточной селективностью.',
    'Learner сравнивает EXPLAIN до/после и учитывает стоимость записи.',
    [
      misconception('index-every-column', 'Индексировать нужно каждый столбец', 'Индексы занимают место и удорожают INSERT/UPDATE/DELETE.', 'Начни с частого дорогого запроса и измерь план.'),
      misconception('composite-order-irrelevant', 'Порядок столбцов составного индекса не важен', 'Левый префикс определяет доступные пути поиска.', 'Сопоставь равенства, диапазон и ORDER BY с порядком ключей.', {
        prediction: 'Использует ли `(priority, status)` поиск только по status так же эффективно?',
        wrongSql: "EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE status = 'Closed';",
        correctSql: "EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE priority = 'High' AND status = 'Closed';",
        explanation: 'Второй запрос использует левый префикс существующего индекса; status без priority может привести к scan.'
      }),
      misconception('index-guarantees-speed', 'Наличие индекса гарантирует ускорение', 'На маленьком или неселективном наборе scan может быть дешевле.', 'Доверяй плану и измерению, а не факту существования индекса.')
    ]
  )],
  explain: [concept(
    'explain',
    'plan-is-evidence',
    'План выполнения как доказательство',
    'EXPLAIN показывает выбранные операции доступа; он отвечает «как», но не доказывает корректность результата.',
    'Learner находит SCAN/SEARCH, индекс и порядок операций, затем сравнивает с измерением.',
    [
      misconception('plan-proves-correctness', 'Хороший план доказывает верный SQL', 'Быстро выполненный запрос может возвращать неверную гранулярность.', 'Сначала проверь result contract, затем производительность.'),
      misconception('scan-always-bad', 'Любой SCAN — проблема', 'Для маленькой таблицы или большого процента строк scan может быть оптимален.', 'Оцени объём и селективность.'),
      misconception('index-name-enough', 'Достаточно увидеть имя индекса', 'Важно, какие столбцы/условия реально использованы и что происходит дальше.', 'Прочитай весь plan tree и сравни rows/time.')
    ]
  )],
  transactions: [concept(
    'transactions',
    'atomic-verified-change',
    'Атомарное и проверяемое изменение',
    'Транзакция объединяет действия, но безопасность требует target SELECT, проверки эффекта и явного COMMIT/ROLLBACK.',
    'Learner может отменить тестовое изменение и объяснить invariant до/после.',
    [
      misconception('begin-makes-update-correct', 'BEGIN делает любой UPDATE безопасным', 'Транзакция позволяет откат, но неверный WHERE всё равно выбирает неверные строки.', 'Сначала выполни SELECT с тем же predicate.', {
        prediction: 'Что защищает от неверного target set: BEGIN или проверочный SELECT?',
        wrongSql: "BEGIN; UPDATE tickets SET status = 'Closed' WHERE service = 'LMS'; COMMIT;",
        correctSql: "BEGIN; SELECT ticket_id, status FROM tickets WHERE service = 'LMS'; UPDATE tickets SET status = 'Closed' WHERE service = 'LMS'; SELECT changes(); ROLLBACK;",
        explanation: 'BEGIN даёт границу отката; target SELECT и verification доказывают область изменения.'
      }),
      misconception('autocommit-is-one-big-transaction', 'Несколько statement автоматически атомарны вместе', 'В autocommit каждый statement может фиксироваться отдельно.', 'Оберни связанную операцию в явную transaction boundary.'),
      misconception('rollback-after-commit', 'ROLLBACK может отменить уже выполненный COMMIT', 'После фиксации транзакция завершена.', 'Проверяй результат до COMMIT и проектируй compensating action отдельно.')
    ]
  )],
  schema: [concept(
    'schema',
    'constraints-encode-invariants',
    'Схема хранит инварианты',
    'Ключи и constraints запрещают невозможные состояния для всех клиентов, а не только для UI.',
    'Learner различает entity key, relationship FK и бизнес-ограничение.',
    [
      misconception('ui-validation-enough', 'Валидации приложения достаточно', 'Другой клиент или ошибка кода может обойти UI.', 'Критичные инварианты дублируй constraint-ом базы.'),
      misconception('natural-key-always-best', 'Любой естественный атрибут стабилен как PK', 'Email, название и другие бизнес-значения могут меняться.', 'Оцени стабильность/уникальность и при необходимости используй surrogate key + UNIQUE.'),
      misconception('normalization-maximal', 'Чем больше таблиц, тем лучше схема', 'Декомпозиция должна устранять конкретные зависимости, а не дробить без контракта.', 'Назови функциональную зависимость и anomaly, которую исправляешь.')
    ]
  )],
  support: [concept(
    'support',
    'operational-metric-contract',
    'Операционная метрика с контекстом',
    'SLA/queue метрика имеет population, период, grain, denominator и исключения; без них число нельзя сравнивать.',
    'Learner воспроизводит отчёт и связывает аномалию с конкретными ticket IDs.',
    [
      misconception('average-is-enough', 'Среднее полностью описывает очередь', 'Хвост распределения и критичные инциденты могут скрыться.', 'Добавь counts, percentile/threshold buckets и разрезы.'),
      misconception('open-ticket-has-resolution', 'Незакрытое обращение можно считать как обычную длительность решения', 'У него нет финального resolution_minutes.', 'Определи censoring/age и отдели open от closed.'),
      misconception('metric-proves-cause', 'Корреляция в отчёте доказывает причину', 'SQL показывает связь и масштаб, но причинность требует дополнительного evidence.', 'Формулируй гипотезу и запрос, который может её опровергнуть.')
    ]
  )],
  final: [concept(
    'final',
    'reproducible-sql-delivery',
    'Воспроизводимая SQL-поставка',
    'Финальное решение включает SQL, grain, assumptions, validation queries и объяснение trade-offs.',
    'Другой инженер запускает решение на seed и получает тот же проверяемый вывод.',
    [
      misconception('final-query-only', 'Финал — только один большой SELECT', 'Без допущений и проверок результат трудно доверенно использовать.', 'Добавь README-like contract и контрольные queries.'),
      misconception('hardcoded-result', 'Совпавшие числа достаточно захардкодить', 'Решение должно вычисляться из данных и переноситься на новый период.', 'Проверь на изменённом seed/фильтре.'),
      misconception('no-failure-analysis', 'Успешный запуск не требует failure modes', 'NULL, дубли и рост данных могут изменить смысл/стоимость.', 'Опиши минимум три failure mode и проверки.')
    ]
  )],
  dml: [concept(
    'dml',
    'target-mutate-verify',
    'Target set → mutation → verification',
    'Безопасный DML сначала доказывает строки, затем меняет их в транзакции и проверяет фактический эффект.',
    'Target SELECT и mutation имеют один predicate, changes/returning совпадает с ожиданием.',
    [
      misconception('where-looks-right', 'WHERE можно оценить глазами', 'Малое отличие predicate может изменить тысячи строк.', 'Запусти тот же WHERE как SELECT и зафиксируй count/IDs.'),
      misconception('upsert-any-conflict', 'UPSERT реагирует на любой дубль', 'Ветка определяется конкретным unique/primary conflict target.', 'Назови ключ и оба сценария: insert/update.'),
      misconception('verification-optional', 'Успешный статус DML доказывает правильный эффект', 'Statement может изменить 0 или слишком много строк.', 'Проверь changes/RETURNING и инварианты.')
    ]
  )],
  'schema-evolution': [concept(
    'schema-evolution',
    'compatible-migration',
    'Совместимая эволюция схемы',
    'Миграция должна учитывать существующие данные, старых потребителей, backfill и rollback/roll-forward.',
    'Learner описывает phased rollout и проверяет invariant до включения constraint.',
    [
      misconception('rename-is-local', 'Rename влияет только на таблицу', 'Запросы, views и клиенты зависят от старого контракта.', 'Добавь compatibility layer и период миграции.'),
      misconception('constraint-before-cleanup', 'Новый constraint можно включить без проверки данных', 'Существующие строки могут нарушать правило.', 'Сначала audit/backfill, затем constraint.'),
      misconception('select-star-view-stable', 'View с SELECT * сохраняет контракт', 'Новые/переименованные столбцы меняют внешний API.', 'Перечисляй столбцы явно.')
    ]
  )],
  'null-logic-advanced': [concept(
    'null-logic-advanced',
    'explicit-unknown-semantics',
    'Явная семантика UNKNOWN',
    'NULL трактуется отдельно для сравнения, вычисления, сортировки и агрегата; COALESCE требует бизнес-смысла.',
    'Learner прогнозирует truth table и различает SQL NULL, JSON null и пустое значение.',
    [
      misconception('null-equals-null', 'NULL = NULL даёт TRUE', 'Сравнение неизвестных значений даёт UNKNOWN.', 'Используй IS/IS NULL или null-safe operator конкретного диалекта.', {
        prediction: 'Что вернут `NULL = NULL`, `NULL IS NULL` и WHERE для первого выражения?',
        wrongSql: 'SELECT NULL = NULL AS equals_null;',
        correctSql: 'SELECT NULL IS NULL AS is_null;',
        explanation: 'Равенство возвращает NULL/UNKNOWN; IS NULL возвращает 1/TRUE.'
      }),
      misconception('coalesce-neutral', 'COALESCE не меняет смысл данных', 'Fallback превращает неизвестность в конкретное значение.', 'Документируй, почему fallback допустим именно для этой метрики.'),
      misconception('not-in-safe', 'NOT IN эквивалентен NOT EXISTS при NULL', 'NULL в наборе может сделать все сравнения UNKNOWN.', 'Предпочитай коррелированный NOT EXISTS.')
    ]
  )],
  'conditional-aggregation': [concept(
    'conditional-aggregation',
    'shared-denominator',
    'Общий denominator',
    'Каждый conditional numerator считается по тому же явно определённому population, что и denominator.',
    'Learner подписывает numerator/denominator и проверяет сумму bucket counts.',
    [
      misconception('different-filter-same-rate', 'Фильтры числителя и знаменателя можно менять независимо', 'Процент теряет интерпретацию при разных populations.', 'Вынеси общий набор в CTE/WHERE.'),
      misconception('integer-division-keeps-fraction', 'Целочисленное деление сохраняет долю', 'В некоторых диалектах дробная часть отбрасывается.', 'Приведи один операнд к real/numeric.'),
      misconception('else-null-equals-zero', 'ELSE NULL и ELSE 0 всегда одинаковы', 'COUNT/AVG/SUM обрабатывают NULL по-разному.', 'Выбери значение исходя из агрегата и смысла.')
    ]
  )],
  'advanced-joins': [concept(
    'advanced-joins',
    'existence-without-multiplicity',
    'Existence без размножения строк',
    'EXISTS/NOT EXISTS выражают наличие связи, не добавляя строки правой стороны в результат.',
    'Learner выбирает semi/anti pattern и доказывает null-safety.',
    [
      misconception('join-distinct-is-semi', 'JOIN + DISTINCT всегда эквивалентен EXISTS', 'Он создаёт лишние пары и может скрыть ошибку ключа.', 'Используй EXISTS, когда нужны только строки слева.'),
      misconception('not-in-is-anti-join', 'NOT IN — универсальный anti-join', 'NULL в подзапросе меняет truth table.', 'Используй NOT EXISTS с явной корреляцией.'),
      misconception('for-all-is-many-exists', 'Условие «для всех» проверяется одним EXISTS', 'EXISTS доказывает хотя бы одно совпадение.', 'Сравни required set с matched set или используй double NOT EXISTS.')
    ]
  )],
  'recursive-cte': [concept(
    'recursive-cte',
    'bounded-recursion',
    'Anchor, recursive step и guard',
    'Рекурсивный CTE растёт от anchor по одному правилу и обязан иметь защиту от циклов/неограниченной глубины.',
    'Learner показывает depth/path и проверяет parent→child направление.',
    [
      misconception('union-all-stops-cycle', 'UNION ALL сам останавливает цикл', 'Повторяющиеся пути продолжают генерировать строки.', 'Храни path/depth и исключай посещённые узлы.'),
      misconception('anchor-is-filter', 'Anchor — просто финальный фильтр', 'Он задаёт исходное множество всей рекурсии.', 'Проверь anchor отдельно.'),
      misconception('parent-child-symmetric', 'Направление связи не важно', 'Перестановка parent/child меняет обход вверх/вниз.', 'Нарисуй один переход перед SQL.')
    ]
  )],
  'window-frames': [concept(
    'window-frames',
    'explicit-frame-boundaries',
    'Явные границы frame',
    'PARTITION задаёт последовательность, ORDER BY — направление, frame — строки для текущего вычисления.',
    'Learner предсказывает состав frame на ties и краях partition.',
    [
      misconception('default-frame-is-all', 'Frame по умолчанию всегда весь partition', 'При ORDER BY default часто заканчивается CURRENT ROW и может включать peers.', 'Указывай ROWS/RANGE и границы явно.', {
        prediction: 'Чем running total отличается от total по всему service?',
        wrongSql: 'SELECT ticket_id, service, SUM(sla_minutes) OVER (PARTITION BY service) AS total_sla FROM tickets ORDER BY service, ticket_id;',
        correctSql: 'SELECT ticket_id, service, SUM(sla_minutes) OVER (PARTITION BY service ORDER BY ticket_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_sla FROM tickets ORDER BY service, ticket_id;',
        explanation: 'Первый frame — весь partition; второй растёт до текущей строки.'
      }),
      misconception('rows-equals-time', 'ROWS 2 PRECEDING означает два дня', 'ROWS считает физические позиции, а не временной интервал.', 'Для времени формулируй нужный RANGE/предварительную агрегацию.'),
      misconception('ties-have-stable-neighbors', 'Неуникальный ORDER BY задаёт стабильных соседей', 'Порядок peers не определён.', 'Добавь уникальный tie-breaker.')
    ]
  )],
  'json-sql': [concept(
    'json-sql',
    'typed-json-extraction',
    'Проверяемое извлечение JSON',
    'Сначала проверяются валидность и тип, затем path и преобразование в SQL-значение.',
    'Learner различает отсутствующий key, JSON null и SQL NULL.',
    [
      misconception('all-payloads-same-schema', 'Все JSON payload имеют одинаковые ключи', 'Semi-structured данные меняются по event/type/version.', 'Фильтруй тип события и проверяй json_type.'),
      misconception('json-number-is-number', 'Извлечённое число всегда numeric', 'Источник может хранить строку или другой тип.', 'Проверь json_type и CAST осознанно.'),
      misconception('invalid-json-is-null', 'Некорректный JSON просто даёт NULL', 'Функция может завершиться ошибкой.', 'Проверяй json_valid до extraction.')
    ]
  )],
  'sql-security': [concept(
    'sql-security',
    'code-data-separation',
    'SQL-код отделён от данных',
    'Bind parameters передают значения отдельно; динамические идентификаторы выбираются из whitelist.',
    'Learner показывает, какая часть запроса является структурой, а какая пользовательским значением.',
    [
      misconception('escaping-is-enough', 'Ручного escaping достаточно', 'Контексты и кодировки сложны, а ошибка возвращает injection.', 'Используй API параметров драйвера.'),
      misconception('bind-identifiers', 'Имя столбца можно bind-ить как value', 'Параметры обычно не заменяют SQL syntax/identifier.', 'Сопоставь пользовательский выбор с whitelist констант.'),
      misconception('app-owner-role', 'Приложению удобнее выдать owner права', 'Компрометация запроса получает максимальный blast radius.', 'Используй least privilege и отдельные роли.')
    ]
  )],
  concurrency: [concept(
    'concurrency',
    'detectable-write-conflicts',
    'Обнаруживаемые конфликты записи',
    'Read-modify-write должен проверять, что прочитанная версия не изменилась; retry безопасен только для идемпотентной операции.',
    'Learner называет read/write set, conflict predicate и retry boundary.',
    [
      misconception('transaction-prevents-all-conflicts', 'Транзакция исключает все параллельные изменения', 'Isolation/locking определяют видимые anomalies; lost update всё ещё требует pattern.', 'Используй version column/conditional UPDATE и проверяй changes.', {
        prediction: 'Как обнаружить, что строку изменили после чтения?',
        wrongSql: "UPDATE tickets SET priority = 'Critical' WHERE ticket_id = 1002;",
        correctSql: "UPDATE tickets SET priority = 'Critical' WHERE ticket_id = 1002 AND priority = 'Medium'; SELECT changes();",
        explanation: 'Conditional predicate играет роль версии; changes() = 0 сообщает о конфликте.'
      }),
      misconception('retry-always-safe', 'Любой failed transaction можно повторить', 'Неидемпотентный side effect может выполниться дважды.', 'Сделай operation idempotent и ограничь retry конкретными transient errors.'),
      misconception('long-transaction-safer', 'Длинная транзакция безопаснее', 'Она дольше удерживает ресурсы и увеличивает конфликты.', 'Сократи transaction boundary до необходимого invariant.')
    ]
  )],
  'pagination-patterns': [concept(
    'pagination-patterns',
    'complete-keyset-cursor',
    'Полный keyset cursor',
    'Cursor содержит все значения полного детерминированного ORDER BY; predicate продолжает строго после последней строки.',
    'Learner доказывает отсутствие повторов/пропусков при ties.',
    [
      misconception('cursor-only-primary-sort', 'Cursor содержит только главный неуникальный ключ', 'При ties невозможно определить точную позицию.', 'Включи tie-breaker в ORDER BY и cursor.'),
      misconception('greater-or-equal-next-page', 'Следующая страница начинается с >= cursor', 'Последняя строка повторится.', 'Используй лексикографически строгий predicate.'),
      misconception('offset-scales-linearly-cheap', 'OFFSET одинаково дешёв на любой странице', 'База проходит предыдущие строки.', 'Для последовательного просмотра используй keyset.')
    ]
  )],
  'incident-investigation': [concept(
    'incident-investigation',
    'hypothesis-with-evidence',
    'Гипотеза, которую можно опровергнуть',
    'Расследование фиксирует период, baseline, масштаб, сегменты и evidence queries до вывода о причине.',
    'Другой инженер воспроизводит измерение и видит альтернативные объяснения.',
    [
      misconception('largest-segment-is-cause', 'Самый большой сегмент и есть причина', 'Объём может быть нормальным baseline.', 'Сравни rate/change относительно истории и denominator.'),
      misconception('one-query-conclusion', 'Одного агрегата достаточно для вывода', 'Агрегат скрывает распределение и конкретные строки.', 'Добавь drill-down IDs и контрольную выборку.'),
      misconception('correlation-is-root-cause', 'Совпадение по времени доказывает root cause', 'Это только поддержка гипотезы.', 'Сформулируй запрос, результат которого опровергнет гипотезу.')
    ]
  )]
} satisfies Record<CourseModuleId, CurriculumConcept[]>;

export const allCurriculumConcepts = Object.values(conceptInventory).flat();
export const allCurriculumMisconceptions = allCurriculumConcepts.flatMap(item => item.misconceptions);

export function conceptsForModule(moduleId: CourseModuleId) {
  return conceptInventory[moduleId];
}

export function conceptById(conceptId: string) {
  return allCurriculumConcepts.find(item => item.id === conceptId) || null;
}

export function misconceptionById(misconceptionId: string) {
  return allCurriculumMisconceptions.find(item => item.id === misconceptionId) || null;
}
