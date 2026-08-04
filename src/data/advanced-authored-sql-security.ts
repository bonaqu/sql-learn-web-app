import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type SqlSecurityEvidenceTag =
  | 'value-binding'
  | 'fixed-query-shape'
  | 'injection-payload'
  | 'identifier-whitelist'
  | 'deny-by-default'
  | 'tenant-isolation'
  | 'result-scope'
  | 'least-privilege'
  | 'permission-matrix'
  | 'redacted-logging'
  | 'secret-minimization'
  | 'dynamic-sql-review'
  | 'unsafe-concatenation'
  | 'sensitive-column-policy'
  | 'ownership-authorization'
  | 'explicit-grant'
  | 'log-audit'
  | 'secret-detection'
  | 'decision-reconciliation'
  | 'fail-closed-order';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-201': {
    title: 'Докажи, что пользовательский ввод остаётся значением',
    description: 'Смоделируй bind-параметр как отдельную таблицу request_values и выполни один фиксированный запрос равенства. Строка с injection payload должна остаться обычным значением, не изменить форму SQL и не получить лишние совпадения.',
    starter: `CREATE TEMP TABLE accounts(account_id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE);
INSERT INTO accounts VALUES (1, 'alice'), (2, 'bob');
CREATE TEMP TABLE request_values(request_id INTEGER PRIMARY KEY, input_text TEXT NOT NULL);
INSERT INTO request_values VALUES (1, 'alice'), (2, ''' OR 1=1 --');

SELECT rv.request_id, rv.input_text, COUNT(a.account_id) AS matched_accounts
FROM request_values rv
LEFT JOIN accounts a ON
GROUP BY rv.request_id, rv.input_text
ORDER BY rv.request_id;`,
    solution: `CREATE TEMP TABLE accounts(account_id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE); INSERT INTO accounts VALUES (1, 'alice'), (2, 'bob'); CREATE TEMP TABLE request_values(request_id INTEGER PRIMARY KEY, input_text TEXT NOT NULL); INSERT INTO request_values VALUES (1, 'alice'), (2, ''' OR 1=1 --'); SELECT rv.request_id, rv.input_text, COUNT(a.account_id) AS matched_accounts FROM request_values rv LEFT JOIN accounts a ON a.username = rv.input_text GROUP BY rv.request_id, rv.input_text ORDER BY rv.request_id;`,
    hints: [
      'Структура запроса не зависит от input_text.',
      'Свяжи username с input_text обычным равенством.',
      'Injection payload должен вернуть 0 совпадений.'
    ]
  },
  'task-202': {
    title: 'Разреши динамический identifier только через allowlist',
    description: 'Проверь запрошенные ключи сортировки по явной таблице allowed_sort_keys. Идентификаторы нельзя безопасно передать как обычные bind-values, поэтому неизвестный или похожий на SQL ключ должен получить решение rejected, а не попасть в dynamic SQL.',
    starter: `CREATE TEMP TABLE allowed_sort_keys(sort_key TEXT PRIMARY KEY, safe_expression TEXT NOT NULL);
INSERT INTO allowed_sort_keys VALUES ('created_at', 'created_at, ticket_id'), ('priority', 'priority_rank, ticket_id');
CREATE TEMP TABLE sort_requests(request_id INTEGER PRIMARY KEY, requested_key TEXT NOT NULL);
INSERT INTO sort_requests VALUES (1, 'created_at'), (2, 'priority'), (3, 'priority; DROP TABLE tickets');

SELECT r.request_id, r.requested_key,
       a.safe_expression,
       CASE WHEN  THEN 'allowed' ELSE 'rejected' END AS decision
FROM sort_requests r
LEFT JOIN allowed_sort_keys a ON
ORDER BY r.request_id;`,
    solution: `CREATE TEMP TABLE allowed_sort_keys(sort_key TEXT PRIMARY KEY, safe_expression TEXT NOT NULL); INSERT INTO allowed_sort_keys VALUES ('created_at', 'created_at, ticket_id'), ('priority', 'priority_rank, ticket_id'); CREATE TEMP TABLE sort_requests(request_id INTEGER PRIMARY KEY, requested_key TEXT NOT NULL); INSERT INTO sort_requests VALUES (1, 'created_at'), (2, 'priority'), (3, 'priority; DROP TABLE tickets'); SELECT r.request_id, r.requested_key, a.safe_expression, CASE WHEN a.sort_key IS NOT NULL THEN 'allowed' ELSE 'rejected' END AS decision FROM sort_requests r LEFT JOIN allowed_sort_keys a ON a.sort_key = r.requested_key ORDER BY r.request_id;`,
    hints: [
      'Identifier считается разрешённым только при точном совпадении allowlist.',
      'safe_expression хранится в доверенной таблице, не во вводе пользователя.',
      'LEFT JOIN сохраняет rejected-запрос для аудита.'
    ]
  },
  'task-203': {
    title: 'Докажи tenant isolation на результирующем grain',
    description: 'Для каждого request context посчитай видимые тикеты только своего tenant и отдельно докажи, что cross_tenant_rows равен нулю. Фильтр tenant_id должен быть частью связи с ресурсом, а не необязательным клиентским условием.',
    starter: `CREATE TEMP TABLE request_context(request_id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
INSERT INTO request_context VALUES (1, 'A'), (2, 'B');
CREATE TEMP TABLE tenant_tickets(ticket_id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, subject TEXT NOT NULL);
INSERT INTO tenant_tickets VALUES (10, 'A', 'VPN'), (11, 'A', 'LMS'), (20, 'B', 'Email');

WITH visible AS (
  SELECT r.request_id, r.tenant_id AS request_tenant, t.ticket_id, t.tenant_id AS resource_tenant
  FROM request_context r
  JOIN tenant_tickets t ON
)
SELECT request_id,
       COUNT(ticket_id) AS visible_count,
       SUM(resource_tenant <> request_tenant) AS cross_tenant_rows
FROM visible
GROUP BY request_id
ORDER BY request_id;`,
    solution: `CREATE TEMP TABLE request_context(request_id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL); INSERT INTO request_context VALUES (1, 'A'), (2, 'B'); CREATE TEMP TABLE tenant_tickets(ticket_id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, subject TEXT NOT NULL); INSERT INTO tenant_tickets VALUES (10, 'A', 'VPN'), (11, 'A', 'LMS'), (20, 'B', 'Email'); WITH visible AS (SELECT r.request_id, r.tenant_id AS request_tenant, t.ticket_id, t.tenant_id AS resource_tenant FROM request_context r JOIN tenant_tickets t ON t.tenant_id = r.tenant_id) SELECT request_id, COUNT(ticket_id) AS visible_count, SUM(resource_tenant <> request_tenant) AS cross_tenant_rows FROM visible GROUP BY request_id ORDER BY request_id;`,
    hints: [
      'Tenant predicate ставится в JOIN к ресурсу.',
      'Результирующий grain — одна строка на request_id.',
      'cross_tenant_rows является независимым контрольным доказательством.'
    ]
  },
  'task-204': {
    title: 'Собери least-privilege permission matrix',
    description: 'Из ролей и атомарных permissions собери эффективные read/write/admin-флаги для каждого пользователя. Пользователь без роли должен получить все нули: отсутствие назначения не означает неявный доступ.',
    starter: `CREATE TEMP TABLE users(user_id INTEGER PRIMARY KEY, username TEXT NOT NULL);
INSERT INTO users VALUES (1, 'viewer'), (2, 'operator'), (3, 'owner'), (4, 'unassigned');
CREATE TEMP TABLE user_roles(user_id INTEGER NOT NULL, role_name TEXT NOT NULL);
INSERT INTO user_roles VALUES (1, 'reader'), (2, 'operator'), (3, 'owner');
CREATE TEMP TABLE role_permissions(role_name TEXT NOT NULL, permission TEXT NOT NULL);
INSERT INTO role_permissions VALUES
 ('reader','read'), ('operator','read'), ('operator','write'),
 ('owner','read'), ('owner','write'), ('owner','admin');

SELECT u.user_id, u.username,
       MAX(CASE WHEN p.permission = 'read' THEN 1 ELSE 0 END) AS can_read,
       MAX(CASE WHEN p.permission = 'write' THEN 1 ELSE 0 END) AS can_write,
       MAX(CASE WHEN p.permission = 'admin' THEN 1 ELSE 0 END) AS can_admin
FROM users u
LEFT JOIN user_roles ur ON
LEFT JOIN role_permissions p ON
GROUP BY u.user_id, u.username
ORDER BY u.user_id;`,
    solution: `CREATE TEMP TABLE users(user_id INTEGER PRIMARY KEY, username TEXT NOT NULL); INSERT INTO users VALUES (1, 'viewer'), (2, 'operator'), (3, 'owner'), (4, 'unassigned'); CREATE TEMP TABLE user_roles(user_id INTEGER NOT NULL, role_name TEXT NOT NULL); INSERT INTO user_roles VALUES (1, 'reader'), (2, 'operator'), (3, 'owner'); CREATE TEMP TABLE role_permissions(role_name TEXT NOT NULL, permission TEXT NOT NULL); INSERT INTO role_permissions VALUES ('reader','read'), ('operator','read'), ('operator','write'), ('owner','read'), ('owner','write'), ('owner','admin'); SELECT u.user_id, u.username, MAX(CASE WHEN p.permission = 'read' THEN 1 ELSE 0 END) AS can_read, MAX(CASE WHEN p.permission = 'write' THEN 1 ELSE 0 END) AS can_write, MAX(CASE WHEN p.permission = 'admin' THEN 1 ELSE 0 END) AS can_admin FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.user_id LEFT JOIN role_permissions p ON p.role_name = ur.role_name GROUP BY u.user_id, u.username ORDER BY u.user_id;`,
    hints: [
      'LEFT JOIN сохраняет пользователя без роли.',
      'Каждый permission превращается в отдельный MAX(CASE...).',
      'ELSE 0 реализует deny by default.'
    ]
  },
  'task-205': {
    title: 'Сформируй audit log без сырых контактов и токенов',
    description: 'Построй безопасную audit-строку из request metadata. Email должен стать hint, токен — только длиной, а контрольные флаги должны доказать, что raw email и raw token не попали в safe_log.',
    starter: `CREATE TEMP TABLE auth_requests(request_id INTEGER PRIMARY KEY, email TEXT NOT NULL, api_token TEXT NOT NULL, outcome TEXT NOT NULL);
INSERT INTO auth_requests VALUES
 (1, 'alice@example.com', 'tok_live_ABC123', 'allowed'),
 (2, 'bob@corp.test', 'tok_live_XYZ999', 'denied');

WITH safe AS (
  SELECT request_id, email, api_token,
         substr(email, 1, 1) || '***@' || substr(email, instr(email, '@') + 1) AS email_hint,
         'token-length:' || length(api_token) AS token_hint,
         outcome
  FROM auth_requests
), logs AS (
  SELECT request_id, email, api_token,
         'request=' || request_id || ';email=' || email_hint || ';token=' || token_hint || ';outcome=' || outcome AS safe_log
  FROM safe
)
SELECT request_id, safe_log,
       instr(safe_log, email) AS raw_email_leak,
       instr(safe_log, api_token) AS raw_token_leak
FROM logs
ORDER BY request_id;`,
    solution: `CREATE TEMP TABLE auth_requests(request_id INTEGER PRIMARY KEY, email TEXT NOT NULL, api_token TEXT NOT NULL, outcome TEXT NOT NULL); INSERT INTO auth_requests VALUES (1, 'alice@example.com', 'tok_live_ABC123', 'allowed'), (2, 'bob@corp.test', 'tok_live_XYZ999', 'denied'); WITH safe AS (SELECT request_id, email, api_token, substr(email, 1, 1) || '***@' || substr(email, instr(email, '@') + 1) AS email_hint, 'token-length:' || length(api_token) AS token_hint, outcome FROM auth_requests), logs AS (SELECT request_id, email, api_token, 'request=' || request_id || ';email=' || email_hint || ';token=' || token_hint || ';outcome=' || outcome AS safe_log FROM safe) SELECT request_id, safe_log, instr(safe_log, email) AS raw_email_leak, instr(safe_log, api_token) AS raw_token_leak FROM logs ORDER BY request_id;`,
    hints: [
      'Сохрани только первую букву email и домен.',
      'Токен представь длиной, не prefix или suffix.',
      'instr(...)=0 доказывает отсутствие raw secret.'
    ]
  },
  'task-206': {
    title: 'Проведи review способов построения SQL',
    description: 'Классифицируй query samples по способу формирования: bind value и static SQL безопасны, конкатенация value и непроверенный identifier опасны. Решение должно основываться на construction_mode, а не на попытке угадать payload по внешнему виду.',
    starter: `CREATE TEMP TABLE query_samples(sample_id INTEGER PRIMARY KEY, construction_mode TEXT NOT NULL, query_shape TEXT NOT NULL);
INSERT INTO query_samples VALUES
 (1, 'bound-value', 'SELECT * FROM accounts WHERE username = ?'),
 (2, 'value-concat', 'SELECT * FROM accounts WHERE username = '),
 (3, 'raw-identifier', 'SELECT * FROM tickets ORDER BY <input>'),
 (4, 'static', 'SELECT COUNT(*) FROM tickets');

SELECT sample_id, construction_mode,
       CASE
         WHEN construction_mode IN () THEN 'safe'
         WHEN construction_mode =  THEN 'unsafe-value-concat'
         ELSE 'unsafe-identifier'
       END AS review_state
FROM query_samples
ORDER BY sample_id;`,
    solution: `CREATE TEMP TABLE query_samples(sample_id INTEGER PRIMARY KEY, construction_mode TEXT NOT NULL, query_shape TEXT NOT NULL); INSERT INTO query_samples VALUES (1, 'bound-value', 'SELECT * FROM accounts WHERE username = ?'), (2, 'value-concat', 'SELECT * FROM accounts WHERE username = '), (3, 'raw-identifier', 'SELECT * FROM tickets ORDER BY <input>'), (4, 'static', 'SELECT COUNT(*) FROM tickets'); SELECT sample_id, construction_mode, CASE WHEN construction_mode IN ('bound-value','static') THEN 'safe' WHEN construction_mode = 'value-concat' THEN 'unsafe-value-concat' ELSE 'unsafe-identifier' END AS review_state FROM query_samples ORDER BY sample_id;`,
    hints: [
      'Проверяй data flow, а не конкретную строку payload.',
      'bound-value и static имеют фиксированную структуру.',
      'raw identifier требует отдельного allowlist.'
    ]
  },
  'task-207': {
    title: 'Отфильтруй export columns через policy allowlist',
    description: 'Собери запрошенные колонки экспорта в исходном порядке, отдельно перечисли запрещённые и вынеси решение allowed/rejected. password_hash не должен пройти даже вместе с разрешёнными полями.',
    starter: `CREATE TEMP TABLE allowed_export_columns(column_name TEXT PRIMARY KEY);
INSERT INTO allowed_export_columns VALUES ('account_id'), ('display_name'), ('status');
CREATE TEMP TABLE export_requests(request_id INTEGER NOT NULL, position INTEGER NOT NULL, column_name TEXT NOT NULL);
INSERT INTO export_requests VALUES
 (1,1,'account_id'), (1,2,'display_name'), (1,3,'password_hash'),
 (2,1,'status');

WITH classified AS (
  SELECT r.*, CASE WHEN  THEN 1 ELSE 0 END AS allowed
  FROM export_requests r
  LEFT JOIN allowed_export_columns a ON
), ordered AS (
  SELECT * FROM classified ORDER BY request_id, position
)
SELECT request_id,
       GROUP_CONCAT(CASE WHEN allowed = 1 THEN column_name END, ',') AS accepted_columns,
       GROUP_CONCAT(CASE WHEN allowed = 0 THEN column_name END, ',') AS rejected_columns,
       CASE WHEN SUM(allowed = 0) = 0 THEN 'allowed' ELSE 'rejected' END AS decision
FROM ordered
GROUP BY request_id
ORDER BY request_id;`,
    solution: `CREATE TEMP TABLE allowed_export_columns(column_name TEXT PRIMARY KEY); INSERT INTO allowed_export_columns VALUES ('account_id'), ('display_name'), ('status'); CREATE TEMP TABLE export_requests(request_id INTEGER NOT NULL, position INTEGER NOT NULL, column_name TEXT NOT NULL); INSERT INTO export_requests VALUES (1,1,'account_id'), (1,2,'display_name'), (1,3,'password_hash'), (2,1,'status'); WITH classified AS (SELECT r.*, CASE WHEN a.column_name IS NOT NULL THEN 1 ELSE 0 END AS allowed FROM export_requests r LEFT JOIN allowed_export_columns a ON a.column_name = r.column_name), ordered AS (SELECT * FROM classified ORDER BY request_id, position) SELECT request_id, GROUP_CONCAT(CASE WHEN allowed = 1 THEN column_name END, ',') AS accepted_columns, GROUP_CONCAT(CASE WHEN allowed = 0 THEN column_name END, ',') AS rejected_columns, CASE WHEN SUM(allowed = 0) = 0 THEN 'allowed' ELSE 'rejected' END AS decision FROM ordered GROUP BY request_id ORDER BY request_id;`,
    hints: [
      'Allowlist сравнивается точным именем колонки.',
      'GROUP_CONCAT игнорирует NULL из противоположной категории.',
      'Любая запрещённая колонка отклоняет весь request.'
    ]
  },
  'task-208': {
    title: 'Разреши ресурс владельцу или по явному grant',
    description: 'Для каждого access request верни owner, explicit-grant или denied. Совпадение владельца проверяется первым, grant требует точного actor/resource/action, а отсутствие обоих условий должно закрывать доступ.',
    starter: `CREATE TEMP TABLE secured_resources(resource_id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL);
INSERT INTO secured_resources VALUES (10, 1), (20, 2);
CREATE TEMP TABLE resource_grants(actor_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, action TEXT NOT NULL);
INSERT INTO resource_grants VALUES (3, 20, 'read');
CREATE TEMP TABLE access_requests(request_id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, action TEXT NOT NULL);
INSERT INTO access_requests VALUES
 (1,1,10,'write'), (2,3,20,'read'), (3,3,20,'write'), (4,4,10,'read');

SELECT q.request_id,
       CASE
         WHEN  THEN 'owner'
         WHEN EXISTS () THEN 'explicit-grant'
         ELSE 'denied'
       END AS access_reason
FROM access_requests q
JOIN secured_resources r ON
ORDER BY q.request_id;`,
    solution: `CREATE TEMP TABLE secured_resources(resource_id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL); INSERT INTO secured_resources VALUES (10, 1), (20, 2); CREATE TEMP TABLE resource_grants(actor_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, action TEXT NOT NULL); INSERT INTO resource_grants VALUES (3, 20, 'read'); CREATE TEMP TABLE access_requests(request_id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, action TEXT NOT NULL); INSERT INTO access_requests VALUES (1,1,10,'write'), (2,3,20,'read'), (3,3,20,'write'), (4,4,10,'read'); SELECT q.request_id, CASE WHEN r.owner_id = q.actor_id THEN 'owner' WHEN EXISTS (SELECT 1 FROM resource_grants g WHERE g.actor_id = q.actor_id AND g.resource_id = q.resource_id AND g.action = q.action) THEN 'explicit-grant' ELSE 'denied' END AS access_reason FROM access_requests q JOIN secured_resources r ON r.resource_id = q.resource_id ORDER BY q.request_id;`,
    hints: [
      'Owner rule проверяется до grant.',
      'Grant коррелируется по actor, resource и action.',
      'ELSE denied реализует fail closed.'
    ]
  },
  'task-209': {
    title: 'Найди literal secrets в query logs',
    description: 'Проведи аудит сохранённых SQL-логов и посчитай записи с literal password/token против безопасных placeholder-запросов. Результат должен перечислить risky sample IDs и дать независимый total для reconciliation.',
    starter: `CREATE TEMP TABLE query_logs(log_id INTEGER PRIMARY KEY, statement_text TEXT NOT NULL);
INSERT INTO query_logs VALUES
 (1, 'SELECT * FROM users WHERE username = ? AND password = ?'),
 (2, 'SELECT * FROM users WHERE password = ''hunter2'''),
 (3, 'UPDATE integrations SET api_token = ''tok_live_ABC'' WHERE id = 1'),
 (4, 'SELECT COUNT(*) FROM tickets');

WITH classified AS (
  SELECT log_id,
         CASE WHEN  THEN 1 ELSE 0 END AS contains_literal_secret
  FROM query_logs
)
SELECT COUNT(*) AS total_logs,
       SUM(contains_literal_secret) AS risky_logs,
       GROUP_CONCAT(CASE WHEN contains_literal_secret = 1 THEN log_id END, ',') AS risky_log_ids,
       COUNT(*) - SUM(contains_literal_secret) AS safe_logs
FROM classified;`,
    solution: `CREATE TEMP TABLE query_logs(log_id INTEGER PRIMARY KEY, statement_text TEXT NOT NULL); INSERT INTO query_logs VALUES (1, 'SELECT * FROM users WHERE username = ? AND password = ?'), (2, 'SELECT * FROM users WHERE password = ''hunter2'''), (3, 'UPDATE integrations SET api_token = ''tok_live_ABC'' WHERE id = 1'), (4, 'SELECT COUNT(*) FROM tickets'); WITH classified AS (SELECT log_id, CASE WHEN statement_text LIKE '%password = ''%' OR statement_text LIKE '%api_token = ''%' THEN 1 ELSE 0 END AS contains_literal_secret FROM query_logs) SELECT COUNT(*) AS total_logs, SUM(contains_literal_secret) AS risky_logs, GROUP_CONCAT(CASE WHEN contains_literal_secret = 1 THEN log_id END, ',') AS risky_log_ids, COUNT(*) - SUM(contains_literal_secret) AS safe_logs FROM classified;`,
    hints: [
      'Placeholder password = ? не является literal secret.',
      'Ищи quote сразу после sensitive assignment.',
      'Отчёт должен сверять risky и safe с total.'
    ]
  },
  'task-210': {
    title: 'Сверь fail-closed security decisions',
    description: 'Классифицируй запросы в строгом порядке: unauthenticated, tenant mismatch, insufficient permission, rejected identifier или allowed. Категории должны быть взаимоисключающими, а reconciliation_gap — нулевым.',
    starter: `CREATE TEMP TABLE security_requests(
 request_id INTEGER PRIMARY KEY,
 authenticated INTEGER NOT NULL,
 tenant_match INTEGER NOT NULL,
 permission_granted INTEGER NOT NULL,
 identifier_whitelisted INTEGER NOT NULL
);
INSERT INTO security_requests VALUES
 (1,1,1,1,1), (2,0,1,1,1), (3,1,0,1,1),
 (4,1,1,0,1), (5,1,1,1,0), (6,1,1,1,1);

WITH decisions AS (
  SELECT request_id,
         CASE
           WHEN  THEN 'unauthenticated'
           WHEN  THEN 'tenant-mismatch'
           WHEN  THEN 'insufficient-permission'
           WHEN  THEN 'rejected-identifier'
           ELSE 'allowed'
         END AS decision
  FROM security_requests
), report AS (
  SELECT COUNT(*) AS total_requests,
         SUM(decision = 'allowed') AS allowed_requests,
         SUM(decision = 'unauthenticated') AS unauthenticated_requests,
         SUM(decision = 'tenant-mismatch') AS tenant_mismatch_requests,
         SUM(decision = 'insufficient-permission') AS permission_denied_requests,
         SUM(decision = 'rejected-identifier') AS identifier_rejected_requests
  FROM decisions
)
SELECT *, total_requests - allowed_requests - unauthenticated_requests - tenant_mismatch_requests - permission_denied_requests - identifier_rejected_requests AS reconciliation_gap
FROM report;`,
    solution: `CREATE TEMP TABLE security_requests(request_id INTEGER PRIMARY KEY, authenticated INTEGER NOT NULL, tenant_match INTEGER NOT NULL, permission_granted INTEGER NOT NULL, identifier_whitelisted INTEGER NOT NULL); INSERT INTO security_requests VALUES (1,1,1,1,1), (2,0,1,1,1), (3,1,0,1,1), (4,1,1,0,1), (5,1,1,1,0), (6,1,1,1,1); WITH decisions AS (SELECT request_id, CASE WHEN authenticated = 0 THEN 'unauthenticated' WHEN tenant_match = 0 THEN 'tenant-mismatch' WHEN permission_granted = 0 THEN 'insufficient-permission' WHEN identifier_whitelisted = 0 THEN 'rejected-identifier' ELSE 'allowed' END AS decision FROM security_requests), report AS (SELECT COUNT(*) AS total_requests, SUM(decision = 'allowed') AS allowed_requests, SUM(decision = 'unauthenticated') AS unauthenticated_requests, SUM(decision = 'tenant-mismatch') AS tenant_mismatch_requests, SUM(decision = 'insufficient-permission') AS permission_denied_requests, SUM(decision = 'rejected-identifier') AS identifier_rejected_requests FROM decisions) SELECT *, total_requests - allowed_requests - unauthenticated_requests - tenant_mismatch_requests - permission_denied_requests - identifier_rejected_requests AS reconciliation_gap FROM report;`,
    hints: [
      'CASE проверяет причины отказа до allowed.',
      'Каждый request получает ровно одну decision.',
      'reconciliation_gap должен быть равен нулю.'
    ]
  }
};

export const sqlSecurityAuthoredTaskEvidence: Readonly<Record<string, readonly SqlSecurityEvidenceTag[]>> = {
  'task-201': ['value-binding', 'fixed-query-shape', 'injection-payload'],
  'task-202': ['identifier-whitelist', 'deny-by-default'],
  'task-203': ['tenant-isolation', 'result-scope'],
  'task-204': ['least-privilege', 'permission-matrix', 'deny-by-default'],
  'task-205': ['redacted-logging', 'secret-minimization'],
  'task-206': ['dynamic-sql-review', 'unsafe-concatenation', 'identifier-whitelist'],
  'task-207': ['identifier-whitelist', 'sensitive-column-policy', 'deny-by-default'],
  'task-208': ['ownership-authorization', 'explicit-grant', 'deny-by-default'],
  'task-209': ['log-audit', 'secret-detection', 'redacted-logging'],
  'task-210': ['decision-reconciliation', 'fail-closed-order', 'deny-by-default']
};

export function advancedSqlSecurityTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedSqlSecurityTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedSqlSecurityTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}
