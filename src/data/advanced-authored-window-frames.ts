import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type WindowFrameEvidenceTag =
  | 'running-total'
  | 'deterministic-order'
  | 'rows-frame'
  | 'range-frame'
  | 'peer-groups'
  | 'rolling-average'
  | 'partition-reset'
  | 'centered-window'
  | 'edge-frame'
  | 'lag-delta'
  | 'baseline-row'
  | 'gaps-and-islands'
  | 'stable-group-key'
  | 'sessionization'
  | 'time-gap-boundary'
  | 'cumulative-distinct'
  | 'first-occurrence-flag'
  | 'ranking-ties'
  | 'rank-semantics'
  | 'last-value-frame'
  | 'unbounded-following';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-181': {
    title: 'Посчитай running total с полным порядком',
    description: 'Для каждого сервиса посчитай накопительный объём. Две строки могут иметь одинаковый event_at, поэтому frame `ROWS` обязан использовать event_id как tie-breaker; без полного порядка running total недетерминирован.',
    starter: `CREATE TEMP TABLE running_events(
  event_id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  event_at TEXT NOT NULL,
  amount INTEGER NOT NULL
);
INSERT INTO running_events VALUES
  (1, 'VPN', '2026-08-01T10:00:00Z', 10),
  (2, 'VPN', '2026-08-01T10:00:00Z', 20),
  (3, 'VPN', '2026-08-01T11:00:00Z', 5),
  (4, 'LMS', '2026-08-01T09:00:00Z', 7),
  (5, 'LMS', '2026-08-01T10:00:00Z', 3);

SELECT event_id, service, event_at, amount,
       SUM(amount) OVER (
         PARTITION BY
         ORDER BY
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS running_amount
FROM running_events
ORDER BY service, event_at, event_id;`,
    solution: `CREATE TEMP TABLE running_events(event_id INTEGER PRIMARY KEY, service TEXT NOT NULL, event_at TEXT NOT NULL, amount INTEGER NOT NULL); INSERT INTO running_events VALUES (1, 'VPN', '2026-08-01T10:00:00Z', 10), (2, 'VPN', '2026-08-01T10:00:00Z', 20), (3, 'VPN', '2026-08-01T11:00:00Z', 5), (4, 'LMS', '2026-08-01T09:00:00Z', 7), (5, 'LMS', '2026-08-01T10:00:00Z', 3); SELECT event_id, service, event_at, amount, SUM(amount) OVER (PARTITION BY service ORDER BY event_at, event_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_amount FROM running_events ORDER BY service, event_at, event_id;`,
    hints: [
      'PARTITION BY service сбрасывает накопление между сервисами.',
      'ORDER BY event_at, event_id задаёт полный стабильный порядок peers.',
      'Явный ROWS frame включает текущую физическую строку, а не всю peer-группу.'
    ]
  },
  'task-182': {
    title: 'Сравни ROWS и RANGE на peer-строках',
    description: 'На данных с одинаковым sort_key выведи два cumulative sum. `ROWS` добавляет физические строки по одной, а `RANGE ... CURRENT ROW` включает всю peer-группу с тем же ключом. Результат должен явно показать различие.',
    starter: `CREATE TEMP TABLE peer_values(
  row_id INTEGER PRIMARY KEY,
  sort_key INTEGER NOT NULL,
  amount INTEGER NOT NULL
);
INSERT INTO peer_values VALUES (1, 1, 10), (2, 1, 20), (3, 2, 5);

SELECT row_id, sort_key, amount,
       SUM(amount) OVER (
         ORDER BY sort_key, row_id
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS rows_running,
       SUM(amount) OVER (
         ORDER BY
         RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS range_running
FROM peer_values
ORDER BY row_id;`,
    solution: `CREATE TEMP TABLE peer_values(row_id INTEGER PRIMARY KEY, sort_key INTEGER NOT NULL, amount INTEGER NOT NULL); INSERT INTO peer_values VALUES (1, 1, 10), (2, 1, 20), (3, 2, 5); SELECT row_id, sort_key, amount, SUM(amount) OVER (ORDER BY sort_key, row_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rows_running, SUM(amount) OVER (ORDER BY sort_key RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS range_running FROM peer_values ORDER BY row_id;`,
    hints: [
      'ROWS использует sort_key, row_id и поэтому добавляет row 1 до row 2.',
      'RANGE должен сортировать только по sort_key, чтобы строки 1 и 2 были peers.',
      'У обеих peer-строк range_running сразу равен 30.'
    ]
  },
  'task-183': {
    title: 'Построй rolling average последних трёх строк',
    description: 'Для каждой команды посчитай среднее текущей и двух предыдущих записей. Frame должен быть `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`, а partition — по team, чтобы история одной команды не попадала в другую.',
    starter: `CREATE TEMP TABLE rolling_metrics(
  metric_id INTEGER PRIMARY KEY,
  team TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  value REAL NOT NULL
);
INSERT INTO rolling_metrics VALUES
  (1, 'A', '2026-08-01', 10), (2, 'A', '2026-08-02', 20),
  (3, 'A', '2026-08-03', 30), (4, 'A', '2026-08-04', 40),
  (5, 'B', '2026-08-01', 5), (6, 'B', '2026-08-02', 15);

SELECT team, metric_date, value,
       ROUND(AVG(value) OVER (
         PARTITION BY
         ORDER BY
         ROWS BETWEEN
       ), 3) AS rolling_average
FROM rolling_metrics
ORDER BY team, metric_date;`,
    solution: `CREATE TEMP TABLE rolling_metrics(metric_id INTEGER PRIMARY KEY, team TEXT NOT NULL, metric_date TEXT NOT NULL, value REAL NOT NULL); INSERT INTO rolling_metrics VALUES (1, 'A', '2026-08-01', 10), (2, 'A', '2026-08-02', 20), (3, 'A', '2026-08-03', 30), (4, 'A', '2026-08-04', 40), (5, 'B', '2026-08-01', 5), (6, 'B', '2026-08-02', 15); SELECT team, metric_date, value, ROUND(AVG(value) OVER (PARTITION BY team ORDER BY metric_date, metric_id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 3) AS rolling_average FROM rolling_metrics ORDER BY team, metric_date;`,
    hints: [
      'PARTITION BY team изолирует временные ряды.',
      'ORDER BY metric_date, metric_id делает порядок полным.',
      'На первых двух строках frame естественно содержит меньше трёх значений.'
    ]
  },
  'task-184': {
    title: 'Посчитай centered window и обработай края',
    description: 'Для каждой точки посчитай среднее предыдущей, текущей и следующей строки. Frame `1 PRECEDING ... 1 FOLLOWING` автоматически сужается на краях; верни также frame_rows, чтобы размер окна был наблюдаемым.',
    starter: `CREATE TEMP TABLE centered_values(
  point_id INTEGER PRIMARY KEY,
  position INTEGER NOT NULL,
  value REAL NOT NULL
);
INSERT INTO centered_values VALUES
  (1, 1, 10), (2, 2, 20), (3, 3, 50), (4, 4, 100);

SELECT point_id, position, value,
       COUNT(*) OVER (ORDER BY position ROWS BETWEEN ) AS frame_rows,
       ROUND(AVG(value) OVER (ORDER BY position ROWS BETWEEN ), 3) AS centered_average
FROM centered_values
ORDER BY position;`,
    solution: `CREATE TEMP TABLE centered_values(point_id INTEGER PRIMARY KEY, position INTEGER NOT NULL, value REAL NOT NULL); INSERT INTO centered_values VALUES (1, 1, 10), (2, 2, 20), (3, 3, 50), (4, 4, 100); SELECT point_id, position, value, COUNT(*) OVER (ORDER BY position ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS frame_rows, ROUND(AVG(value) OVER (ORDER BY position ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING), 3) AS centered_average FROM centered_values ORDER BY position;`,
    hints: [
      'Оба window expressions используют один frame.',
      'В середине frame_rows = 3, на краях = 2.',
      'AVG не требует ручного деления на 3: размер frame меняется.'
    ]
  },
  'task-185': {
    title: 'Вычисли delta через LAG и сохрани baseline',
    description: 'Для каждого сервиса сравни значение с предыдущим snapshot. Первая строка partition не имеет predecessor и должна получить state `baseline`, а не фиктивную delta 0. Остальные строки классифицируй как increase, decrease или unchanged.',
    starter: `CREATE TEMP TABLE snapshots(
  snapshot_id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  value INTEGER NOT NULL
);
INSERT INTO snapshots VALUES
  (1, 'VPN', '2026-08-01', 100), (2, 'VPN', '2026-08-02', 130),
  (3, 'VPN', '2026-08-03', 125),
  (4, 'LMS', '2026-08-01', 50), (5, 'LMS', '2026-08-02', 70);

WITH compared AS (
  SELECT snapshot_id, service, snapshot_at, value,
         LAG(value) OVER (
           PARTITION BY
           ORDER BY
         ) AS previous_value
  FROM snapshots
)
SELECT snapshot_id, service, snapshot_at, value, previous_value,
       value - previous_value AS delta,
       CASE
         WHEN  THEN 'baseline'
         WHEN value > previous_value THEN 'increase'
         WHEN value < previous_value THEN 'decrease'
         ELSE 'unchanged'
       END AS change_state
FROM compared
ORDER BY service, snapshot_at;`,
    solution: `CREATE TEMP TABLE snapshots(snapshot_id INTEGER PRIMARY KEY, service TEXT NOT NULL, snapshot_at TEXT NOT NULL, value INTEGER NOT NULL); INSERT INTO snapshots VALUES (1, 'VPN', '2026-08-01', 100), (2, 'VPN', '2026-08-02', 130), (3, 'VPN', '2026-08-03', 125), (4, 'LMS', '2026-08-01', 50), (5, 'LMS', '2026-08-02', 70); WITH compared AS (SELECT snapshot_id, service, snapshot_at, value, LAG(value) OVER (PARTITION BY service ORDER BY snapshot_at, snapshot_id) AS previous_value FROM snapshots) SELECT snapshot_id, service, snapshot_at, value, previous_value, value - previous_value AS delta, CASE WHEN previous_value IS NULL THEN 'baseline' WHEN value > previous_value THEN 'increase' WHEN value < previous_value THEN 'decrease' ELSE 'unchanged' END AS change_state FROM compared ORDER BY service, snapshot_at;`,
    hints: [
      'LAG partitioned by service returns NULL on the first snapshot.',
      'Не COALESCE previous_value: NULL означает отсутствие predecessor.',
      'Delta остаётся NULL для baseline, а state объясняет причину.'
    ]
  },
  'task-186': {
    title: 'Найди gaps and islands последовательных дат',
    description: 'Сгруппируй последовательные activity_date каждого пользователя в islands. Вычти ROW_NUMBER дней из даты: внутри непрерывной серии получится один стабильный ключ. Верни начало, конец и длину каждой island.',
    starter: `-- Напиши решение с нуля:
-- создай активности с разрывами для двух пользователей,
-- вычисли ROW_NUMBER по датам,
-- построй стабильный island key и агрегируй серии.`,
    solution: `CREATE TEMP TABLE activity_days(activity_id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, activity_date TEXT NOT NULL); INSERT INTO activity_days VALUES (1, 'A', '2026-08-01'), (2, 'A', '2026-08-02'), (3, 'A', '2026-08-04'), (4, 'A', '2026-08-05'), (5, 'A', '2026-08-06'), (6, 'B', '2026-08-02'), (7, 'B', '2026-08-04'); WITH ordered AS (SELECT user_id, activity_date, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY activity_date, activity_id) AS rn FROM activity_days), grouped AS (SELECT user_id, activity_date, date(activity_date, printf('-%d days', rn)) AS island_key FROM ordered) SELECT user_id, MIN(activity_date) AS island_start, MAX(activity_date) AS island_end, COUNT(*) AS island_days FROM grouped GROUP BY user_id, island_key ORDER BY user_id, island_start;`,
    hints: [
      'ROW_NUMBER начинается с 1 внутри каждого user_id.',
      'Для последовательных дат date - rn days остаётся одинаковой.',
      'GROUP BY user_id, island_key отделяет серии разных пользователей.'
    ]
  },
  'task-187': {
    title: 'Раздели события на sessions по временному gap',
    description: 'Новая session начинается на первом событии пользователя или после паузы больше 30 минут. Сначала вычисли LAG, затем new_session flag, затем cumulative SUM flags. Верни start/end/count каждой session.',
    starter: `-- Напиши решение с нуля:
-- создай события пользователей с паузами,
-- вычисли previous timestamp и new_session flag,
-- накопи session_number и агрегируй sessions.`,
    solution: `CREATE TEMP TABLE session_events(event_id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, event_at TEXT NOT NULL); INSERT INTO session_events VALUES (1, 'A', '2026-08-01T10:00:00Z'), (2, 'A', '2026-08-01T10:10:00Z'), (3, 'A', '2026-08-01T11:00:00Z'), (4, 'A', '2026-08-01T11:20:00Z'), (5, 'B', '2026-08-01T09:00:00Z'), (6, 'B', '2026-08-01T09:45:00Z'); WITH previous AS (SELECT event_id, user_id, event_at, LAG(event_at) OVER (PARTITION BY user_id ORDER BY event_at, event_id) AS previous_at FROM session_events), flagged AS (SELECT event_id, user_id, event_at, CASE WHEN previous_at IS NULL OR (julianday(event_at) - julianday(previous_at)) * 24 * 60 > 30 THEN 1 ELSE 0 END AS new_session FROM previous), numbered AS (SELECT event_id, user_id, event_at, SUM(new_session) OVER (PARTITION BY user_id ORDER BY event_at, event_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS session_number FROM flagged) SELECT user_id, session_number, MIN(event_at) AS session_start, MAX(event_at) AS session_end, COUNT(*) AS event_count FROM numbered GROUP BY user_id, session_number ORDER BY user_id, session_number;`,
    hints: [
      'Window-функции нельзя безопасно вкладывать, поэтому используй последовательные CTE.',
      'Gap строго больше 30 минут начинает новую session.',
      'Cumulative SUM new_session превращает flags в стабильный session_number.'
    ]
  },
  'task-188': {
    title: 'Посчитай cumulative distinct без DISTINCT window',
    description: 'SQLite не поддерживает COUNT(DISTINCT ...) как window. Сначала отметь первое событие каждого customer через ROW_NUMBER, затем накопи first_occurrence flag в глобальном порядке. Повторы клиента не должны увеличивать cumulative_unique.',
    starter: `CREATE TEMP TABLE customer_stream(
  event_id INTEGER PRIMARY KEY,
  event_at TEXT NOT NULL,
  customer_id INTEGER NOT NULL
);
INSERT INTO customer_stream VALUES
  (1, '2026-08-01T10:00:00Z', 1),
  (2, '2026-08-01T10:01:00Z', 2),
  (3, '2026-08-01T10:02:00Z', 1),
  (4, '2026-08-01T10:03:00Z', 3),
  (5, '2026-08-01T10:04:00Z', 2);

WITH marked AS (
  SELECT event_id, event_at, customer_id,
         CASE WHEN ROW_NUMBER() OVER (
           PARTITION BY
           ORDER BY
         ) = 1 THEN 1 ELSE 0 END AS first_occurrence
  FROM customer_stream
)
SELECT event_id, customer_id, first_occurrence,
       SUM(first_occurrence) OVER (
         ORDER BY event_at, event_id
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS cumulative_unique
FROM marked
ORDER BY event_at, event_id;`,
    solution: `CREATE TEMP TABLE customer_stream(event_id INTEGER PRIMARY KEY, event_at TEXT NOT NULL, customer_id INTEGER NOT NULL); INSERT INTO customer_stream VALUES (1, '2026-08-01T10:00:00Z', 1), (2, '2026-08-01T10:01:00Z', 2), (3, '2026-08-01T10:02:00Z', 1), (4, '2026-08-01T10:03:00Z', 3), (5, '2026-08-01T10:04:00Z', 2); WITH marked AS (SELECT event_id, event_at, customer_id, CASE WHEN ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY event_at, event_id) = 1 THEN 1 ELSE 0 END AS first_occurrence FROM customer_stream) SELECT event_id, customer_id, first_occurrence, SUM(first_occurrence) OVER (ORDER BY event_at, event_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_unique FROM marked ORDER BY event_at, event_id;`,
    hints: [
      'ROW_NUMBER per customer отмечает только первую строку.',
      'Глобальный cumulative SUM идёт по event_at, event_id.',
      'Повторные события имеют first_occurrence = 0.'
    ]
  },
  'task-189': {
    title: 'Различи ROW_NUMBER, RANK и DENSE_RANK на ties',
    description: 'Для одинаковых score покажи три разные ranking semantics. ROW_NUMBER должен быть детерминирован player_id, RANK оставляет разрыв после tie, DENSE_RANK — нет. Нельзя добавлять player_id в окна RANK/DENSE_RANK, иначе tie исчезнет.',
    starter: `CREATE TEMP TABLE player_scores(
  player_id INTEGER PRIMARY KEY,
  player TEXT NOT NULL,
  score INTEGER NOT NULL
);
INSERT INTO player_scores VALUES
  (1, 'Ann', 100), (2, 'Bob', 90),
  (3, 'Cara', 90), (4, 'Dan', 80);

SELECT player_id, player, score,
       ROW_NUMBER() OVER (ORDER BY ) AS row_number_position,
       RANK() OVER (ORDER BY ) AS rank_position,
       DENSE_RANK() OVER (ORDER BY ) AS dense_rank_position
FROM player_scores
ORDER BY score DESC, player_id;`,
    solution: `CREATE TEMP TABLE player_scores(player_id INTEGER PRIMARY KEY, player TEXT NOT NULL, score INTEGER NOT NULL); INSERT INTO player_scores VALUES (1, 'Ann', 100), (2, 'Bob', 90), (3, 'Cara', 90), (4, 'Dan', 80); SELECT player_id, player, score, ROW_NUMBER() OVER (ORDER BY score DESC, player_id) AS row_number_position, RANK() OVER (ORDER BY score DESC) AS rank_position, DENSE_RANK() OVER (ORDER BY score DESC) AS dense_rank_position FROM player_scores ORDER BY score DESC, player_id;`,
    hints: [
      'ROW_NUMBER требует tie-breaker player_id.',
      'RANK и DENSE_RANK сортируют только по score, чтобы Bob и Cara оставались peers.',
      'После tie score 80 получает RANK 4, но DENSE_RANK 3.'
    ]
  },
  'task-190': {
    title: 'Исправь LAST_VALUE явным full-partition frame',
    description: 'Сравни LAST_VALUE с frame до текущей строки и с frame до UNBOUNDED FOLLOWING. Первая колонка возвращает current value, вторая — настоящий последний value partition. Порядок должен быть детерминирован event_id.',
    starter: `CREATE TEMP TABLE account_values(
  event_id INTEGER PRIMARY KEY,
  account TEXT NOT NULL,
  event_at TEXT NOT NULL,
  value INTEGER NOT NULL
);
INSERT INTO account_values VALUES
  (1, 'A', '2026-08-01', 10), (2, 'A', '2026-08-02', 20),
  (3, 'A', '2026-08-03', 30),
  (4, 'B', '2026-08-01', 5), (5, 'B', '2026-08-02', 15);

SELECT event_id, account, event_at, value,
       LAST_VALUE(value) OVER (
         PARTITION BY account ORDER BY event_at, event_id
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS last_so_far,
       LAST_VALUE(value) OVER (
         PARTITION BY account ORDER BY event_at, event_id
         ROWS BETWEEN
       ) AS partition_last
FROM account_values
ORDER BY account, event_at, event_id;`,
    solution: `CREATE TEMP TABLE account_values(event_id INTEGER PRIMARY KEY, account TEXT NOT NULL, event_at TEXT NOT NULL, value INTEGER NOT NULL); INSERT INTO account_values VALUES (1, 'A', '2026-08-01', 10), (2, 'A', '2026-08-02', 20), (3, 'A', '2026-08-03', 30), (4, 'B', '2026-08-01', 5), (5, 'B', '2026-08-02', 15); SELECT event_id, account, event_at, value, LAST_VALUE(value) OVER (PARTITION BY account ORDER BY event_at, event_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS last_so_far, LAST_VALUE(value) OVER (PARTITION BY account ORDER BY event_at, event_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS partition_last FROM account_values ORDER BY account, event_at, event_id;`,
    hints: [
      'LAST_VALUE видит только строки текущего frame.',
      'CURRENT ROW делает last_so_far равным value текущей строки.',
      'UNBOUNDED FOLLOWING расширяет frame до конца partition.'
    ]
  }
};

export const windowFramesAuthoredTaskEvidence: Readonly<Record<string, readonly WindowFrameEvidenceTag[]>> = {
  'task-181': ['running-total', 'deterministic-order', 'rows-frame'],
  'task-182': ['rows-frame', 'range-frame', 'peer-groups'],
  'task-183': ['rolling-average', 'partition-reset', 'rows-frame'],
  'task-184': ['centered-window', 'edge-frame', 'rows-frame'],
  'task-185': ['lag-delta', 'baseline-row', 'deterministic-order'],
  'task-186': ['gaps-and-islands', 'stable-group-key'],
  'task-187': ['sessionization', 'time-gap-boundary', 'running-total'],
  'task-188': ['cumulative-distinct', 'first-occurrence-flag', 'running-total'],
  'task-189': ['ranking-ties', 'rank-semantics', 'deterministic-order'],
  'task-190': ['last-value-frame', 'unbounded-following', 'deterministic-order']
};

export function advancedWindowFramesTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedWindowFramesTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedWindowFramesTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}

export const windowFramesAuthoredTaskIds = Object.freeze(Object.keys(taskOverrides));
