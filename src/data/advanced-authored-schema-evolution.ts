import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type SchemaEvolutionEvidenceTag =
  | 'preflight-validation'
  | 'invalid-row-report'
  | 'expand-migration'
  | 'backfill'
  | 'null-proof'
  | 'copy-and-swap'
  | 'check-constraint'
  | 'row-count-reconciliation'
  | 'compatibility-view'
  | 'explicit-projection'
  | 'rename-compatibility'
  | 'view-stability'
  | 'schema-addition'
  | 'contract-migration'
  | 'normalization'
  | 'unique-constraint'
  | 'migration-ledger'
  | 'idempotent-migration'
  | 'batch-backfill'
  | 'coverage-proof'
  | 'transactional-ddl'
  | 'rollback-proof'
  | 'schema-metadata'
  | 'contract-verification';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-131': {
    title: 'Проведи preflight перед CHECK constraint',
    description: 'Перед усилением схемы найди все строки legacy_service_levels, которые нарушат будущий invariant `sla_minutes BETWEEN 1 AND 1440`: NULL, ноль, отрицательные и слишком большие значения. Верни только проблемные строки с явной причиной, чтобы миграция не упала вслепую.',
    starter: `CREATE TEMP TABLE legacy_service_levels(
  service TEXT PRIMARY KEY,
  sla_minutes INTEGER
);
INSERT INTO legacy_service_levels VALUES
  ('VPN', 60),
  ('LMS', NULL),
  ('VDI', 0),
  ('Email', 2880),
  ('Access', 120);

SELECT service, sla_minutes,
       CASE
         WHEN  THEN 'missing'
         WHEN  THEN 'out-of-range'
       END AS violation
FROM legacy_service_levels
WHERE
ORDER BY service;`,
    solution: `CREATE TEMP TABLE legacy_service_levels(service TEXT PRIMARY KEY, sla_minutes INTEGER); INSERT INTO legacy_service_levels VALUES ('VPN', 60), ('LMS', NULL), ('VDI', 0), ('Email', 2880), ('Access', 120); SELECT service, sla_minutes, CASE WHEN sla_minutes IS NULL THEN 'missing' WHEN sla_minutes NOT BETWEEN 1 AND 1440 THEN 'out-of-range' END AS violation FROM legacy_service_levels WHERE sla_minutes IS NULL OR sla_minutes NOT BETWEEN 1 AND 1440 ORDER BY service;`,
    hints: [
      'NULL проверяется отдельно через IS NULL: BETWEEN не превращает UNKNOWN в нарушение автоматически.',
      'Диапазон будущего CHECK — от 1 до 1440 включительно.',
      'WHERE должен повторять обе причины, чтобы итог содержал только нарушителей.'
    ]
  },
  'task-132': {
    title: 'Расширь схему и докажи полный backfill',
    description: 'Добавь nullable-колонку lifecycle_state в legacy_accounts, заполни её детерминированно по archived_at и докажи, что после backfill не осталось NULL. Это expand-фаза: старый контракт ещё не ломается, но данные уже готовы к будущему NOT NULL.',
    starter: `CREATE TEMP TABLE legacy_accounts(
  account_id INTEGER PRIMARY KEY,
  archived_at TEXT
);
INSERT INTO legacy_accounts VALUES
  (1, NULL),
  (2, '2026-06-01'),
  (3, NULL);

ALTER TABLE legacy_accounts ADD COLUMN lifecycle_state TEXT;

UPDATE legacy_accounts
SET lifecycle_state = CASE
  WHEN  THEN 'archived'
  ELSE 'active'
END;

SELECT account_id, archived_at, lifecycle_state,
       SUM(CASE WHEN lifecycle_state IS NULL THEN 1 ELSE 0 END) OVER () AS remaining_nulls
FROM legacy_accounts
ORDER BY account_id;`,
    solution: `CREATE TEMP TABLE legacy_accounts(account_id INTEGER PRIMARY KEY, archived_at TEXT); INSERT INTO legacy_accounts VALUES (1, NULL), (2, '2026-06-01'), (3, NULL); ALTER TABLE legacy_accounts ADD COLUMN lifecycle_state TEXT; UPDATE legacy_accounts SET lifecycle_state = CASE WHEN archived_at IS NOT NULL THEN 'archived' ELSE 'active' END; SELECT account_id, archived_at, lifecycle_state, SUM(CASE WHEN lifecycle_state IS NULL THEN 1 ELSE 0 END) OVER () AS remaining_nulls FROM legacy_accounts ORDER BY account_id;`,
    hints: [
      'Сначала колонка nullable: существующие записи иначе невозможно безопасно расширить одним шагом.',
      'archived_at IS NOT NULL означает archived, остальные строки — active.',
      'remaining_nulls обязан быть нулём у каждой строки результата.'
    ]
  },
  'task-133': {
    title: 'Перенеси данные в таблицу со строгим invariant',
    description: 'Выполни copy-and-validate миграцию service_levels: создай новую таблицу с `NOT NULL` и `CHECK`, перенеси только уже проверенные строки, затем верни количество источника, количество назначения и число нарушений в новой таблице. Миграция считается доказанной только при совпадении cardinality и нулевых нарушениях.',
    starter: `CREATE TEMP TABLE service_levels_old(
  service TEXT PRIMARY KEY,
  sla_minutes INTEGER
);
INSERT INTO service_levels_old VALUES
  ('VPN', 60), ('LMS', 120), ('VDI', 45);

CREATE TEMP TABLE service_levels_new(
  service TEXT PRIMARY KEY,
  sla_minutes INTEGER NOT NULL CHECK ( )
);

INSERT INTO service_levels_new(service, sla_minutes)
SELECT
FROM service_levels_old
WHERE ;

SELECT
  (SELECT COUNT(*) FROM service_levels_old) AS source_rows,
  (SELECT COUNT(*) FROM service_levels_new) AS migrated_rows,
  (SELECT COUNT(*) FROM service_levels_new WHERE ) AS invariant_violations;`,
    solution: `CREATE TEMP TABLE service_levels_old(service TEXT PRIMARY KEY, sla_minutes INTEGER); INSERT INTO service_levels_old VALUES ('VPN', 60), ('LMS', 120), ('VDI', 45); CREATE TEMP TABLE service_levels_new(service TEXT PRIMARY KEY, sla_minutes INTEGER NOT NULL CHECK (sla_minutes BETWEEN 1 AND 1440)); INSERT INTO service_levels_new(service, sla_minutes) SELECT service, sla_minutes FROM service_levels_old WHERE sla_minutes BETWEEN 1 AND 1440; SELECT (SELECT COUNT(*) FROM service_levels_old) AS source_rows, (SELECT COUNT(*) FROM service_levels_new) AS migrated_rows, (SELECT COUNT(*) FROM service_levels_new WHERE sla_minutes NOT BETWEEN 1 AND 1440) AS invariant_violations;`,
    hints: [
      'CHECK и preflight-фильтр используют один диапазон: 1..1440.',
      'INSERT ... SELECT перечисляет service и sla_minutes явно.',
      'source_rows и migrated_rows должны совпасть, invariant_violations — ноль.'
    ]
  },
  'task-134': {
    title: 'Сохрани старый read contract через compatibility view',
    description: 'После перехода с колонки service на service_code создай compatibility view `tickets_legacy`, которое возвращает прежние имена `ticket_id`, `service`, `sla_minutes`. Потребитель старого контракта не должен знать о физическом rename и не должен получить новые внутренние поля.',
    starter: `-- Напиши решение с нуля:
-- создай новую физическую таблицу ticket_contract_v2,
-- затем compatibility view с прежним именем service
-- и выполни контрольный SELECT по старому контракту.`,
    solution: `CREATE TEMP TABLE ticket_contract_v2(ticket_id INTEGER PRIMARY KEY, service_code TEXT NOT NULL, sla_minutes INTEGER NOT NULL, migration_revision INTEGER NOT NULL); INSERT INTO ticket_contract_v2 VALUES (401, 'VPN', 60, 2), (402, 'LMS', 120, 2); CREATE TEMP VIEW tickets_legacy AS SELECT ticket_id, service_code AS service, sla_minutes FROM ticket_contract_v2; SELECT ticket_id, service, sla_minutes FROM tickets_legacy ORDER BY ticket_id;`,
    hints: [
      'Compatibility view проецирует старое имя через `service_code AS service`.',
      'Не включай migration_revision: старый контракт должен остаться узким.',
      'Контрольный SELECT обращается только к tickets_legacy.'
    ]
  },
  'task-135': {
    title: 'Докажи устойчивость view к расширению таблицы',
    description: 'Создай view с явной проекцией `ticket_id, service`, затем добавь в базовую таблицу внутреннюю колонку internal_note. Верни колонки view через `pragma_table_info` и данные view: новый физический столбец не должен незаметно стать частью публичного контракта.',
    starter: `-- Создай таблицу и view без SELECT *,
-- расширь таблицу через ALTER TABLE,
-- затем докажи metadata-запросом, что view по-прежнему содержит две колонки.`,
    solution: `CREATE TEMP TABLE support_tickets(ticket_id INTEGER PRIMARY KEY, service TEXT NOT NULL); INSERT INTO support_tickets VALUES (501, 'VPN'), (502, 'LMS'); CREATE TEMP VIEW support_ticket_contract AS SELECT ticket_id, service FROM support_tickets; ALTER TABLE support_tickets ADD COLUMN internal_note TEXT; UPDATE support_tickets SET internal_note = 'hidden' WHERE ticket_id = 501; SELECT 'column' AS evidence_type, name AS evidence_value FROM pragma_table_info('support_ticket_contract') UNION ALL SELECT 'row', CAST(ticket_id AS TEXT) || ':' || service FROM support_ticket_contract ORDER BY evidence_type, evidence_value;`,
    hints: [
      'View должен быть создан как SELECT ticket_id, service, а не SELECT *.',
      'pragma_table_info принимает имя view и показывает публичные колонки.',
      'В результате не должно быть internal_note.'
    ]
  },
  'task-136': {
    title: 'Выполни expand-backfill-contract миграцию email',
    description: 'Мигрируй legacy_users к строгому контракту: расширь таблицу колонкой email_normalized, заполни `lower(trim(email))`, перенеси данные в новую таблицу с NOT NULL и UNIQUE, замени старую таблицу и верни канонические адреса. Каждый этап должен оставлять проверяемую точку контроля.',
    starter: `CREATE TEMP TABLE legacy_users(
  user_id INTEGER PRIMARY KEY,
  email TEXT NOT NULL
);
INSERT INTO legacy_users VALUES
  (1, ' Alice@Example.com '),
  (2, 'BOB@example.com');

-- Expand
ALTER TABLE legacy_users ADD COLUMN email_normalized TEXT;

-- Backfill
UPDATE legacy_users SET email_normalized = ;

-- Contract через новую строгую таблицу
CREATE TEMP TABLE users_new(
  user_id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE
);
INSERT INTO users_new
SELECT
FROM legacy_users
WHERE ;

DROP TABLE legacy_users;
ALTER TABLE users_new RENAME TO legacy_users;

SELECT user_id, email_normalized
FROM legacy_users
ORDER BY user_id;`,
    solution: `CREATE TEMP TABLE legacy_users(user_id INTEGER PRIMARY KEY, email TEXT NOT NULL); INSERT INTO legacy_users VALUES (1, ' Alice@Example.com '), (2, 'BOB@example.com'); ALTER TABLE legacy_users ADD COLUMN email_normalized TEXT; UPDATE legacy_users SET email_normalized = lower(trim(email)); CREATE TEMP TABLE users_new(user_id INTEGER PRIMARY KEY, email TEXT NOT NULL, email_normalized TEXT NOT NULL UNIQUE); INSERT INTO users_new(user_id, email, email_normalized) SELECT user_id, email, email_normalized FROM legacy_users WHERE email_normalized IS NOT NULL; DROP TABLE legacy_users; ALTER TABLE users_new RENAME TO legacy_users; SELECT user_id, email_normalized FROM legacy_users ORDER BY user_id;`,
    hints: [
      'Нормализация: lower(trim(email)).',
      'Новая таблица закрепляет NOT NULL и UNIQUE только после backfill.',
      'Перед DROP количество перенесённых строк должно соответствовать источнику; в fixture их две.'
    ]
  },
  'task-137': {
    title: 'Сделай повтор миграции наблюдаемым и идемпотентным',
    description: 'Создай ledger `schema_migrations` и дважды зарегистрируй одну миграцию `2026_08_add_contact_state`. Точный retry не должен создавать вторую запись или менять исходный applied_at; верни число записей и сохранённую метку времени.',
    starter: `CREATE TEMP TABLE schema_migrations(
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL
);

-- Выполни одну и ту же регистрацию дважды через conflict policy.

SELECT migration_id,
       COUNT(*) OVER (PARTITION BY migration_id) AS ledger_rows,
       applied_at,
       checksum
FROM schema_migrations;`,
    solution: `CREATE TEMP TABLE schema_migrations(migration_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT NOT NULL); INSERT INTO schema_migrations VALUES ('2026_08_add_contact_state', '2026-08-04T12:00:00Z', 'sha256:v1') ON CONFLICT(migration_id) DO NOTHING; INSERT INTO schema_migrations VALUES ('2026_08_add_contact_state', '2026-08-04T12:05:00Z', 'sha256:v1') ON CONFLICT(migration_id) DO NOTHING; SELECT migration_id, COUNT(*) OVER (PARTITION BY migration_id) AS ledger_rows, applied_at, checksum FROM schema_migrations;`,
    hints: [
      'migration_id — стабильный ключ конкретной миграции.',
      'ON CONFLICT(migration_id) DO NOTHING сохраняет первую запись.',
      'ledger_rows должен быть 1, applied_at — 12:00, а не время retry.'
    ]
  },
  'task-138': {
    title: 'Выполни backfill контролируемыми батчами',
    description: 'Добавь normalized_name и заполни шесть строк двумя непересекающимися батчами по customer_id. Затем верни каждую строку и общий remaining_rows, чтобы доказать полное покрытие без повторного изменения уже обработанного диапазона.',
    starter: `CREATE TEMP TABLE customers_migration(
  customer_id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL
);
INSERT INTO customers_migration VALUES
  (1, ' Alice '), (2, 'BOB'), (3, ' Carol '),
  (4, 'DAVE'), (5, ' Eve '), (6, 'FRANK');
ALTER TABLE customers_migration ADD COLUMN normalized_name TEXT;

-- Batch 1: ids 1..3
UPDATE customers_migration
SET normalized_name =
WHERE ;

-- Batch 2: ids 4..6, только ещё не заполненные строки
UPDATE customers_migration
SET normalized_name =
WHERE ;

SELECT customer_id, normalized_name,
       SUM(CASE WHEN normalized_name IS NULL THEN 1 ELSE 0 END) OVER () AS remaining_rows
FROM customers_migration
ORDER BY customer_id;`,
    solution: `CREATE TEMP TABLE customers_migration(customer_id INTEGER PRIMARY KEY, display_name TEXT NOT NULL); INSERT INTO customers_migration VALUES (1, ' Alice '), (2, 'BOB'), (3, ' Carol '), (4, 'DAVE'), (5, ' Eve '), (6, 'FRANK'); ALTER TABLE customers_migration ADD COLUMN normalized_name TEXT; UPDATE customers_migration SET normalized_name = lower(trim(display_name)) WHERE customer_id BETWEEN 1 AND 3 AND normalized_name IS NULL; UPDATE customers_migration SET normalized_name = lower(trim(display_name)) WHERE customer_id BETWEEN 4 AND 6 AND normalized_name IS NULL; SELECT customer_id, normalized_name, SUM(CASE WHEN normalized_name IS NULL THEN 1 ELSE 0 END) OVER () AS remaining_rows FROM customers_migration ORDER BY customer_id;`,
    hints: [
      'Оба UPDATE используют lower(trim(display_name)).',
      'Диапазоны батчей не пересекаются: 1..3 и 4..6.',
      'Добавь normalized_name IS NULL, чтобы безопасный повтор батча не перезаписывал готовые строки.'
    ]
  },
  'task-139': {
    title: 'Докажи обратимость миграции транзакцией',
    description: 'Смоделируй рискованное изменение quota: начни транзакцию, увеличь значения и добавь новую колонку, затем полностью откати миграцию. Итоговый SELECT должен доказать восстановление исходных quota; schema metadata должно подтвердить отсутствие откатанной колонки.',
    starter: `-- Создай service_quota и исходные строки.
-- В BEGIN измени quota и добавь migration_note.
-- Выполни ROLLBACK.
-- Верни данные и число колонок с именем migration_note.`,
    solution: `CREATE TEMP TABLE service_quota(service TEXT PRIMARY KEY, quota INTEGER NOT NULL); INSERT INTO service_quota VALUES ('VPN', 10), ('LMS', 20); BEGIN; UPDATE service_quota SET quota = quota * 2; ALTER TABLE service_quota ADD COLUMN migration_note TEXT; UPDATE service_quota SET migration_note = 'candidate'; ROLLBACK; SELECT service, quota, (SELECT COUNT(*) FROM pragma_table_info('service_quota') WHERE name = 'migration_note') AS rolled_back_columns FROM service_quota ORDER BY service;`,
    hints: [
      'SQLite выполняет ALTER TABLE транзакционно: DDL входит в тот же BEGIN.',
      'ROLLBACK должен отменить и данные, и добавленную колонку.',
      'quota остаются 10 и 20, rolled_back_columns — 0.'
    ]
  },
  'task-140': {
    title: 'Проверь итоговый schema contract по metadata',
    description: 'Создай строгую таблицу contact_points и публичное view active_contacts, затем сформируй единый evidence-report из `pragma_table_info` и `sqlite_temp_master`. Отчёт должен доказать primary key, NOT NULL для channel/destination_digest/state и наличие view без чтения пользовательских данных.',
    starter: `-- Создай contact_points с PK и обязательными колонками,
-- затем explicit-column view active_contacts.
-- Верни metadata evidence через UNION ALL.`,
    solution: `CREATE TEMP TABLE contact_points(contact_id INTEGER PRIMARY KEY, channel TEXT NOT NULL CHECK (channel IN ('email','sms')), destination_digest TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK (state IN ('active','revoked'))); CREATE TEMP VIEW active_contacts AS SELECT contact_id, channel, destination_digest FROM contact_points WHERE state = 'active'; SELECT 'column:' || ti.name AS contract_item, CASE WHEN ti.pk = 1 THEN 'primary-key' WHEN ti."notnull" = 1 THEN 'not-null' ELSE 'nullable' END AS contract_value FROM pragma_table_info('contact_points') AS ti WHERE ti.name IN ('contact_id','channel','destination_digest','state') UNION ALL SELECT 'view:active_contacts', type FROM sqlite_temp_master WHERE type = 'view' AND name = 'active_contacts' ORDER BY contract_item;`,
    hints: [
      'contact_id — INTEGER PRIMARY KEY; три остальные контрактные колонки — NOT NULL.',
      'View явно перечисляет contact_id, channel, destination_digest и скрывает state.',
      'sqlite_temp_master подтверждает тип объекта `view`.'
    ]
  }
};

export const schemaEvolutionAuthoredTaskEvidence: Readonly<Record<string, readonly SchemaEvolutionEvidenceTag[]>> = {
  'task-131': ['preflight-validation', 'invalid-row-report', 'check-constraint'],
  'task-132': ['expand-migration', 'backfill', 'null-proof'],
  'task-133': ['copy-and-swap', 'check-constraint', 'row-count-reconciliation'],
  'task-134': ['compatibility-view', 'explicit-projection', 'rename-compatibility'],
  'task-135': ['view-stability', 'schema-addition', 'explicit-projection'],
  'task-136': ['expand-migration', 'backfill', 'contract-migration', 'normalization', 'unique-constraint'],
  'task-137': ['migration-ledger', 'idempotent-migration', 'contract-verification'],
  'task-138': ['batch-backfill', 'coverage-proof', 'normalization'],
  'task-139': ['transactional-ddl', 'rollback-proof', 'contract-verification'],
  'task-140': ['schema-metadata', 'contract-verification', 'explicit-projection']
};

export function advancedSchemaEvolutionTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedSchemaEvolutionTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedSchemaEvolutionTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}

export const schemaEvolutionAuthoredTaskIds = Object.freeze(Object.keys(taskOverrides));
