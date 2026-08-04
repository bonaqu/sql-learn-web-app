import type { SqlTask } from './course';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

export type ConcurrencyEvidenceTag =
  | 'invariant-definition'
  | 'read-write-set'
  | 'optimistic-versioning'
  | 'affected-row-proof'
  | 'stale-write-rejection'
  | 'lost-update'
  | 'atomic-update'
  | 'savepoint'
  | 'partial-rollback'
  | 'idempotency-key'
  | 'replay-safety'
  | 'retry-classification'
  | 'idempotent-retry'
  | 'single-lease'
  | 'claim-race'
  | 'conservation-invariant'
  | 'transaction-ledger'
  | 'conflict-diagnosis'
  | 'outcome-reconciliation'
  | 'fail-closed-retry';

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-211': {
    title: 'Зафиксируй invariant и read/write set операции',
    description: 'Собери для каждой конкурентной операции явные read_set, write_set и invariant. До выбора транзакции или isolation level нужно доказать, какие ресурсы читаются и изменяются и какое состояние обязано сохраниться.',
    starter: `CREATE TEMP TABLE operation_steps(operation_id INTEGER NOT NULL, step_order INTEGER NOT NULL, resource TEXT NOT NULL, access_mode TEXT NOT NULL, invariant TEXT NOT NULL);
INSERT INTO operation_steps VALUES
 (1,1,'accounts','read-write','total-balance-conserved'),
 (1,2,'transfer_ledger','write','total-balance-conserved'),
 (2,1,'profiles','read-write','version-monotonic');

WITH ordered AS (
  SELECT * FROM operation_steps ORDER BY operation_id, step_order
)
SELECT operation_id,
       GROUP_CONCAT(CASE WHEN  THEN resource END, ',') AS read_set,
       GROUP_CONCAT(CASE WHEN  THEN resource END, ',') AS write_set,
       MIN(invariant) AS invariant
FROM ordered
GROUP BY operation_id
ORDER BY operation_id;`,
    solution: `CREATE TEMP TABLE operation_steps(operation_id INTEGER NOT NULL, step_order INTEGER NOT NULL, resource TEXT NOT NULL, access_mode TEXT NOT NULL, invariant TEXT NOT NULL); INSERT INTO operation_steps VALUES (1,1,'accounts','read-write','total-balance-conserved'), (1,2,'transfer_ledger','write','total-balance-conserved'), (2,1,'profiles','read-write','version-monotonic'); WITH ordered AS (SELECT * FROM operation_steps ORDER BY operation_id, step_order) SELECT operation_id, GROUP_CONCAT(CASE WHEN access_mode IN ('read','read-write') THEN resource END, ',') AS read_set, GROUP_CONCAT(CASE WHEN access_mode IN ('write','read-write') THEN resource END, ',') AS write_set, MIN(invariant) AS invariant FROM ordered GROUP BY operation_id ORDER BY operation_id;`,
    hints: [
      'read-write ресурс входит в оба множества.',
      'Порядок step_order делает наборы воспроизводимыми.',
      'Invariant должен быть единым для всех шагов операции.'
    ]
  },
  'task-212': {
    title: 'Выполни optimistic update по ожидаемой версии',
    description: 'Обнови документ только при совпадении ожидаемой версии, увеличь version атомарно и верни affected_rows вместе с итоговой строкой. Успех доказывается не отсутствием ошибки, а ровно одной изменённой строкой.',
    starter: `CREATE TEMP TABLE optimistic_documents(document_id INTEGER PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL);
INSERT INTO optimistic_documents VALUES (1, 'draft', 3);

UPDATE optimistic_documents
SET content = 'published', version = version + 1
WHERE document_id = 1 AND ;

SELECT changes() AS affected_rows, document_id, content, version
FROM optimistic_documents
WHERE document_id = 1;`,
    solution: `CREATE TEMP TABLE optimistic_documents(document_id INTEGER PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL); INSERT INTO optimistic_documents VALUES (1, 'draft', 3); UPDATE optimistic_documents SET content = 'published', version = version + 1 WHERE document_id = 1 AND version = 3; SELECT changes() AS affected_rows, document_id, content, version FROM optimistic_documents WHERE document_id = 1;`,
    hints: [
      'Expected version включается в WHERE.',
      'Новая version вычисляется как version + 1 в том же UPDATE.',
      'changes() должен вернуть 1.'
    ]
  },
  'task-213': {
    title: 'Отклони stale write без перезаписи новых данных',
    description: 'Попытайся применить update с устаревшей expected version. Запрос должен затронуть ноль строк, сохранить актуальный content/version и вернуть outcome version-conflict вместо молчаливой потери чужого изменения.',
    starter: `CREATE TEMP TABLE optimistic_documents(document_id INTEGER PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL);
INSERT INTO optimistic_documents VALUES (1, 'published', 4);

UPDATE optimistic_documents
SET content = 'stale-overwrite', version = version + 1
WHERE document_id = 1 AND version = ;

SELECT changes() AS affected_rows, document_id, content, version,
       CASE WHEN changes() = 0 THEN 'version-conflict' ELSE 'updated' END AS outcome
FROM optimistic_documents
WHERE document_id = 1;`,
    solution: `CREATE TEMP TABLE optimistic_documents(document_id INTEGER PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL); INSERT INTO optimistic_documents VALUES (1, 'published', 4); UPDATE optimistic_documents SET content = 'stale-overwrite', version = version + 1 WHERE document_id = 1 AND version = 3; SELECT changes() AS affected_rows, document_id, content, version, CASE WHEN changes() = 0 THEN 'version-conflict' ELSE 'updated' END AS outcome FROM optimistic_documents WHERE document_id = 1;`,
    hints: [
      'Клиент ожидает version 3, в базе уже 4.',
      'Ноль affected rows является сигналом конфликта.',
      'Актуальная строка должна остаться неизменной.'
    ]
  },
  'task-214': {
    title: 'Сравни lost update с атомарным increment',
    description: 'Смоделируй два клиента, прочитавших значение 10. Две абсолютные записи observed+1 потеряют один increment, а два атомарных `value = value + 1` сохранят оба изменения; выведи разницу явно.',
    starter: `-- Напиши решение с нуля:
-- создай unsafe_counter, safe_counter и два client_reads со значением 10;
-- дважды запиши observed+1 в unsafe_counter;
-- дважды выполни value=value+1 в safe_counter;
-- верни оба итога и потерянный increment.`,
    solution: `CREATE TEMP TABLE unsafe_counter(counter_id INTEGER PRIMARY KEY, value INTEGER NOT NULL); CREATE TEMP TABLE safe_counter(counter_id INTEGER PRIMARY KEY, value INTEGER NOT NULL); CREATE TEMP TABLE client_reads(client_id TEXT PRIMARY KEY, observed_value INTEGER NOT NULL); INSERT INTO unsafe_counter VALUES (1, 10); INSERT INTO safe_counter VALUES (1, 10); INSERT INTO client_reads VALUES ('A',10),('B',10); UPDATE unsafe_counter SET value = (SELECT observed_value + 1 FROM client_reads WHERE client_id = 'A') WHERE counter_id = 1; UPDATE unsafe_counter SET value = (SELECT observed_value + 1 FROM client_reads WHERE client_id = 'B') WHERE counter_id = 1; UPDATE safe_counter SET value = value + 1 WHERE counter_id = 1; UPDATE safe_counter SET value = value + 1 WHERE counter_id = 1; SELECT u.value AS unsafe_final, s.value AS atomic_final, s.value - u.value AS lost_updates_exposed FROM unsafe_counter u JOIN safe_counter s ON s.counter_id = u.counter_id;`,
    hints: [
      'Оба unsafe-клиента используют одно старое observed_value.',
      'Atomic increment читает текущее значение внутри UPDATE.',
      'Ожидаемые итоги: 11 против 12.'
    ]
  },
  'task-215': {
    title: 'Откати невалидную попытку до SAVEPOINT',
    description: 'Внутри транзакции зарезервируй товар и создай заказ, затем смоделируй отклонённую бизнес-проверку через `ROLLBACK TO`. После RELEASE/COMMIT склад и таблица заказов должны вернуться к исходному состоянию.',
    starter: `CREATE TEMP TABLE inventory(sku TEXT PRIMARY KEY, stock INTEGER NOT NULL);
CREATE TEMP TABLE orders(order_id INTEGER PRIMARY KEY, sku TEXT NOT NULL, quantity INTEGER NOT NULL);
INSERT INTO inventory VALUES ('GPU', 5);

BEGIN;
SAVEPOINT reserve_attempt;
UPDATE inventory SET stock = stock - 4 WHERE sku = 'GPU';
INSERT INTO orders VALUES (100, 'GPU', 4);
-- Откати только попытку резервирования

SELECT i.sku, i.stock, COUNT(o.order_id) AS order_rows,
       CASE WHEN i.stock = 5 AND COUNT(o.order_id) = 0 THEN 'rejected-and-restored' ELSE 'broken' END AS outcome
FROM inventory i
LEFT JOIN orders o ON o.sku = i.sku
GROUP BY i.sku, i.stock;`,
    solution: `CREATE TEMP TABLE inventory(sku TEXT PRIMARY KEY, stock INTEGER NOT NULL); CREATE TEMP TABLE orders(order_id INTEGER PRIMARY KEY, sku TEXT NOT NULL, quantity INTEGER NOT NULL); INSERT INTO inventory VALUES ('GPU', 5); BEGIN; SAVEPOINT reserve_attempt; UPDATE inventory SET stock = stock - 4 WHERE sku = 'GPU'; INSERT INTO orders VALUES (100, 'GPU', 4); ROLLBACK TO reserve_attempt; RELEASE reserve_attempt; COMMIT; SELECT i.sku, i.stock, COUNT(o.order_id) AS order_rows, CASE WHEN i.stock = 5 AND COUNT(o.order_id) = 0 THEN 'rejected-and-restored' ELSE 'broken' END AS outcome FROM inventory i LEFT JOIN orders o ON o.sku = i.sku GROUP BY i.sku, i.stock;`,
    hints: [
      'ROLLBACK TO отменяет изменения после SAVEPOINT.',
      'RELEASE закрывает savepoint, затем COMMIT завершает внешнюю транзакцию.',
      'И stock, и orders проверяются независимо.'
    ]
  },
  'task-216': {
    title: 'Сделай replay безопасным через idempotency key',
    description: 'Обработай один request_id дважды. `INSERT OR IGNORE` в ledger должен пропустить replay, а side effect выполняется только когда предыдущая вставка изменила одну строку; итоговый баланс обязан увеличиться ровно один раз.',
    starter: `CREATE TEMP TABLE account_balances(account_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL);
CREATE TEMP TABLE processed_requests(request_id TEXT PRIMARY KEY, amount INTEGER NOT NULL);
INSERT INTO account_balances VALUES (1, 100);

INSERT OR IGNORE INTO processed_requests VALUES ('req-42', 25);
UPDATE account_balances SET balance = balance + 25 WHERE account_id = 1 AND ;
INSERT OR IGNORE INTO processed_requests VALUES ('req-42', 25);
UPDATE account_balances SET balance = balance + 25 WHERE account_id = 1 AND ;

SELECT (SELECT COUNT(*) FROM processed_requests) AS ledger_rows,
       balance,
       CASE WHEN balance = 125 THEN 'applied-once' ELSE 'duplicate-effect' END AS outcome
FROM account_balances
WHERE account_id = 1;`,
    solution: `CREATE TEMP TABLE account_balances(account_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL); CREATE TEMP TABLE processed_requests(request_id TEXT PRIMARY KEY, amount INTEGER NOT NULL); INSERT INTO account_balances VALUES (1, 100); INSERT OR IGNORE INTO processed_requests VALUES ('req-42', 25); UPDATE account_balances SET balance = balance + 25 WHERE account_id = 1 AND changes() = 1; INSERT OR IGNORE INTO processed_requests VALUES ('req-42', 25); UPDATE account_balances SET balance = balance + 25 WHERE account_id = 1 AND changes() = 1; SELECT (SELECT COUNT(*) FROM processed_requests) AS ledger_rows, balance, CASE WHEN balance = 125 THEN 'applied-once' ELSE 'duplicate-effect' END AS outcome FROM account_balances WHERE account_id = 1;`,
    hints: [
      'PRIMARY KEY request_id делает ledger уникальным.',
      'changes() после INSERT OR IGNORE отличает первое выполнение от replay.',
      'Ledger и баланс дают два независимых доказательства.'
    ]
  },
  'task-217': {
    title: 'Классифицируй retry по ошибке и идемпотентности',
    description: 'Для каждой неудачной попытки выбери retry, manual-review, do-not-retry или already-committed. Транзиентная ошибка разрешает автоматический retry только идемпотентной операции и только если commit ещё не подтверждён.',
    starter: `CREATE TEMP TABLE failure_attempts(attempt_id INTEGER PRIMARY KEY, error_code TEXT, idempotent INTEGER NOT NULL, already_committed INTEGER NOT NULL);
INSERT INTO failure_attempts VALUES
 (1,'SQLITE_BUSY',1,0), (2,'DEADLOCK',1,0),
 (3,'UNIQUE_CONSTRAINT',1,0), (4,'SQLITE_BUSY',0,0),
 (5,'TIMEOUT',1,1);

SELECT attempt_id, error_code, idempotent, already_committed,
       CASE
         WHEN  THEN 'already-committed'
         WHEN  THEN 'retry'
         WHEN  THEN 'manual-review'
         ELSE 'do-not-retry'
       END AS retry_decision
FROM failure_attempts
ORDER BY attempt_id;`,
    solution: `CREATE TEMP TABLE failure_attempts(attempt_id INTEGER PRIMARY KEY, error_code TEXT, idempotent INTEGER NOT NULL, already_committed INTEGER NOT NULL); INSERT INTO failure_attempts VALUES (1,'SQLITE_BUSY',1,0), (2,'DEADLOCK',1,0), (3,'UNIQUE_CONSTRAINT',1,0), (4,'SQLITE_BUSY',0,0), (5,'TIMEOUT',1,1); SELECT attempt_id, error_code, idempotent, already_committed, CASE WHEN already_committed = 1 THEN 'already-committed' WHEN error_code IN ('SQLITE_BUSY','DEADLOCK','TIMEOUT') AND idempotent = 1 THEN 'retry' WHEN error_code IN ('SQLITE_BUSY','DEADLOCK','TIMEOUT') THEN 'manual-review' ELSE 'do-not-retry' END AS retry_decision FROM failure_attempts ORDER BY attempt_id;`,
    hints: [
      'already_committed проверяется первым.',
      'BUSY, DEADLOCK и TIMEOUT считаются транзиентными.',
      'Неидемпотентный transient failure нельзя автоматически повторять.'
    ]
  },
  'task-218': {
    title: 'Выдай job lease только одному worker',
    description: 'Смоделируй гонку двух workers за один job через таблицу lease с PRIMARY KEY(job_id). Упорядоченная `INSERT OR IGNORE` должна оставить одного владельца, а каждая попытка получает outcome acquired или lost-race.',
    starter: `CREATE TEMP TABLE claim_attempts(job_id INTEGER NOT NULL, worker_id TEXT NOT NULL, attempt_at TEXT NOT NULL);
CREATE TEMP TABLE job_leases(job_id INTEGER PRIMARY KEY, worker_id TEXT NOT NULL, leased_at TEXT NOT NULL);
INSERT INTO claim_attempts VALUES
 (10,'worker-B','2026-08-04T10:00:00Z'),
 (10,'worker-A','2026-08-04T10:00:01Z'),
 (20,'worker-C','2026-08-04T10:00:00Z');

INSERT OR IGNORE INTO job_leases(job_id, worker_id, leased_at)
SELECT job_id, worker_id, attempt_at
FROM claim_attempts
ORDER BY ;

SELECT a.job_id, a.worker_id, l.worker_id AS lease_owner,
       CASE WHEN  THEN 'acquired' ELSE 'lost-race' END AS claim_outcome
FROM claim_attempts a
JOIN job_leases l ON
ORDER BY a.job_id, a.attempt_at, a.worker_id;`,
    solution: `CREATE TEMP TABLE claim_attempts(job_id INTEGER NOT NULL, worker_id TEXT NOT NULL, attempt_at TEXT NOT NULL); CREATE TEMP TABLE job_leases(job_id INTEGER PRIMARY KEY, worker_id TEXT NOT NULL, leased_at TEXT NOT NULL); INSERT INTO claim_attempts VALUES (10,'worker-B','2026-08-04T10:00:00Z'), (10,'worker-A','2026-08-04T10:00:01Z'), (20,'worker-C','2026-08-04T10:00:00Z'); INSERT OR IGNORE INTO job_leases(job_id, worker_id, leased_at) SELECT job_id, worker_id, attempt_at FROM claim_attempts ORDER BY attempt_at, worker_id; SELECT a.job_id, a.worker_id, l.worker_id AS lease_owner, CASE WHEN l.worker_id = a.worker_id THEN 'acquired' ELSE 'lost-race' END AS claim_outcome FROM claim_attempts a JOIN job_leases l ON l.job_id = a.job_id ORDER BY a.job_id, a.attempt_at, a.worker_id;`,
    hints: [
      'PRIMARY KEY(job_id) запрещает двух владельцев.',
      'Порядок attempt_at задаёт победителя модели.',
      'Сравни worker_id попытки с сохранённым lease_owner.'
    ]
  },
  'task-219': {
    title: 'Докажи conservation invariant перевода',
    description: 'Переведи 30 единиц между двумя счетами внутри одной транзакции и запиши transfer ledger. Итоговый отчёт должен доказать неизменность общей суммы, корректные остатки обоих счетов и ровно одну запись операции.',
    starter: `-- Напиши решение с нуля:
-- создай balances A=100 и B=40, сохрани total_before;
-- внутри BEGIN/COMMIT создай ledger tx-1, спиши 30 с A и начисли B;
-- верни total_before, total_after, conservation_gap, оба баланса и ledger_rows.`,
    solution: `CREATE TEMP TABLE account_balances(account_id TEXT PRIMARY KEY, balance INTEGER NOT NULL); CREATE TEMP TABLE transfer_ledger(transfer_id TEXT PRIMARY KEY, from_account TEXT NOT NULL, to_account TEXT NOT NULL, amount INTEGER NOT NULL); INSERT INTO account_balances VALUES ('A',100),('B',40); CREATE TEMP TABLE balance_before AS SELECT SUM(balance) AS total_balance FROM account_balances; BEGIN; INSERT INTO transfer_ledger VALUES ('tx-1','A','B',30); UPDATE account_balances SET balance = balance - 30 WHERE account_id = 'A'; UPDATE account_balances SET balance = balance + 30 WHERE account_id = 'B'; COMMIT; SELECT b.total_balance AS total_before, SUM(a.balance) AS total_after, SUM(a.balance) - b.total_balance AS conservation_gap, MAX(CASE WHEN a.account_id = 'A' THEN a.balance END) AS account_a, MAX(CASE WHEN a.account_id = 'B' THEN a.balance END) AS account_b, (SELECT COUNT(*) FROM transfer_ledger) AS ledger_rows FROM account_balances a CROSS JOIN balance_before b GROUP BY b.total_balance;`,
    hints: [
      'Total_before фиксируется до транзакции.',
      'Debit, credit и ledger входят в одну boundary.',
      'Conservation gap должен быть 0.'
    ]
  },
  'task-220': {
    title: 'Сверь outcomes конкурентных попыток',
    description: 'Классифицируй попытки в строгом порядке: committed, optimistic-conflict, retryable, manual-review или rejected. Затем посчитай категории и докажи нулевой reconciliation_gap, чтобы ни одна попытка не исчезла между ветками.',
    starter: `CREATE TEMP TABLE concurrency_attempts(
 attempt_id INTEGER PRIMARY KEY, affected_rows INTEGER NOT NULL,
 expected_version INTEGER, actual_version INTEGER,
 error_code TEXT, idempotent INTEGER NOT NULL
);
INSERT INTO concurrency_attempts VALUES
 (1,1,3,3,NULL,1), (2,0,3,4,NULL,1),
 (3,0,NULL,NULL,'SQLITE_BUSY',1), (4,0,NULL,NULL,'SQLITE_BUSY',0),
 (5,0,NULL,NULL,'UNIQUE_CONSTRAINT',1), (6,1,7,7,NULL,1);

WITH classified AS (
  SELECT attempt_id,
         CASE
           WHEN  THEN 'committed'
           WHEN  THEN 'optimistic-conflict'
           WHEN  THEN 'retryable'
           WHEN  THEN 'manual-review'
           ELSE 'rejected'
         END AS outcome
  FROM concurrency_attempts
), report AS (
  SELECT COUNT(*) AS total_attempts,
         SUM(outcome = 'committed') AS committed_attempts,
         SUM(outcome = 'optimistic-conflict') AS conflict_attempts,
         SUM(outcome = 'retryable') AS retryable_attempts,
         SUM(outcome = 'manual-review') AS manual_review_attempts,
         SUM(outcome = 'rejected') AS rejected_attempts
  FROM classified
)
SELECT *, total_attempts - committed_attempts - conflict_attempts - retryable_attempts - manual_review_attempts - rejected_attempts AS reconciliation_gap
FROM report;`,
    solution: `CREATE TEMP TABLE concurrency_attempts(attempt_id INTEGER PRIMARY KEY, affected_rows INTEGER NOT NULL, expected_version INTEGER, actual_version INTEGER, error_code TEXT, idempotent INTEGER NOT NULL); INSERT INTO concurrency_attempts VALUES (1,1,3,3,NULL,1), (2,0,3,4,NULL,1), (3,0,NULL,NULL,'SQLITE_BUSY',1), (4,0,NULL,NULL,'SQLITE_BUSY',0), (5,0,NULL,NULL,'UNIQUE_CONSTRAINT',1), (6,1,7,7,NULL,1); WITH classified AS (SELECT attempt_id, CASE WHEN affected_rows = 1 THEN 'committed' WHEN expected_version IS NOT NULL AND actual_version <> expected_version THEN 'optimistic-conflict' WHEN error_code IN ('SQLITE_BUSY','DEADLOCK','TIMEOUT') AND idempotent = 1 THEN 'retryable' WHEN error_code IN ('SQLITE_BUSY','DEADLOCK','TIMEOUT') THEN 'manual-review' ELSE 'rejected' END AS outcome FROM concurrency_attempts), report AS (SELECT COUNT(*) AS total_attempts, SUM(outcome = 'committed') AS committed_attempts, SUM(outcome = 'optimistic-conflict') AS conflict_attempts, SUM(outcome = 'retryable') AS retryable_attempts, SUM(outcome = 'manual-review') AS manual_review_attempts, SUM(outcome = 'rejected') AS rejected_attempts FROM classified) SELECT *, total_attempts - committed_attempts - conflict_attempts - retryable_attempts - manual_review_attempts - rejected_attempts AS reconciliation_gap FROM report;`,
    hints: [
      'Успешный affected_rows проверяется первым.',
      'Version mismatch отличает optimistic conflict от технической ошибки.',
      'Сумма пяти outcomes обязана совпасть с total_attempts.'
    ]
  }
};

export const concurrencyAuthoredTaskEvidence: Readonly<Record<string, readonly ConcurrencyEvidenceTag[]>> = {
  'task-211': ['invariant-definition', 'read-write-set'],
  'task-212': ['optimistic-versioning', 'affected-row-proof'],
  'task-213': ['optimistic-versioning', 'stale-write-rejection', 'affected-row-proof'],
  'task-214': ['lost-update', 'atomic-update'],
  'task-215': ['savepoint', 'partial-rollback'],
  'task-216': ['idempotency-key', 'replay-safety'],
  'task-217': ['retry-classification', 'idempotent-retry', 'fail-closed-retry'],
  'task-218': ['single-lease', 'claim-race'],
  'task-219': ['conservation-invariant', 'transaction-ledger'],
  'task-220': ['conflict-diagnosis', 'outcome-reconciliation', 'fail-closed-retry']
};

export function advancedConcurrencyTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applyAdvancedConcurrencyTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = advancedConcurrencyTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}
