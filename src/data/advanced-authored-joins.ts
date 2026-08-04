import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type AdvancedJoinEvidenceTag =
  | 'semi-join'
  | 'one-row-per-left'
  | 'correlated-existence'
  | 'anti-join'
  | 'unresolved-null-policy'
  | 'pre-aggregation'
  | 'many-to-many-control'
  | 'left-grain-preservation'
  | 'relational-division'
  | 'all-required'
  | 'exact-set-division'
  | 'no-extra-members'
  | 'self-join'
  | 'symmetric-pair-deduplication'
  | 'orphan-reconciliation'
  | 'full-outer-simulation'
  | 'latest-related-row'
  | 'deterministic-related-order'
  | 'as-of-join'
  | 'effective-dating'
  | 'fanout-audit'
  | 'cardinality-proof';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-161': {
    title: 'Верни клиентов с Open-обращениями без размножения строк',
    description: 'Найди клиентов, у которых существует хотя бы одно Open-обращение. Результат должен сохранять grain «одна строка на клиента», даже если у клиента два открытых обращения; дополнительно верни open_ticket_count как независимое доказательство связи.',
    starter: `CREATE TEMP TABLE join_customers(
  customer_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TEMP TABLE join_tickets(
  ticket_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL
);
INSERT INTO join_customers VALUES
  (1, 'Ann'), (2, 'Bob'), (3, 'Cara'), (4, 'Dan');
INSERT INTO join_tickets VALUES
  (1, 1, 'Open'), (2, 1, 'Open'), (3, 1, 'Closed'),
  (4, 2, 'Closed'), (5, 3, 'Open'), (6, 99, 'Open');

SELECT c.customer_id, c.name,
       (SELECT COUNT(*) FROM join_tickets t
        WHERE ) AS open_ticket_count
FROM join_customers c
WHERE EXISTS (
  SELECT 1 FROM join_tickets t WHERE
)
ORDER BY c.customer_id;`,
    solution: `CREATE TEMP TABLE join_customers(customer_id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TEMP TABLE join_tickets(ticket_id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, status TEXT NOT NULL); INSERT INTO join_customers VALUES (1, 'Ann'), (2, 'Bob'), (3, 'Cara'), (4, 'Dan'); INSERT INTO join_tickets VALUES (1, 1, 'Open'), (2, 1, 'Open'), (3, 1, 'Closed'), (4, 2, 'Closed'), (5, 3, 'Open'), (6, 99, 'Open'); SELECT c.customer_id, c.name, (SELECT COUNT(*) FROM join_tickets t WHERE t.customer_id = c.customer_id AND t.status = 'Open') AS open_ticket_count FROM join_customers c WHERE EXISTS (SELECT 1 FROM join_tickets t WHERE t.customer_id = c.customer_id AND t.status = 'Open') ORDER BY c.customer_id;`,
    hints: [
      'EXISTS отвечает только на вопрос наличия связи и не размножает строку клиента.',
      'Коррелируй t.customer_id = c.customer_id и status = Open.',
      'Отдельный COUNT использует то же условие и подтверждает 2 обращения у Ann и 1 у Cara.'
    ]
  },
  'task-162': {
    title: 'Найди клиентов без незавершённых обращений через anti-join',
    description: 'Верни клиентов, у которых нет ни Open, ни Pending, ни обращения с неизвестным status. Закрытые обращения разрешены, отсутствие обращений тоже разрешено. Используй NOT EXISTS и явную NULL-политику вместо LEFT JOIN с неоднозначным фильтром.',
    starter: `CREATE TEMP TABLE anti_customers(
  customer_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TEMP TABLE anti_cases(
  case_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  status TEXT
);
INSERT INTO anti_customers VALUES
  (1, 'Ann'), (2, 'Bob'), (3, 'Cara'), (4, 'Dan'), (5, 'Eve');
INSERT INTO anti_cases VALUES
  (1, 1, 'Closed'), (2, 2, 'Open'),
  (3, 3, NULL), (4, 5, 'Closed'), (5, 5, 'Pending');

SELECT c.customer_id, c.name,
       (SELECT COUNT(*) FROM anti_cases x WHERE x.customer_id = c.customer_id) AS case_count
FROM anti_customers c
WHERE NOT EXISTS (
  SELECT 1
  FROM anti_cases x
  WHERE
)
ORDER BY c.customer_id;`,
    solution: `CREATE TEMP TABLE anti_customers(customer_id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TEMP TABLE anti_cases(case_id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, status TEXT); INSERT INTO anti_customers VALUES (1, 'Ann'), (2, 'Bob'), (3, 'Cara'), (4, 'Dan'), (5, 'Eve'); INSERT INTO anti_cases VALUES (1, 1, 'Closed'), (2, 2, 'Open'), (3, 3, NULL), (4, 5, 'Closed'), (5, 5, 'Pending'); SELECT c.customer_id, c.name, (SELECT COUNT(*) FROM anti_cases x WHERE x.customer_id = c.customer_id) AS case_count FROM anti_customers c WHERE NOT EXISTS (SELECT 1 FROM anti_cases x WHERE x.customer_id = c.customer_id AND (x.status <> 'Closed' OR x.status IS NULL)) ORDER BY c.customer_id;`,
    hints: [
      'Anti-join выражается как NOT EXISTS коррелированного набора запрещающих строк.',
      "Незавершённое состояние: status <> 'Closed' OR status IS NULL.",
      'Клиент без обращений проходит условие, потому что запрещающей строки не существует.'
    ]
  },
  'task-163': {
    title: 'Сохрани ticket grain перед соединением двух one-to-many таблиц',
    description: 'Для каждого обращения верни сумму минут и число тегов. Work logs и tags — две независимые one-to-many связи: прямой JOIN перемножит их. Сначала агрегируй каждую сторону до ticket_id, затем присоедини готовые проекции к обращениям.',
    starter: `CREATE TEMP TABLE grain_tickets(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL);
CREATE TEMP TABLE work_logs(log_id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, minutes INTEGER NOT NULL);
CREATE TEMP TABLE ticket_tags(ticket_id INTEGER NOT NULL, tag TEXT NOT NULL);
INSERT INTO grain_tickets VALUES (1, 'VPN'), (2, 'LMS'), (3, 'VDI');
INSERT INTO work_logs VALUES (1, 1, 10), (2, 1, 20), (3, 2, 5);
INSERT INTO ticket_tags VALUES (1, 'urgent'), (1, 'network'), (2, 'content'), (3, 'backlog');

WITH minutes_per_ticket AS (
  SELECT ticket_id,  AS total_minutes
  FROM work_logs
  GROUP BY ticket_id
), tags_per_ticket AS (
  SELECT ticket_id,  AS tag_count
  FROM ticket_tags
  GROUP BY ticket_id
)
SELECT t.ticket_id, t.service,
       COALESCE(m.total_minutes, 0) AS total_minutes,
       COALESCE(g.tag_count, 0) AS tag_count
FROM grain_tickets t
LEFT JOIN minutes_per_ticket m ON
LEFT JOIN tags_per_ticket g ON
ORDER BY t.ticket_id;`,
    solution: `CREATE TEMP TABLE grain_tickets(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL); CREATE TEMP TABLE work_logs(log_id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, minutes INTEGER NOT NULL); CREATE TEMP TABLE ticket_tags(ticket_id INTEGER NOT NULL, tag TEXT NOT NULL); INSERT INTO grain_tickets VALUES (1, 'VPN'), (2, 'LMS'), (3, 'VDI'); INSERT INTO work_logs VALUES (1, 1, 10), (2, 1, 20), (3, 2, 5); INSERT INTO ticket_tags VALUES (1, 'urgent'), (1, 'network'), (2, 'content'), (3, 'backlog'); WITH minutes_per_ticket AS (SELECT ticket_id, SUM(minutes) AS total_minutes FROM work_logs GROUP BY ticket_id), tags_per_ticket AS (SELECT ticket_id, COUNT(*) AS tag_count FROM ticket_tags GROUP BY ticket_id) SELECT t.ticket_id, t.service, COALESCE(m.total_minutes, 0) AS total_minutes, COALESCE(g.tag_count, 0) AS tag_count FROM grain_tickets t LEFT JOIN minutes_per_ticket m ON m.ticket_id = t.ticket_id LEFT JOIN tags_per_ticket g ON g.ticket_id = t.ticket_id ORDER BY t.ticket_id;`,
    hints: [
      'Каждый CTE обязан вернуть не больше одной строки на ticket_id.',
      'Суммируй minutes отдельно от подсчёта tags.',
      'После pre-aggregation два LEFT JOIN сохраняют ровно одну строку на обращение.'
    ]
  },
  'task-164': {
    title: 'Найди инженеров со всеми обязательными навыками',
    description: 'Верни инженеров, у которых есть каждый навык из required_skills. Дополнительные навыки разрешены. Реализуй relational division через двойной NOT EXISTS: не должно существовать обязательного навыка, для которого не существует связи инженера.',
    starter: `-- Напиши решение с нуля:
-- создай engineers, required_skills и engineer_skills,
-- вырази «нет обязательного навыка, которого нет у инженера»,
-- верни matched_required_count.`,
    solution: `CREATE TEMP TABLE division_engineers(engineer_id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TEMP TABLE required_skills(skill TEXT PRIMARY KEY); CREATE TEMP TABLE engineer_skills(engineer_id INTEGER NOT NULL, skill TEXT NOT NULL, PRIMARY KEY(engineer_id, skill)); INSERT INTO division_engineers VALUES (1, 'Ana'), (2, 'Ben'), (3, 'Cara'), (4, 'Dan'); INSERT INTO required_skills VALUES ('SQL'), ('Linux'), ('Network'); INSERT INTO engineer_skills VALUES (1, 'SQL'), (1, 'Linux'), (1, 'Network'), (2, 'SQL'), (2, 'Linux'), (3, 'SQL'), (3, 'Linux'), (3, 'Network'), (3, 'Python'); SELECT e.engineer_id, e.name, (SELECT COUNT(*) FROM engineer_skills es JOIN required_skills r ON r.skill = es.skill WHERE es.engineer_id = e.engineer_id) AS matched_required_count FROM division_engineers e WHERE NOT EXISTS (SELECT 1 FROM required_skills r WHERE NOT EXISTS (SELECT 1 FROM engineer_skills es WHERE es.engineer_id = e.engineer_id AND es.skill = r.skill)) ORDER BY e.engineer_id;`,
    hints: [
      'Внешний NOT EXISTS ищет отсутствующий обязательный навык.',
      'Внутренний NOT EXISTS проверяет связь конкретного инженера и required skill.',
      'Python у Cara не мешает: задача требует покрыть минимум, а не точное равенство множеств.'
    ]
  },
  'task-165': {
    title: 'Проверь точное равенство набора каналов',
    description: 'Найди команды, у которых присутствуют все required_channels и нет ни одного дополнительного канала. Это exact relational division: первая проверка запрещает пропуски, вторая запрещает extras. Верни фактическое число каналов команды.',
    starter: `-- Напиши решение с нуля:
-- создай teams, required_channels и team_channels,
-- проверь all-required и no-extra отдельными NOT EXISTS,
-- верни channel_count.`,
    solution: `CREATE TEMP TABLE exact_teams(team_id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TEMP TABLE required_channels(channel TEXT PRIMARY KEY); CREATE TEMP TABLE team_channels(team_id INTEGER NOT NULL, channel TEXT NOT NULL, PRIMARY KEY(team_id, channel)); INSERT INTO exact_teams VALUES (1, 'Alpha'), (2, 'Beta'), (3, 'Gamma'), (4, 'Delta'); INSERT INTO required_channels VALUES ('email'), ('chat'); INSERT INTO team_channels VALUES (1, 'email'), (1, 'chat'), (2, 'email'), (3, 'email'), (3, 'chat'), (3, 'phone'), (4, 'email'), (4, 'chat'), (4, 'sms'); SELECT t.team_id, t.name, (SELECT COUNT(*) FROM team_channels tc WHERE tc.team_id = t.team_id) AS channel_count FROM exact_teams t WHERE NOT EXISTS (SELECT 1 FROM required_channels r WHERE NOT EXISTS (SELECT 1 FROM team_channels tc WHERE tc.team_id = t.team_id AND tc.channel = r.channel)) AND NOT EXISTS (SELECT 1 FROM team_channels tc WHERE tc.team_id = t.team_id AND NOT EXISTS (SELECT 1 FROM required_channels r WHERE r.channel = tc.channel)) ORDER BY t.team_id;`,
    hints: [
      'Первая двойная проверка доказывает наличие каждого required channel.',
      'Вторая проверка ищет канал команды, которого нет в required set.',
      'Только Alpha имеет ровно email и chat без дополнительных значений.'
    ]
  },
  'task-166': {
    title: 'Сформируй уникальные пары self-join',
    description: 'Верни все уникальные пары инженеров одной команды. Условие равенства team создаёт симметричные A–B и B–A пары и self-pairs; строгий `left_id < right_id` должен одновременно удалить оба вида дублей без DISTINCT.',
    starter: `CREATE TEMP TABLE pair_engineers(
  engineer_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  team TEXT NOT NULL
);
INSERT INTO pair_engineers VALUES
  (1, 'Ann', 'A'), (2, 'Bob', 'A'), (3, 'Cara', 'A'),
  (4, 'Dan', 'B'), (5, 'Eve', 'B'), (6, 'Finn', 'C');

SELECT a.team,
       a.engineer_id AS left_id,
       b.engineer_id AS right_id
FROM pair_engineers a
JOIN pair_engineers b ON
ORDER BY a.team, left_id, right_id;`,
    solution: `CREATE TEMP TABLE pair_engineers(engineer_id INTEGER PRIMARY KEY, name TEXT NOT NULL, team TEXT NOT NULL); INSERT INTO pair_engineers VALUES (1, 'Ann', 'A'), (2, 'Bob', 'A'), (3, 'Cara', 'A'), (4, 'Dan', 'B'), (5, 'Eve', 'B'), (6, 'Finn', 'C'); SELECT a.team, a.engineer_id AS left_id, b.engineer_id AS right_id FROM pair_engineers a JOIN pair_engineers b ON b.team = a.team AND a.engineer_id < b.engineer_id ORDER BY a.team, left_id, right_id;`,
    hints: [
      'Свяжи строки по одинаковой team.',
      'a.engineer_id < b.engineer_id исключает self-pairs и обратные копии.',
      'DISTINCT не нужен: уникальность вытекает из предиката пары.'
    ]
  },
  'task-167': {
    title: 'Сверь orphan-строки с обеих сторон связи',
    description: 'Найди аккаунты без профиля и профили без существующего аккаунта. SQLite не имеет FULL OUTER JOIN, поэтому собери две направленные anti-join проверки через UNION ALL и верни общий gap_count для контроля полноты reconciliation.',
    starter: `CREATE TEMP TABLE recon_accounts(account_id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TEMP TABLE recon_profiles(profile_id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, locale TEXT NOT NULL);
INSERT INTO recon_accounts VALUES (1, 'Ann'), (2, 'Bob'), (3, 'Cara');
INSERT INTO recon_profiles VALUES (10, 1, 'ru'), (11, 3, 'en'), (12, 4, 'lv');

WITH gaps AS (
  SELECT 'account-without-profile' AS gap_type, a.account_id AS entity_id
  FROM recon_accounts a
  LEFT JOIN recon_profiles p ON
  WHERE
  UNION ALL
  SELECT 'profile-without-account', p.account_id
  FROM recon_profiles p
  LEFT JOIN recon_accounts a ON
  WHERE
)
SELECT gap_type, entity_id, COUNT(*) OVER () AS gap_count
FROM gaps
ORDER BY gap_type, entity_id;`,
    solution: `CREATE TEMP TABLE recon_accounts(account_id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TEMP TABLE recon_profiles(profile_id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, locale TEXT NOT NULL); INSERT INTO recon_accounts VALUES (1, 'Ann'), (2, 'Bob'), (3, 'Cara'); INSERT INTO recon_profiles VALUES (10, 1, 'ru'), (11, 3, 'en'), (12, 4, 'lv'); WITH gaps AS (SELECT 'account-without-profile' AS gap_type, a.account_id AS entity_id FROM recon_accounts a LEFT JOIN recon_profiles p ON p.account_id = a.account_id WHERE p.profile_id IS NULL UNION ALL SELECT 'profile-without-account', p.account_id FROM recon_profiles p LEFT JOIN recon_accounts a ON a.account_id = p.account_id WHERE a.account_id IS NULL) SELECT gap_type, entity_id, COUNT(*) OVER () AS gap_count FROM gaps ORDER BY gap_type, entity_id;`,
    hints: [
      'Первая половина ищет отсутствие правой строки по p.profile_id IS NULL.',
      'Вторая половина меняет направление и ищет a.account_id IS NULL.',
      'UNION ALL сохраняет разные типы разрыва и не скрывает дубли автоматически.'
    ]
  },
  'task-168': {
    title: 'Присоедини одну последнюю связанную строку детерминированно',
    description: 'Верни каждое обращение ровно один раз вместе с последним событием. Сначала ранжируй события внутри ticket_id по event_at DESC и event_id DESC, затем присоедини только rn = 1; обращение без событий должно сохраниться.',
    starter: `CREATE TEMP TABLE latest_tickets(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL);
CREATE TEMP TABLE latest_events(event_id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, event_at TEXT NOT NULL, state TEXT NOT NULL);
INSERT INTO latest_tickets VALUES (1, 'VPN'), (2, 'LMS'), (3, 'VDI');
INSERT INTO latest_events VALUES
  (1, 1, '2026-08-01T10:00:00Z', 'Open'),
  (2, 1, '2026-08-01T11:00:00Z', 'Assigned'),
  (3, 2, '2026-08-01T09:00:00Z', 'Open'),
  (4, 2, '2026-08-01T12:00:00Z', 'Closed'),
  (5, 2, '2026-08-01T12:00:00Z', 'Reopened');

WITH ranked AS (
  SELECT event_id, ticket_id, event_at, state,
         ROW_NUMBER() OVER (
           PARTITION BY
           ORDER BY
         ) AS rn
  FROM latest_events
)
SELECT t.ticket_id, t.service, r.event_id, r.state
FROM latest_tickets t
LEFT JOIN ranked r ON
ORDER BY t.ticket_id;`,
    solution: `CREATE TEMP TABLE latest_tickets(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL); CREATE TEMP TABLE latest_events(event_id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, event_at TEXT NOT NULL, state TEXT NOT NULL); INSERT INTO latest_tickets VALUES (1, 'VPN'), (2, 'LMS'), (3, 'VDI'); INSERT INTO latest_events VALUES (1, 1, '2026-08-01T10:00:00Z', 'Open'), (2, 1, '2026-08-01T11:00:00Z', 'Assigned'), (3, 2, '2026-08-01T09:00:00Z', 'Open'), (4, 2, '2026-08-01T12:00:00Z', 'Closed'), (5, 2, '2026-08-01T12:00:00Z', 'Reopened'); WITH ranked AS (SELECT event_id, ticket_id, event_at, state, ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY event_at DESC, event_id DESC) AS rn FROM latest_events) SELECT t.ticket_id, t.service, r.event_id, r.state FROM latest_tickets t LEFT JOIN ranked r ON r.ticket_id = t.ticket_id AND r.rn = 1 ORDER BY t.ticket_id;`,
    hints: [
      'PARTITION BY ticket_id создаёт независимый рейтинг событий каждого обращения.',
      'event_id DESC детерминирует tie при одинаковом event_at.',
      'Условие rn = 1 помещается в JOIN, чтобы сохранить обращение без событий.'
    ]
  },
  'task-169': {
    title: 'Выполни as-of join по истории владельцев',
    description: 'Для каждого инцидента верни владельца, действовавшего в момент occurred_at. История после инцидента не подходит; среди допустимых записей выбери самую позднюю effective_at. Инцидент без исторического владельца должен остаться с NULL.',
    starter: `-- Напиши решение с нуля:
-- создай incidents и owner_history,
-- соедини только effective_at <= occurred_at,
-- ранжируй кандидатов и оставь последнего на incident_id.`,
    solution: `CREATE TEMP TABLE asof_incidents(incident_id INTEGER PRIMARY KEY, service TEXT NOT NULL, occurred_at TEXT NOT NULL); CREATE TEMP TABLE owner_history(history_id INTEGER PRIMARY KEY, service TEXT NOT NULL, owner TEXT NOT NULL, effective_at TEXT NOT NULL); INSERT INTO asof_incidents VALUES (1, 'VPN', '2026-08-01T10:00:00Z'), (2, 'VPN', '2026-08-03T10:00:00Z'), (3, 'LMS', '2026-08-02T09:00:00Z'), (4, 'VDI', '2026-08-01T09:00:00Z'); INSERT INTO owner_history VALUES (1, 'VPN', 'Alice', '2026-07-01T00:00:00Z'), (2, 'VPN', 'Bob', '2026-08-02T00:00:00Z'), (3, 'LMS', 'Cara', '2026-08-01T00:00:00Z'), (4, 'LMS', 'Dan', '2026-08-02T12:00:00Z'), (5, 'VDI', 'Eve', '2026-08-05T00:00:00Z'); WITH candidates AS (SELECT i.incident_id, i.service, i.occurred_at, h.owner, h.effective_at, ROW_NUMBER() OVER (PARTITION BY i.incident_id ORDER BY h.effective_at DESC, h.history_id DESC) AS rn FROM asof_incidents i LEFT JOIN owner_history h ON h.service = i.service AND h.effective_at <= i.occurred_at) SELECT incident_id, service, owner, effective_at FROM candidates WHERE rn = 1 ORDER BY incident_id;`,
    hints: [
      'JOIN допускает только history.effective_at <= incident.occurred_at.',
      'ROW_NUMBER выбирает наиболее позднюю допустимую запись на incident_id.',
      'LEFT JOIN сохраняет VDI-инцидент, хотя вся его история начинается позже.'
    ]
  },
  'task-170': {
    title: 'Измерь fan-out до использования результата JOIN',
    description: 'Соедини аккаунты одновременно с контактами и подписками и измерь фактическую кардинальность. Верни число исходных аккаунтов, строк JOIN, уникальных аккаунтов, fanout_excess и максимальное число строк одного аккаунта, не маскируя проблему DISTINCT.',
    starter: `-- Напиши решение с нуля:
-- создай accounts, contacts и subscriptions,
-- выполни два LEFT JOIN,
-- измерь joined rows, distinct left rows и max rows per account.`,
    solution: `CREATE TEMP TABLE fanout_accounts(account_id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TEMP TABLE fanout_contacts(contact_id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, channel TEXT NOT NULL); CREATE TEMP TABLE fanout_subscriptions(subscription_id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, product TEXT NOT NULL); INSERT INTO fanout_accounts VALUES (1, 'Ann'), (2, 'Bob'), (3, 'Cara'); INSERT INTO fanout_contacts VALUES (1, 1, 'email'), (2, 1, 'sms'), (3, 2, 'email'); INSERT INTO fanout_subscriptions VALUES (1, 1, 'core'), (2, 1, 'analytics'), (3, 2, 'core'), (4, 3, 'core'); WITH joined AS (SELECT a.account_id, c.contact_id, s.subscription_id FROM fanout_accounts a LEFT JOIN fanout_contacts c ON c.account_id = a.account_id LEFT JOIN fanout_subscriptions s ON s.account_id = a.account_id), per_account AS (SELECT account_id, COUNT(*) AS rows_per_account FROM joined GROUP BY account_id) SELECT (SELECT COUNT(*) FROM fanout_accounts) AS left_rows, (SELECT COUNT(*) FROM joined) AS joined_rows, (SELECT COUNT(DISTINCT account_id) FROM joined) AS distinct_left_rows, (SELECT COUNT(*) - COUNT(DISTINCT account_id) FROM joined) AS fanout_excess, (SELECT MAX(rows_per_account) FROM per_account) AS max_rows_per_account;`,
    hints: [
      'Две one-to-many связи перемножаются для account 1: 2 contacts × 2 subscriptions.',
      'Сравни COUNT(*) JOIN с COUNT(DISTINCT account_id), но не используй DISTINCT для исправления данных.',
      'max_rows_per_account показывает худший локальный fan-out.'
    ]
  }
};

export const advancedJoinsAuthoredTaskEvidence: Readonly<Record<string, readonly AdvancedJoinEvidenceTag[]>> = {
  'task-161': ['semi-join', 'one-row-per-left', 'correlated-existence'],
  'task-162': ['anti-join', 'unresolved-null-policy', 'one-row-per-left'],
  'task-163': ['pre-aggregation', 'many-to-many-control', 'left-grain-preservation'],
  'task-164': ['relational-division', 'all-required'],
  'task-165': ['exact-set-division', 'all-required', 'no-extra-members'],
  'task-166': ['self-join', 'symmetric-pair-deduplication'],
  'task-167': ['orphan-reconciliation', 'full-outer-simulation'],
  'task-168': ['latest-related-row', 'deterministic-related-order', 'one-row-per-left'],
  'task-169': ['as-of-join', 'effective-dating', 'latest-related-row'],
  'task-170': ['fanout-audit', 'cardinality-proof', 'many-to-many-control']
};

export function advancedJoinsTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedJoinsTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedJoinsTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}

export const advancedJoinsAuthoredTaskIds = Object.freeze(Object.keys(taskOverrides));
