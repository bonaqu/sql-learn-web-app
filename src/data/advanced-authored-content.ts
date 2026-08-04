import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type AdvancedEvidenceTag =
  | 'target-set'
  | 'bounded-update'
  | 'insert-select'
  | 'anti-duplicate'
  | 'bounded-delete'
  | 'change-count'
  | 'idempotency'
  | 'request-key'
  | 'savepoint'
  | 'rollback'
  | 'upsert'
  | 'version-guard'
  | 'staging-sync'
  | 'reconciliation'
  | 'deduplication'
  | 'window-ranking'
  | 'audit-before-mutation'
  | 'returning'
  | 'cardinality-guard'
  | 'all-or-none';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-121': {
    title: 'Докажи target set перед UPDATE',
    description: 'Во временной очереди обращений сначала зафиксируй точный набор открытых VPN-обращений, которые можно повысить до High, не затрагивая уже Critical. Затем выполни UPDATE и верни все строки с признаком was_target для независимой проверки области изменения.',
    starter: `CREATE TEMP TABLE incident_queue(
  ticket_id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL
);
INSERT INTO incident_queue VALUES
  (101, 'VPN', 'Open', 'Medium'),
  (102, 'VPN', 'Closed', 'Low'),
  (103, 'LMS', 'Open', 'Low'),
  (104, 'VPN', 'Open', 'Critical');

CREATE TEMP TABLE update_target AS
SELECT ticket_id
FROM incident_queue
WHERE ;

UPDATE incident_queue
SET priority = 'High'
WHERE ;

SELECT q.ticket_id, q.service, q.status, q.priority,
       CASE WHEN t.ticket_id IS NULL THEN 0 ELSE 1 END AS was_target
FROM incident_queue q
LEFT JOIN update_target t ON t.ticket_id = q.ticket_id
ORDER BY q.ticket_id;`,
    solution: `CREATE TEMP TABLE incident_queue(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL); INSERT INTO incident_queue VALUES (101, 'VPN', 'Open', 'Medium'), (102, 'VPN', 'Closed', 'Low'), (103, 'LMS', 'Open', 'Low'), (104, 'VPN', 'Open', 'Critical'); CREATE TEMP TABLE update_target AS SELECT ticket_id FROM incident_queue WHERE service = 'VPN' AND status = 'Open' AND priority <> 'Critical'; UPDATE incident_queue SET priority = 'High' WHERE ticket_id IN (SELECT ticket_id FROM update_target); SELECT q.ticket_id, q.service, q.status, q.priority, CASE WHEN t.ticket_id IS NULL THEN 0 ELSE 1 END AS was_target FROM incident_queue q LEFT JOIN update_target t ON t.ticket_id = q.ticket_id ORDER BY q.ticket_id;`,
    hints: [
      "Target set: service = 'VPN', status = 'Open', priority <> 'Critical'.",
      'UPDATE должен ссылаться на сохранённый update_target, а не повторять другое условие.',
      'was_target доказывает, какие строки входили в область изменения.'
    ]
  },
  'task-122': {
    title: 'Архивируй закрытые обращения без дублей',
    description: 'Перенеси закрытые строки из closed_source в ticket_archive через INSERT ... SELECT. В архиве уже есть одно обращение: используй anti-duplicate проверку по ticket_id и верни итоговый архив в стабильном порядке.',
    starter: `CREATE TEMP TABLE closed_source(
  ticket_id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  closed_at TEXT
);
CREATE TEMP TABLE ticket_archive(
  ticket_id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  closed_at TEXT NOT NULL
);
INSERT INTO closed_source VALUES
  (201, 'VPN', 'Closed', '2026-07-01'),
  (202, 'LMS', 'Closed', '2026-07-02'),
  (203, 'VDI', 'Open', NULL),
  (204, 'Email', 'Closed', '2026-07-03');
INSERT INTO ticket_archive VALUES (202, 'LMS', '2026-07-02');

INSERT INTO ticket_archive(ticket_id, service, closed_at)
SELECT
FROM closed_source s
WHERE
  AND NOT EXISTS (
    SELECT 1 FROM ticket_archive a WHERE
  );

SELECT ticket_id, service, closed_at
FROM ticket_archive
ORDER BY ticket_id;`,
    solution: `CREATE TEMP TABLE closed_source(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL, status TEXT NOT NULL, closed_at TEXT); CREATE TEMP TABLE ticket_archive(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL, closed_at TEXT NOT NULL); INSERT INTO closed_source VALUES (201, 'VPN', 'Closed', '2026-07-01'), (202, 'LMS', 'Closed', '2026-07-02'), (203, 'VDI', 'Open', NULL), (204, 'Email', 'Closed', '2026-07-03'); INSERT INTO ticket_archive VALUES (202, 'LMS', '2026-07-02'); INSERT INTO ticket_archive(ticket_id, service, closed_at) SELECT s.ticket_id, s.service, s.closed_at FROM closed_source s WHERE s.status = 'Closed' AND s.closed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ticket_archive a WHERE a.ticket_id = s.ticket_id); SELECT ticket_id, service, closed_at FROM ticket_archive ORDER BY ticket_id;`,
    hints: [
      'INSERT ... SELECT должен возвращать ticket_id, service и closed_at в порядке столбцов архива.',
      "Источник ограничивается status = 'Closed' и непустым closed_at.",
      'NOT EXISTS проверяет тот же ticket_id в ticket_archive.'
    ]
  },
  'task-123': {
    title: 'Удали только истёкшие сессии и сверь объём',
    description: 'Сохрани deletion_target для истёкших сессий старше 1 июля 2026 года, удали только этот набор и верни planned_delete, actual_delete через changes() и число оставшихся сессий.',
    starter: `CREATE TEMP TABLE browser_sessions(
  session_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  state TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
INSERT INTO browser_sessions VALUES
  (301, 10, 'active', '2026-07-20'),
  (302, 10, 'expired', '2026-06-01'),
  (303, 11, 'expired', '2026-07-15'),
  (304, 12, 'expired', '2026-05-20');

CREATE TEMP TABLE deletion_target AS
SELECT session_id
FROM browser_sessions
WHERE ;

DELETE FROM browser_sessions
WHERE ;

SELECT
  (SELECT COUNT(*) FROM deletion_target) AS planned_delete,
  changes() AS actual_delete,
  (SELECT COUNT(*) FROM browser_sessions) AS remaining_sessions;`,
    solution: `CREATE TEMP TABLE browser_sessions(session_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, state TEXT NOT NULL, last_seen TEXT NOT NULL); INSERT INTO browser_sessions VALUES (301, 10, 'active', '2026-07-20'), (302, 10, 'expired', '2026-06-01'), (303, 11, 'expired', '2026-07-15'), (304, 12, 'expired', '2026-05-20'); CREATE TEMP TABLE deletion_target AS SELECT session_id FROM browser_sessions WHERE state = 'expired' AND last_seen < '2026-07-01'; DELETE FROM browser_sessions WHERE session_id IN (SELECT session_id FROM deletion_target); SELECT (SELECT COUNT(*) FROM deletion_target) AS planned_delete, changes() AS actual_delete, (SELECT COUNT(*) FROM browser_sessions) AS remaining_sessions;`,
    hints: [
      "Deletion target требует одновременно state = 'expired' и last_seen < '2026-07-01'.",
      'DELETE использует только идентификаторы из deletion_target.',
      'planned_delete и actual_delete должны совпасть и быть равны двум.'
    ]
  },
  'task-124': {
    title: 'Идемпотентная компенсация по request_id',
    description: 'Смоделируй повтор одного и того же запроса на SLA-компенсацию. Две одинаковые попытки INSERT с одним request_id должны создать ровно одну строку; верни запись и rows_for_request как доказательство at-most-once эффекта.',
    starter: `-- Напиши решение с нуля: создай таблицу с UNIQUE request_id,
-- дважды повтори одну компенсацию и докажи, что строка одна.`,
    solution: `CREATE TEMP TABLE credit_adjustments(request_id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL); INSERT INTO credit_adjustments(request_id, account_id, amount, reason) VALUES ('req-2026-001', 77, 300, 'SLA compensation') ON CONFLICT(request_id) DO NOTHING; INSERT INTO credit_adjustments(request_id, account_id, amount, reason) VALUES ('req-2026-001', 77, 300, 'SLA compensation') ON CONFLICT(request_id) DO NOTHING; SELECT request_id, account_id, amount, reason, COUNT(*) OVER (PARTITION BY request_id) AS rows_for_request FROM credit_adjustments ORDER BY request_id;`,
    hints: [
      'request_id — идемпотентный ключ операции, а не случайный идентификатор каждой попытки.',
      'ON CONFLICT(request_id) DO NOTHING превращает точный retry в no-op.',
      'rows_for_request должен остаться равен одному.'
    ]
  },
  'task-125': {
    title: 'Откати только рискованный шаг через SAVEPOINT',
    description: 'В одной транзакции увеличь VPN-квоту, затем выполни пробное изменение LMS после SAVEPOINT и отмени только его через ROLLBACK TO. Зафиксируй безопасную часть и верни обе квоты.',
    starter: `-- Создай service_quota, начни транзакцию,
-- сохрани безопасный UPDATE VPN,
-- откати только tentative LMS update через SAVEPOINT.`,
    solution: `CREATE TEMP TABLE service_quota(service TEXT PRIMARY KEY, used_units INTEGER NOT NULL, limit_units INTEGER NOT NULL); INSERT INTO service_quota VALUES ('VPN', 4, 10), ('LMS', 3, 10); BEGIN; UPDATE service_quota SET used_units = used_units + 2 WHERE service = 'VPN'; SAVEPOINT tentative_lms; UPDATE service_quota SET used_units = used_units + 5 WHERE service = 'LMS'; ROLLBACK TO tentative_lms; RELEASE tentative_lms; COMMIT; SELECT service, used_units, limit_units FROM service_quota ORDER BY service;`,
    hints: [
      'SAVEPOINT ставится после безопасного VPN-изменения.',
      'ROLLBACK TO tentative_lms отменяет LMS, но сохраняет более ранний UPDATE VPN.',
      'После RELEASE заверши внешнюю транзакцию через COMMIT.'
    ]
  },
  'task-126': {
    title: 'Прими только более новую версию конфигурации',
    description: 'Реализуй version-aware UPSERT: конфигурация VPN версии 3 должна заменить версию 2, а последующая устаревшая версия 1 не должна откатить timeout. Верни итоговую конфигурацию.',
    starter: `CREATE TEMP TABLE service_config(
  service TEXT PRIMARY KEY,
  timeout_minutes INTEGER NOT NULL,
  config_version INTEGER NOT NULL
);
INSERT INTO service_config VALUES ('VPN', 30, 2);

INSERT INTO service_config(service, timeout_minutes, config_version)
VALUES ('VPN', 45, 3)
ON CONFLICT(service) DO UPDATE SET
  timeout_minutes = ,
  config_version =
WHERE ;

-- Повтори UPSERT со stale version = 1 и timeout = 20

SELECT service, timeout_minutes, config_version
FROM service_config;`,
    solution: `CREATE TEMP TABLE service_config(service TEXT PRIMARY KEY, timeout_minutes INTEGER NOT NULL, config_version INTEGER NOT NULL); INSERT INTO service_config VALUES ('VPN', 30, 2); INSERT INTO service_config(service, timeout_minutes, config_version) VALUES ('VPN', 45, 3) ON CONFLICT(service) DO UPDATE SET timeout_minutes = excluded.timeout_minutes, config_version = excluded.config_version WHERE excluded.config_version > service_config.config_version; INSERT INTO service_config(service, timeout_minutes, config_version) VALUES ('VPN', 20, 1) ON CONFLICT(service) DO UPDATE SET timeout_minutes = excluded.timeout_minutes, config_version = excluded.config_version WHERE excluded.config_version > service_config.config_version; SELECT service, timeout_minutes, config_version FROM service_config;`,
    hints: [
      'excluded содержит входящую строку, service_config — уже сохранённую.',
      'UPDATE разрешён только при excluded.config_version > service_config.config_version.',
      'Итог обязан остаться timeout 45, version 3.'
    ]
  },
  'task-127': {
    title: 'Синхронизируй нагрузку из staging-расчёта',
    description: 'Обнови engineer_load значениями из recalculated_load только для инженеров, присутствующих в staging. Инженер без пересчитанной строки должен сохраниться без изменения; верни текущее и контрольное значение.',
    starter: `CREATE TEMP TABLE engineer_load(
  engineer_id INTEGER PRIMARY KEY,
  open_tickets INTEGER NOT NULL
);
CREATE TEMP TABLE recalculated_load(
  engineer_id INTEGER PRIMARY KEY,
  open_tickets INTEGER NOT NULL
);
INSERT INTO engineer_load VALUES (1, 8), (2, 4), (3, 1);
INSERT INTO recalculated_load VALUES (1, 6), (2, 4);

UPDATE engineer_load
SET open_tickets = (
  SELECT
)
WHERE EXISTS (
  SELECT 1
);

SELECT l.engineer_id, l.open_tickets,
       COALESCE(r.open_tickets, l.open_tickets) AS control_value
FROM engineer_load l
LEFT JOIN recalculated_load r ON r.engineer_id = l.engineer_id
ORDER BY l.engineer_id;`,
    solution: `CREATE TEMP TABLE engineer_load(engineer_id INTEGER PRIMARY KEY, open_tickets INTEGER NOT NULL); CREATE TEMP TABLE recalculated_load(engineer_id INTEGER PRIMARY KEY, open_tickets INTEGER NOT NULL); INSERT INTO engineer_load VALUES (1, 8), (2, 4), (3, 1); INSERT INTO recalculated_load VALUES (1, 6), (2, 4); UPDATE engineer_load SET open_tickets = (SELECT r.open_tickets FROM recalculated_load r WHERE r.engineer_id = engineer_load.engineer_id) WHERE EXISTS (SELECT 1 FROM recalculated_load r WHERE r.engineer_id = engineer_load.engineer_id); SELECT l.engineer_id, l.open_tickets, COALESCE(r.open_tickets, l.open_tickets) AS control_value FROM engineer_load l LEFT JOIN recalculated_load r ON r.engineer_id = l.engineer_id ORDER BY l.engineer_id;`,
    hints: [
      'Коррелируй staging и target по engineer_id.',
      'EXISTS не позволяет присвоить NULL инженеру без staging-строки.',
      'Для каждой строки open_tickets должен совпасть с control_value.'
    ]
  },
  'task-128': {
    title: 'Оставь канонический контакт среди дублей',
    description: 'Нормализуй email через lower(email), ранжируй дубли внутри customer_id и удали все строки кроме самой новой verified_at; при равенстве оставь больший contact_id. Верни канонические контакты.',
    starter: `CREATE TEMP TABLE customer_contacts(
  contact_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  verified_at TEXT NOT NULL
);
INSERT INTO customer_contacts VALUES
  (1, 10, 'USER@example.com', '2026-06-01'),
  (2, 10, 'user@example.com', '2026-07-01'),
  (3, 11, 'other@example.com', '2026-07-02'),
  (4, 10, 'user@example.com', '2026-07-01');

WITH ranked AS (
  SELECT contact_id,
         ROW_NUMBER() OVER (
           PARTITION BY
           ORDER BY
         ) AS rn
  FROM customer_contacts
)
DELETE FROM customer_contacts
WHERE ;

SELECT contact_id, customer_id, email, verified_at
FROM customer_contacts
ORDER BY customer_id, contact_id;`,
    solution: `CREATE TEMP TABLE customer_contacts(contact_id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, email TEXT NOT NULL, verified_at TEXT NOT NULL); INSERT INTO customer_contacts VALUES (1, 10, 'USER@example.com', '2026-06-01'), (2, 10, 'user@example.com', '2026-07-01'), (3, 11, 'other@example.com', '2026-07-02'), (4, 10, 'user@example.com', '2026-07-01'); WITH ranked AS (SELECT contact_id, ROW_NUMBER() OVER (PARTITION BY customer_id, lower(email) ORDER BY verified_at DESC, contact_id DESC) AS rn FROM customer_contacts) DELETE FROM customer_contacts WHERE contact_id IN (SELECT contact_id FROM ranked WHERE rn > 1); SELECT contact_id, customer_id, email, verified_at FROM customer_contacts ORDER BY customer_id, contact_id;`,
    hints: [
      'Группа дублей определяется customer_id и lower(email).',
      'ORDER BY verified_at DESC, contact_id DESC делает победителя детерминированным.',
      'DELETE удаляет только rn > 1.'
    ]
  },
  'task-129': {
    title: 'Сохрани аудит перед отзывом сессий',
    description: 'Перед отзывом старых активных сессий пользователя 50 сохрани их исходное состояние в session_audit. Затем измени только зааудированные строки и верни изменённые session_id, user_id и state через RETURNING.',
    starter: `-- Напиши с нуля audit-before-mutation:
-- сначала INSERT ... SELECT в session_audit,
-- затем UPDATE только этого набора с RETURNING.`,
    solution: `CREATE TEMP TABLE user_sessions(session_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, state TEXT NOT NULL, last_seen TEXT NOT NULL); CREATE TEMP TABLE session_audit(session_id INTEGER PRIMARY KEY, previous_state TEXT NOT NULL, reason TEXT NOT NULL); INSERT INTO user_sessions VALUES (901, 50, 'active', '2026-07-30'), (902, 50, 'active', '2026-06-15'), (903, 51, 'active', '2026-06-10'); INSERT INTO session_audit(session_id, previous_state, reason) SELECT session_id, state, 'credential rotation' FROM user_sessions WHERE user_id = 50 AND state = 'active' AND last_seen < '2026-07-01'; UPDATE user_sessions SET state = 'revoked' WHERE session_id IN (SELECT session_id FROM session_audit) RETURNING session_id, user_id, state;`,
    hints: [
      'Аудит фиксирует pre-state до UPDATE.',
      "Target: user_id = 50, state = 'active', last_seen < '2026-07-01'.",
      'UPDATE должен ссылаться на session_audit и завершаться RETURNING.'
    ]
  },
  'task-130': {
    title: 'Отзови роли только при ожидаемой кардинальности',
    description: 'Сохрани активные legacy-admin grants в revocation_target и выполни all-or-none UPDATE только если target содержит ровно две строки. Верни все grants, expected_target_count и actual_update_count.',
    starter: `-- Создай набор revocation_target,
-- добавь cardinality guard к UPDATE
-- и докажи expected/actual counts итоговым SELECT.`,
    solution: `CREATE TEMP TABLE access_grants(grant_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL); INSERT INTO access_grants VALUES (1, 10, 'legacy-admin', 'active'), (2, 11, 'legacy-admin', 'active'), (3, 12, 'viewer', 'active'); CREATE TEMP TABLE revocation_target AS SELECT grant_id FROM access_grants WHERE role = 'legacy-admin' AND state = 'active'; UPDATE access_grants SET state = 'revoked' WHERE grant_id IN (SELECT grant_id FROM revocation_target) AND (SELECT COUNT(*) FROM revocation_target) = 2; SELECT grant_id, user_id, role, state, (SELECT COUNT(*) FROM revocation_target) AS expected_target_count, changes() AS actual_update_count FROM access_grants ORDER BY grant_id;`,
    hints: [
      'Сохрани target до изменения, чтобы count и UPDATE использовали один набор.',
      'Cardinality guard — скалярный COUNT(*) = 2 внутри WHERE.',
      'expected_target_count и actual_update_count должны быть равны двум.'
    ]
  }
};

export const advancedAuthoredTaskEvidence: Readonly<Record<string, readonly AdvancedEvidenceTag[]>> = {
  'task-121': ['target-set', 'bounded-update', 'reconciliation'],
  'task-122': ['insert-select', 'anti-duplicate', 'reconciliation'],
  'task-123': ['bounded-delete', 'change-count', 'target-set'],
  'task-124': ['idempotency', 'request-key', 'anti-duplicate'],
  'task-125': ['savepoint', 'rollback', 'bounded-update'],
  'task-126': ['upsert', 'version-guard', 'idempotency'],
  'task-127': ['staging-sync', 'reconciliation', 'bounded-update'],
  'task-128': ['deduplication', 'window-ranking', 'bounded-delete'],
  'task-129': ['audit-before-mutation', 'returning', 'target-set'],
  'task-130': ['cardinality-guard', 'all-or-none', 'change-count']
};

export function advancedAuthoredTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedAuthoredTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedAuthoredTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}

export const advancedAuthoredTaskIds = Object.freeze(Object.keys(taskOverrides));
