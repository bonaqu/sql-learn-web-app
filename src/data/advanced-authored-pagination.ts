import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type PaginationEvidenceTag =
  | 'total-order'
  | 'tie-breaker'
  | 'cursor-materialization'
  | 'forward-keyset'
  | 'strict-cursor-predicate'
  | 'tie-loss-counterexample'
  | 'backward-keyset'
  | 'reverse-then-display'
  | 'concurrent-insert'
  | 'offset-duplicate'
  | 'descending-keyset'
  | 'cursor-completeness'
  | 'opaque-cursor-contract'
  | 'deep-page-cost'
  | 'candidate-reduction'
  | 'duplicate-audit'
  | 'missing-item-audit'
  | 'order-audit'
  | 'pagination-reconciliation';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-221': {
    title: 'Определи стабильный полный порядок страниц',
    description: 'У нескольких событий одинаковый created_at, поэтому одного времени недостаточно. Построй полный порядок `created_at, event_id`, назначь stable_position и материализуй cursor_key, который различает tied rows.',
    starter: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, title TEXT NOT NULL);
INSERT INTO page_events VALUES
 (1,'2026-08-01T10:00:00Z','A'), (2,'2026-08-01T10:00:00Z','B'),
 (3,'2026-08-01T11:00:00Z','C'), (4,'2026-08-01T12:00:00Z','D');

SELECT event_id, created_at,
       ROW_NUMBER() OVER (ORDER BY ) AS stable_position,
       created_at || '#' || printf('%04d', event_id) AS cursor_key
FROM page_events
ORDER BY ;`,
    solution: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, title TEXT NOT NULL); INSERT INTO page_events VALUES (1,'2026-08-01T10:00:00Z','A'), (2,'2026-08-01T10:00:00Z','B'), (3,'2026-08-01T11:00:00Z','C'), (4,'2026-08-01T12:00:00Z','D'); SELECT event_id, created_at, ROW_NUMBER() OVER (ORDER BY created_at, event_id) AS stable_position, created_at || '#' || printf('%04d', event_id) AS cursor_key FROM page_events ORDER BY created_at, event_id;`,
    hints: ['event_id завершает порядок при одинаковом created_at.', 'Window и внешний ORDER BY должны совпадать.', 'Cursor хранит оба компонента порядка.']
  },
  'task-222': {
    title: 'Верни первую forward-page и row cursors',
    description: 'Получив стабильный порядок, верни первые три строки и cursor каждой строки. Последняя строка страницы становится continuation cursor; tied events должны остаться в детерминированном порядке по event_id.',
    starter: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL);
INSERT INTO page_events VALUES
 (1,'2026-08-01T10:00:00Z'), (2,'2026-08-01T10:00:00Z'),
 (3,'2026-08-01T11:00:00Z'), (4,'2026-08-01T12:00:00Z'),
 (5,'2026-08-01T13:00:00Z');

SELECT event_id, created_at,
       created_at || '#' || event_id AS row_cursor
FROM page_events
ORDER BY
LIMIT ;`,
    solution: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL); INSERT INTO page_events VALUES (1,'2026-08-01T10:00:00Z'), (2,'2026-08-01T10:00:00Z'), (3,'2026-08-01T11:00:00Z'), (4,'2026-08-01T12:00:00Z'), (5,'2026-08-01T13:00:00Z'); SELECT event_id, created_at, created_at || '#' || event_id AS row_cursor FROM page_events ORDER BY created_at, event_id LIMIT 3;`,
    hints: ['Page size равен 3.', 'ORDER BY повторяет полный порядок.', 'Continuation cursor берётся из третьей строки.']
  },
  'task-223': {
    title: 'Продолжи forward-page строгим composite cursor',
    description: 'После cursor `(10:00, 2)` верни следующие три события. Используй строгое tuple-сравнение по тем же компонентам, что и ORDER BY, чтобы не повторять cursor row и не пропускать tied values.',
    starter: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL);
INSERT INTO page_events VALUES
 (1,'2026-08-01T10:00:00Z'), (2,'2026-08-01T10:00:00Z'),
 (3,'2026-08-01T11:00:00Z'), (4,'2026-08-01T12:00:00Z'),
 (5,'2026-08-01T13:00:00Z'), (6,'2026-08-01T14:00:00Z');

SELECT event_id, created_at
FROM page_events
WHERE  > ('2026-08-01T10:00:00Z', 2)
ORDER BY created_at, event_id
LIMIT 3;`,
    solution: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL); INSERT INTO page_events VALUES (1,'2026-08-01T10:00:00Z'), (2,'2026-08-01T10:00:00Z'), (3,'2026-08-01T11:00:00Z'), (4,'2026-08-01T12:00:00Z'), (5,'2026-08-01T13:00:00Z'), (6,'2026-08-01T14:00:00Z'); SELECT event_id, created_at FROM page_events WHERE (created_at, event_id) > ('2026-08-01T10:00:00Z', 2) ORDER BY created_at, event_id LIMIT 3;`,
    hints: ['Tuple predicate повторяет ORDER BY.', 'Используй >, а не >=.', 'Следующая страница начинается с event_id 3.']
  },
  'task-224': {
    title: 'Докажи потерю строки timestamp-only cursor',
    description: 'Три события имеют один timestamp, а cursor остановился на event_id 2. Сравни continuation только по времени с composite cursor и выведи, сколько строк timestamp-only стратегия потеряла на границе tie.',
    starter: `-- Напиши решение с нуля:
-- создай события 1,2,3 с timestamp 10:00 и событие 4 с 11:00;
-- unsafe продолжает только по created_at > 10:00;
-- safe продолжает по (created_at,event_id) > (10:00,2);
-- верни оба списка IDs и разницу counts.`,
    solution: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL); INSERT INTO page_events VALUES (1,'2026-08-01T10:00:00Z'), (2,'2026-08-01T10:00:00Z'), (3,'2026-08-01T10:00:00Z'), (4,'2026-08-01T11:00:00Z'); WITH unsafe AS (SELECT event_id FROM page_events WHERE created_at > '2026-08-01T10:00:00Z' ORDER BY created_at, event_id), safe AS (SELECT event_id FROM page_events WHERE (created_at, event_id) > ('2026-08-01T10:00:00Z', 2) ORDER BY created_at, event_id) SELECT (SELECT GROUP_CONCAT(event_id, ',') FROM unsafe) AS timestamp_only_ids, (SELECT GROUP_CONCAT(event_id, ',') FROM safe) AS composite_cursor_ids, (SELECT COUNT(*) FROM safe) - (SELECT COUNT(*) FROM unsafe) AS rows_lost_by_tie;`,
    hints: ['Unsafe result содержит только 4.', 'Composite cursor сохраняет event_id 3.', 'Разница counts должна быть 1.']
  },
  'task-225': {
    title: 'Построй previous-page через обратный поиск',
    description: 'Чтобы получить три строки перед cursor `(05:00,5)`, сначала ищи в обратном порядке с predicate `<`, ограничь три строки, затем снова отсортируй их по прямому порядку для отображения пользователю.',
    starter: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL);
INSERT INTO page_events VALUES
 (1,'2026-08-01T01:00:00Z'), (2,'2026-08-01T02:00:00Z'),
 (3,'2026-08-01T03:00:00Z'), (4,'2026-08-01T04:00:00Z'),
 (5,'2026-08-01T05:00:00Z'), (6,'2026-08-01T06:00:00Z');

WITH previous_desc AS (
  SELECT event_id, created_at FROM page_events
  WHERE  < ('2026-08-01T05:00:00Z', 5)
  ORDER BY created_at DESC, event_id DESC
  LIMIT 3
)
SELECT event_id, created_at FROM previous_desc
ORDER BY ;`,
    solution: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL); INSERT INTO page_events VALUES (1,'2026-08-01T01:00:00Z'), (2,'2026-08-01T02:00:00Z'), (3,'2026-08-01T03:00:00Z'), (4,'2026-08-01T04:00:00Z'), (5,'2026-08-01T05:00:00Z'), (6,'2026-08-01T06:00:00Z'); WITH previous_desc AS (SELECT event_id, created_at FROM page_events WHERE (created_at, event_id) < ('2026-08-01T05:00:00Z', 5) ORDER BY created_at DESC, event_id DESC LIMIT 3) SELECT event_id, created_at FROM previous_desc ORDER BY created_at, event_id;`,
    hints: ['Внутренний query выбирает ближайшие предыдущие строки.', 'LIMIT применяется в DESC-порядке.', 'Внешний ORDER BY возвращает display order.']
  },
  'task-226': {
    title: 'Сравни keyset и OFFSET после concurrent insert',
    description: 'После чтения первой страницы вставь новую строку перед её началом. Keyset continuation по последнему cursor не должен дублировать page 1, а OFFSET 3 сдвинется и повторит event_id 3; выведи оба результата.',
    starter: `-- Напиши решение с нуля:
-- создай события 1..6, сохрани first_page из первых трёх;
-- вставь событие 7 перед всеми прочитанными строками;
-- получи keyset page после cursor id=3 и OFFSET page OFFSET 3;
-- верни ID lists и duplicate counts относительно first_page.`,
    solution: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL); INSERT INTO page_events VALUES (1,'2026-08-01T01:00:00Z'), (2,'2026-08-01T02:00:00Z'), (3,'2026-08-01T03:00:00Z'), (4,'2026-08-01T04:00:00Z'), (5,'2026-08-01T05:00:00Z'), (6,'2026-08-01T06:00:00Z'); CREATE TEMP TABLE first_page AS SELECT event_id, created_at FROM page_events ORDER BY created_at, event_id LIMIT 3; INSERT INTO page_events VALUES (7,'2026-08-01T00:30:00Z'); WITH keyset_page AS (SELECT event_id FROM page_events WHERE (created_at, event_id) > ('2026-08-01T03:00:00Z', 3) ORDER BY created_at, event_id LIMIT 3), offset_page AS (SELECT event_id FROM page_events ORDER BY created_at, event_id LIMIT 3 OFFSET 3) SELECT (SELECT GROUP_CONCAT(event_id, ',') FROM keyset_page) AS keyset_ids, (SELECT GROUP_CONCAT(event_id, ',') FROM offset_page) AS offset_ids, (SELECT COUNT(*) FROM keyset_page k JOIN first_page f USING(event_id)) AS keyset_duplicates, (SELECT COUNT(*) FROM offset_page o JOIN first_page f USING(event_id)) AS offset_duplicates;`,
    hints: ['Новая строка меняет физическую позицию OFFSET.', 'Cursor остаётся привязан к event_id 3.', 'Ожидается 0 keyset duplicates и 1 offset duplicate.']
  },
  'task-227': {
    title: 'Продолжи descending feed правильным predicate',
    description: 'Для ленты `created_at DESC, event_id DESC` continuation после cursor `(05:00,5)` использует tuple `<`, а не `>`. Верни две следующие строки в том же descending display order.',
    starter: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL);
INSERT INTO page_events VALUES
 (1,'2026-08-01T01:00:00Z'), (2,'2026-08-01T02:00:00Z'),
 (3,'2026-08-01T03:00:00Z'), (4,'2026-08-01T04:00:00Z'),
 (5,'2026-08-01T05:00:00Z'), (6,'2026-08-01T06:00:00Z');

SELECT event_id, created_at FROM page_events
WHERE  ('2026-08-01T05:00:00Z', 5)
ORDER BY created_at DESC, event_id DESC
LIMIT 2;`,
    solution: `CREATE TEMP TABLE page_events(event_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL); INSERT INTO page_events VALUES (1,'2026-08-01T01:00:00Z'), (2,'2026-08-01T02:00:00Z'), (3,'2026-08-01T03:00:00Z'), (4,'2026-08-01T04:00:00Z'), (5,'2026-08-01T05:00:00Z'), (6,'2026-08-01T06:00:00Z'); SELECT event_id, created_at FROM page_events WHERE (created_at, event_id) < ('2026-08-01T05:00:00Z', 5) ORDER BY created_at DESC, event_id DESC LIMIT 2;`,
    hints: ['Направление predicate меняется вместе с DESC.', 'Компоненты cursor и ORDER BY совпадают.', 'Результат: event_id 4, затем 3.']
  },
  'task-228': {
    title: 'Проверь полноту opaque cursor payload',
    description: 'Курсор считается пригодным для continuation только если содержит оба компонента полного порядка. Посчитай число заполненных компонентов и отклони timestamp-only, id-only и пустой payload как incomplete.',
    starter: `CREATE TEMP TABLE cursor_requests(request_id INTEGER PRIMARY KEY, created_at TEXT, event_id INTEGER);
INSERT INTO cursor_requests VALUES
 (1,'2026-08-01T10:00:00Z',20),
 (2,'2026-08-01T10:00:00Z',NULL), (3,NULL,20), (4,NULL,NULL);

SELECT request_id,
        AS cursor_components,
       CASE WHEN  THEN 'complete' ELSE 'incomplete' END AS cursor_state
FROM cursor_requests
ORDER BY request_id;`,
    solution: `CREATE TEMP TABLE cursor_requests(request_id INTEGER PRIMARY KEY, created_at TEXT, event_id INTEGER); INSERT INTO cursor_requests VALUES (1,'2026-08-01T10:00:00Z',20), (2,'2026-08-01T10:00:00Z',NULL), (3,NULL,20), (4,NULL,NULL); SELECT request_id, (created_at IS NOT NULL) + (event_id IS NOT NULL) AS cursor_components, CASE WHEN created_at IS NOT NULL AND event_id IS NOT NULL THEN 'complete' ELSE 'incomplete' END AS cursor_state FROM cursor_requests ORDER BY request_id;`,
    hints: ['Boolean expressions SQLite дают 0/1.', 'Complete требует AND двух компонентов.', 'Opaque encoding не отменяет validation после decode.']
  },
  'task-229': {
    title: 'Сравни deep OFFSET work с keyset candidates',
    description: 'На наборе из 100 строк оцени работу для страницы после 90-й позиции. OFFSET должен пройти 95 строк ради пяти результатов, а keyset после id 90 имеет только десять кандидатов; выведи reduction.',
    starter: `WITH RECURSIVE items(item_id) AS (
  SELECT 1 UNION ALL SELECT item_id + 1 FROM items WHERE item_id < 100
), parameters AS (
  SELECT 90 AS deep_offset, 90 AS last_seen_id, 5 AS page_size
)
SELECT  AS offset_rows_touched,
        AS keyset_candidate_rows,
        AS returned_rows,
        AS candidate_reduction
FROM parameters;`,
    solution: `WITH RECURSIVE items(item_id) AS (SELECT 1 UNION ALL SELECT item_id + 1 FROM items WHERE item_id < 100), parameters AS (SELECT 90 AS deep_offset, 90 AS last_seen_id, 5 AS page_size) SELECT MIN((SELECT COUNT(*) FROM items), deep_offset + page_size) AS offset_rows_touched, (SELECT COUNT(*) FROM items WHERE item_id > last_seen_id) AS keyset_candidate_rows, MIN(page_size, (SELECT COUNT(*) FROM items WHERE item_id > last_seen_id)) AS returned_rows, MIN((SELECT COUNT(*) FROM items), deep_offset + page_size) - (SELECT COUNT(*) FROM items WHERE item_id > last_seen_id) AS candidate_reduction FROM parameters;`,
    hints: ['OFFSET 90 + LIMIT 5 требует пройти 95 позиций.', 'Keyset-кандидаты — item_id > 90.', 'Reduction равен 85.']
  },
  'task-230': {
    title: 'Проведи pagination trace reconciliation',
    description: 'Сверь ожидаемые items 1..6 с фактическими emission pages, где item 3 повторён, а item 5 пропущен. Отчёт должен показать duplicate, missing, order violation и внутренний emission gap без сокрытия дефекта.',
    starter: `CREATE TEMP TABLE expected_items(item_id INTEGER PRIMARY KEY);
INSERT INTO expected_items VALUES (1),(2),(3),(4),(5),(6);
CREATE TEMP TABLE page_emissions(page_number INTEGER NOT NULL, position INTEGER NOT NULL, item_id INTEGER NOT NULL);
INSERT INTO page_emissions VALUES
 (1,1,1),(1,2,2),(1,3,3), (2,1,3),(2,2,4),(2,3,6);

-- Построй ordered с LAG, duplicate count и missing set.
-- Верни expected/emitted/distinct, duplicate_rows, missing_items/IDs,
-- order_violations и emission_reconciliation_gap.`,
    solution: `CREATE TEMP TABLE expected_items(item_id INTEGER PRIMARY KEY); INSERT INTO expected_items VALUES (1),(2),(3),(4),(5),(6); CREATE TEMP TABLE page_emissions(page_number INTEGER NOT NULL, position INTEGER NOT NULL, item_id INTEGER NOT NULL); INSERT INTO page_emissions VALUES (1,1,1),(1,2,2),(1,3,3),(2,1,3),(2,2,4),(2,3,6); WITH ordered AS (SELECT *, LAG(item_id) OVER (ORDER BY page_number, position) AS previous_item_id FROM page_emissions), duplicate_counts AS (SELECT COUNT(*) - COUNT(DISTINCT item_id) AS duplicate_rows FROM page_emissions), missing AS (SELECT e.item_id FROM expected_items e WHERE NOT EXISTS (SELECT 1 FROM page_emissions p WHERE p.item_id = e.item_id)) SELECT (SELECT COUNT(*) FROM expected_items) AS expected_items, COUNT(*) AS emitted_rows, COUNT(DISTINCT item_id) AS distinct_items, (SELECT duplicate_rows FROM duplicate_counts) AS duplicate_rows, (SELECT COUNT(*) FROM missing) AS missing_items, (SELECT GROUP_CONCAT(item_id, ',') FROM missing) AS missing_ids, SUM(CASE WHEN previous_item_id IS NOT NULL AND item_id <= previous_item_id THEN 1 ELSE 0 END) AS order_violations, COUNT(*) - COUNT(DISTINCT item_id) - (SELECT duplicate_rows FROM duplicate_counts) AS emission_reconciliation_gap FROM ordered;`,
    hints: ['Duplicate rows = emitted - distinct.', 'Missing set строится anti-join к emissions.', 'LAG выявляет повтор или обратный ход порядка.']
  }
};

export const paginationAuthoredTaskEvidence: Readonly<Record<string, readonly PaginationEvidenceTag[]>> = {
  'task-221': ['total-order', 'tie-breaker', 'cursor-materialization'],
  'task-222': ['total-order', 'cursor-materialization', 'forward-keyset'],
  'task-223': ['forward-keyset', 'strict-cursor-predicate', 'tie-breaker'],
  'task-224': ['tie-loss-counterexample', 'tie-breaker'],
  'task-225': ['backward-keyset', 'reverse-then-display'],
  'task-226': ['concurrent-insert', 'offset-duplicate', 'forward-keyset'],
  'task-227': ['descending-keyset', 'strict-cursor-predicate'],
  'task-228': ['cursor-completeness', 'opaque-cursor-contract'],
  'task-229': ['deep-page-cost', 'candidate-reduction'],
  'task-230': ['duplicate-audit', 'missing-item-audit', 'order-audit', 'pagination-reconciliation']
};

export function advancedPaginationTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedPaginationTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedPaginationTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}
