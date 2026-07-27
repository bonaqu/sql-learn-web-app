export type SqlDialect = 'sqlite' | 'postgresql' | 'mysql';
export type DialectExecutionMode = 'local-sqlite' | 'remote-sandbox' | 'deterministic-simulation';
export type DialectLabKind = 'query' | 'schema' | 'plan' | 'transaction';
export type DialectCapability =
  | 'null-ordering'
  | 'date-time'
  | 'json'
  | 'upsert'
  | 'generated-columns'
  | 'recursive-cte'
  | 'window-frame'
  | 'pagination'
  | 'query-plan'
  | 'transaction-isolation'
  | 'locking';

export type DialectStatementPolicy = {
  allow: readonly string[];
  deny: readonly string[];
  maximumStatements: number;
  timeoutMs: number;
  maximumRows: number;
  maximumCellBytes: number;
  maximumResultBytes: number;
};

export type DialectDatasetContract = {
  id: string;
  version: number;
  seedKey: string;
  tables: readonly string[];
  containsPersonalData: false;
};

export type DialectExpectedBehavior = {
  dialect: SqlDialect;
  executionMode: DialectExecutionMode;
  expectedSummary: string;
  semanticInvariants: readonly string[];
  unsupportedOfflineReason?: string;
};

export type DialectLabManifest = {
  version: 1;
  id: string;
  title: string;
  kind: DialectLabKind;
  capability: DialectCapability;
  objective: string;
  productionFailureMode: string;
  dataset: DialectDatasetContract;
  statementPolicy: DialectStatementPolicy;
  behaviors: readonly DialectExpectedBehavior[];
  portabilityChallenge: {
    prompt: string;
    requiredDialects: readonly SqlDialect[];
    equivalenceInvariants: readonly string[];
  };
  evidence: {
    requiresExecution: true;
    requiresIndependentAttempt: true;
    minimumPassingDialects: number;
    retainedCheckDays: readonly number[];
  };
};

export const DIALECT_LAB_MANIFEST_VERSION = 1 as const;

const commonDeny = ['ATTACH', 'DETACH', 'PRAGMA', 'LOAD_EXTENSION', 'COPY', 'INTO OUTFILE', 'INTO DUMPFILE', 'SLEEP', 'BENCHMARK'];
const readOnlyPolicy: DialectStatementPolicy = {
  allow: ['SELECT', 'WITH', 'EXPLAIN'],
  deny: commonDeny,
  maximumStatements: 2,
  timeoutMs: 2_500,
  maximumRows: 200,
  maximumCellBytes: 16_000,
  maximumResultBytes: 256_000
};
const schemaPolicy: DialectStatementPolicy = {
  allow: ['CREATE TABLE', 'CREATE INDEX', 'INSERT', 'SELECT', 'EXPLAIN'],
  deny: [...commonDeny, 'DROP DATABASE', 'CREATE USER', 'ALTER USER', 'GRANT', 'REVOKE', 'LOAD DATA'],
  maximumStatements: 8,
  timeoutMs: 3_500,
  maximumRows: 200,
  maximumCellBytes: 16_000,
  maximumResultBytes: 256_000
};
const transactionPolicy: DialectStatementPolicy = {
  allow: ['BEGIN', 'START TRANSACTION', 'SELECT', 'UPDATE', 'COMMIT', 'ROLLBACK', 'SET TRANSACTION'],
  deny: [...commonDeny, 'LOCK TABLES', 'UNLOCK TABLES', 'KILL', 'VACUUM', 'ANALYZE', 'CREATE USER', 'GRANT', 'REVOKE'],
  maximumStatements: 10,
  timeoutMs: 4_000,
  maximumRows: 100,
  maximumCellBytes: 8_000,
  maximumResultBytes: 128_000
};

const supportDataset: DialectDatasetContract = {
  id: 'support-operations-v1',
  version: 1,
  seedKey: 'support-operations',
  tables: ['tickets', 'ticket_events', 'engineers', 'customers', 'service_tree'],
  containsPersonalData: false
};
const labDataset: DialectDatasetContract = {
  id: 'dialect-portability-v1',
  version: 1,
  seedKey: 'dialect-portability',
  tables: ['tickets', 'service_tree', 'window_samples', 'ticket_metrics', 'ticket_versions', 'work_queue'],
  containsPersonalData: false
};

const dialects: readonly SqlDialect[] = ['sqlite', 'postgresql', 'mysql'];
const evidence = { requiresExecution: true, requiresIndependentAttempt: true, minimumPassingDialects: 3, retainedCheckDays: [7, 30] } as const;

function engineBehaviors(input: {
  sqlite: string;
  postgresql: string;
  mysql: string;
  invariants: readonly string[];
  transaction?: boolean;
}): readonly DialectExpectedBehavior[] {
  return [
    {
      dialect: 'sqlite',
      executionMode: input.transaction ? 'deterministic-simulation' : 'local-sqlite',
      expectedSummary: input.sqlite,
      semanticInvariants: input.invariants,
      ...(input.transaction ? { unsupportedOfflineReason: 'SQLite serializes writers and does not expose the same row-locking contract as server engines.' } : {})
    },
    { dialect: 'postgresql', executionMode: 'remote-sandbox', expectedSummary: input.postgresql, semanticInvariants: input.invariants },
    { dialect: 'mysql', executionMode: 'remote-sandbox', expectedSummary: input.mysql, semanticInvariants: input.invariants }
  ];
}

function manifest(input: Omit<DialectLabManifest, 'version' | 'evidence'>): DialectLabManifest {
  return { version: 1, ...input, evidence };
}

export const dialectLabManifests: readonly DialectLabManifest[] = [
  manifest({
    id: 'dialect-null-ordering', title: 'NULL ordering across engines', kind: 'query', capability: 'null-ordering',
    objective: 'Сделать порядок NULL явным и переносимым вместо зависимости от default sort semantics конкретного движка.',
    productionFailureMode: 'Одинаковый отчёт меняет порядок строк после миграции между SQLite, PostgreSQL и MySQL, ломая pagination, top-N и повторяемость UI.',
    dataset: supportDataset, statementPolicy: readOnlyPolicy,
    behaviors: engineBehaviors({
      sqlite: 'ASC помещает NULL раньше non-NULL без явного bucket key.',
      postgresql: 'ASC по умолчанию помещает NULL после non-NULL; доступны NULLS FIRST/LAST.',
      mysql: 'ASC рассматривает NULL как минимальное значение; NULLS FIRST/LAST синтаксически недоступны.',
      invariants: ['Все строки сохранены', 'NULL bucket определяется явно', 'Tie-breaker уникален']
    }),
    portabilityChallenge: { prompt: 'Отсортируй закрытые обращения раньше неизвестных дат и добавь уникальный tie-breaker.', requiredDialects: dialects, equivalenceInvariants: ['Одинаковые ticket_id', 'Одинаковый полный порядок', 'NULL не теряются'] }
  }),
  manifest({
    id: 'dialect-date-time-boundaries', title: 'Date/time boundary semantics', kind: 'query', capability: 'date-time',
    objective: 'Считать календарные границы через явный UTC contract и half-open ranges.',
    productionFailureMode: 'SLA-отчёты расходятся на полуночи и DST, а BETWEEN дублирует записи на соседних периодах и ломает агрегаты.',
    dataset: supportDataset, statementPolicy: readOnlyPolicy,
    behaviors: engineBehaviors({
      sqlite: 'datetime functions работают поверх текстовых/числовых представлений времени.',
      postgresql: 'timestamptz и interval дают типизированную timezone-aware семантику.',
      mysql: 'DATE_SUB/TIMESTAMP зависят от явно зафиксированного session time_zone.',
      invariants: ['Начало включительно', 'Конец исключительно', 'UTC assumption указан']
    }),
    portabilityChallenge: { prompt: 'Верни обращения из предыдущих полных UTC-суток без двойного учёта полуночи.', requiredDialects: dialects, equivalenceInvariants: ['Одинаковый набор ticket_id', 'Начало включительно', 'Конец исключительно'] }
  }),
  manifest({
    id: 'dialect-json-extraction', title: 'JSON extraction and missing values', kind: 'query', capability: 'json',
    objective: 'Различать missing path, JSON null и SQL NULL и строить переносимый result contract.',
    productionFailureMode: 'Фильтры silently теряют строки или смешивают отсутствующий ключ с явным JSON null, поэтому аналитика каналов становится недостоверной.',
    dataset: supportDataset, statementPolicy: readOnlyPolicy,
    behaviors: engineBehaviors({
      sqlite: 'json_extract возвращает SQL scalar; существование path проверяется json_type.',
      postgresql: 'Операторы ->/->> и ? разделяют JSON value, text и existence.',
      mysql: 'JSON_EXTRACT, JSON_UNQUOTE и JSON_CONTAINS_PATH образуют явный contract.',
      invariants: ['Missing отделён от JSON null', 'Text extraction типизирован', 'Все события сохранены']
    }),
    portabilityChallenge: { prompt: 'Выведи channel и отдельный channel_missing, сохранив JSON null и missing path.', requiredDialects: dialects, equivalenceInvariants: ['Одинаковое число строк', 'channel_missing совпадает', 'Text values совпадают'] }
  }),
  manifest({
    id: 'dialect-upsert-idempotency', title: 'UPSERT and idempotent writes', kind: 'schema', capability: 'upsert',
    objective: 'Связать dialect-specific UPSERT syntax с единым idempotency и conflict-target contract.',
    productionFailureMode: 'Повторная доставка создаёт дубли или обновляет не ту строку из-за неверного unique target, а REPLACE уничтожает immutable identity.',
    dataset: supportDataset, statementPolicy: schemaPolicy,
    behaviors: engineBehaviors({
      sqlite: 'ON CONFLICT(target) DO UPDATE требует уникального conflict target.',
      postgresql: 'ON CONFLICT поддерживает явный target и EXCLUDED values.',
      mysql: 'ON DUPLICATE KEY UPDATE реагирует на любой нарушенный unique key.',
      invariants: ['Одна business row', 'Mutable payload обновлён', 'Immutable first_seen_at сохранён']
    }),
    portabilityChallenge: { prompt: 'Дважды доставь event по external_event_id и докажи отсутствие дублей.', requiredDialects: dialects, equivalenceInvariants: ['Одна business row', 'Payload обновлён', 'Immutable timestamp сохранён'] }
  }),
  manifest({
    id: 'dialect-generated-columns', title: 'Generated column semantics', kind: 'schema', capability: 'generated-columns',
    objective: 'Создать вычисляемую колонку как schema invariant, не дублируя формулу в каждом запросе и не позволяя записывать результат вручную.',
    productionFailureMode: 'Дублированная формула расходится между сервисами, а миграция VIRTUAL/STORED меняет стоимость чтения, записи и доступность ALTER TABLE.',
    dataset: labDataset, statementPolicy: schemaPolicy,
    behaviors: engineBehaviors({
      sqlite: 'Поддерживает VIRTUAL и STORED; STORED нельзя добавить обычным ALTER TABLE ADD COLUMN.',
      postgresql: 'GENERATED ALWAYS AS поддерживает вычисляемый schema invariant; STORED совместим с поддерживаемыми версиями.',
      mysql: 'Поддерживает VIRTUAL/STORED generated columns и индексацию подходящих выражений.',
      invariants: ['Значение вычисляется движком', 'Прямой INSERT результата запрещён contract-ом', 'Формула одинакова']
    }),
    portabilityChallenge: { prompt: 'Создай active_minutes = opened_minutes - paused_minutes и проверь две строки.', requiredDialects: dialects, equivalenceInvariants: ['Одинаковые active_minutes', 'Formula is deterministic', 'Результат не записывается вручную'] }
  }),
  manifest({
    id: 'dialect-recursive-service-tree', title: 'Recursive service tree', kind: 'query', capability: 'recursive-cte',
    objective: 'Обойти иерархию сервисов через WITH RECURSIVE с явной глубиной, path и стабильным порядком.',
    productionFailureMode: 'Без cycle/depth contract рекурсия зависает или возвращает узлы в непредсказуемом порядке, ломая навигацию и пакетные операции.',
    dataset: labDataset, statementPolicy: readOnlyPolicy,
    behaviors: engineBehaviors({
      sqlite: 'Recursive CTE использует anchor + recursive term и внешний ORDER BY path.',
      postgresql: 'WITH RECURSIVE поддерживает path/search semantics и строгую типизацию recursive term.',
      mysql: 'WITH RECURSIVE требует совместимых типов, а depth ограничивается explicit predicate.',
      invariants: ['Anchor включён один раз', 'Depth ограничен', 'Path задаёт стабильный traversal']
    }),
    portabilityChallenge: { prompt: 'Верни весь subtree root=1 с depth и stable path.', requiredDialects: dialects, equivalenceInvariants: ['Одинаковые service_id', 'Одинаковый depth', 'Одинаковый depth-first порядок'] }
  }),
  manifest({
    id: 'dialect-window-frame', title: 'ROWS versus RANGE window frames', kind: 'query', capability: 'window-frame',
    objective: 'Зафиксировать физический ROWS frame и уникальный ORDER BY, чтобы peer rows не расширяли окно неожиданно.',
    productionFailureMode: 'Default RANGE включает все peer rows с одинаковым sort key и меняет rolling metric после добавления tie, хотя число строк не изменилось.',
    dataset: labDataset, statementPolicy: readOnlyPolicy,
    behaviors: engineBehaviors({
      sqlite: 'Aggregate window functions поддерживают явный ROWS frame.',
      postgresql: 'Default RANGE включает peers; ROWS считает физические позиции.',
      mysql: 'Default frame зависит от ORDER BY; ROWS фиксирует позиционное окно.',
      invariants: ['Frame указан явно', 'ORDER BY уникален', 'Partition contract одинаков']
    }),
    portabilityChallenge: { prompt: 'Посчитай rolling sum текущей и предыдущей строки внутри команды.', requiredDialects: dialects, equivalenceInvariants: ['Одинаковый rolling sum', 'Peer rows не расширяют frame', 'Порядок deterministic'] }
  }),
  manifest({
    id: 'dialect-keyset-pagination', title: 'Keyset pagination contract', kind: 'query', capability: 'pagination',
    objective: 'Перейти от OFFSET к seek predicate по полному уникальному sort key и не пропускать строки при concurrent inserts.',
    productionFailureMode: 'OFFSET становится медленным на больших страницах и создаёт дубли/пропуски при изменениях между запросами пользователя.',
    dataset: labDataset, statementPolicy: readOnlyPolicy,
    behaviors: engineBehaviors({
      sqlite: 'Row-value comparison позволяет seek по composite cursor.',
      postgresql: 'Row constructors сравниваются лексикографически по composite index order.',
      mysql: 'Row operands поддерживают relational comparisons, но index prefix нужно проверять планом.',
      invariants: ['Cursor содержит полный key', 'ORDER BY совпадает с predicate', 'OFFSET отсутствует']
    }),
    portabilityChallenge: { prompt: 'Верни следующие четыре ticket после composite cursor(created_at,ticket_id).', requiredDialects: dialects, equivalenceInvariants: ['Одинаковые четыре ticket_id', 'OFFSET отсутствует', 'Cursor и ORDER BY совпадают'] }
  }),
  manifest({
    id: 'dialect-plan-vocabulary', title: 'Normalized query-plan vocabulary', kind: 'plan', capability: 'query-plan',
    objective: 'Сравнивать не сырой EXPLAIN text, а переносимые признаки access path, index и sort.',
    productionFailureMode: 'Learner запоминает текст одного EXPLAIN и не распознаёт full scan, bad index или external sort после смены движка.',
    dataset: supportDataset, statementPolicy: schemaPolicy,
    behaviors: engineBehaviors({
      sqlite: 'EXPLAIN QUERY PLAN сообщает SEARCH/SCAN и index name.',
      postgresql: 'EXPLAIN FORMAT JSON даёт структурированный plan tree.',
      mysql: 'EXPLAIN FORMAT=JSON даёт access_type, key и filesort evidence.',
      invariants: ['Index распознан', 'Access path нормализован', 'Sort evidence не зависит от текста']
    }),
    portabilityChallenge: { prompt: 'Докажи использование service index без выполнения learner query.', requiredDialects: dialects, equivalenceInvariants: ['Index name совпадает', 'Access path индексный', 'ANALYZE не запускается'] }
  }),
  manifest({
    id: 'dialect-isolation-lost-update', title: 'Lost update under two sessions', kind: 'transaction', capability: 'transaction-isolation',
    objective: 'Воспроизвести конфликт двух настоящих sessions и обнаружить его optimistic version predicate вместо silent overwrite.',
    productionFailureMode: 'Два инженера меняют приоритет из одной версии, последний COMMIT молча стирает изменение первого и audit trail становится ложным.',
    dataset: labDataset, statementPolicy: transactionPolicy,
    behaviors: engineBehaviors({
      sqlite: 'Одновременные writers сериализуются; browser scenario моделирует optimistic predicate детерминированно.',
      postgresql: 'Две READ COMMITTED sessions дают второй affected-row count 0 после commit первой.',
      mysql: 'Две InnoDB sessions подтверждают conflict через ROW_COUNT после ожидания row lock.',
      invariants: ['Обе sessions читают version 7', 'A коммитит version 8', 'B получает zero affected rows'], transaction: true
    }),
    portabilityChallenge: { prompt: 'Проведи два concurrent update и верни A=updated, B=conflict.', requiredDialects: dialects, equivalenceInvariants: ['Конфликт наблюдаем', 'Silent overwrite отсутствует', 'Retry начинается с fresh state'] }
  }),
  manifest({
    id: 'dialect-locking-work-queue', title: 'Concurrent work queue locking', kind: 'transaction', capability: 'locking',
    objective: 'Распределить разные ready jobs двум consumers через row locking и SKIP LOCKED там, где движок это поддерживает.',
    productionFailureMode: 'Два worker-а забирают одну задачу или блокируют очередь целиком; retries создают duplicate side effects и растят latency.',
    dataset: labDataset, statementPolicy: transactionPolicy,
    behaviors: engineBehaviors({
      sqlite: 'Один writer сериализует изменения; portable fallback использует atomic claim/update и busy retry.',
      postgresql: 'FOR UPDATE SKIP LOCKED пропускает уже удерживаемую строку queue.',
      mysql: 'InnoDB FOR UPDATE SKIP LOCKED возвращает следующую unlocked row внутри transaction.',
      invariants: ['A получает job 1', 'B получает job 2 до commit A', 'Один job не выдан дважды'], transaction: true
    }),
    portabilityChallenge: { prompt: 'Запусти два consumers и докажи, что они claim разные ready jobs.', requiredDialects: dialects, equivalenceInvariants: ['Разные job_id', 'Duplicate claim отсутствует', 'Lock released at transaction end'] }
  })
] as const;

const manifestById = new Map(dialectLabManifests.map(item => [item.id, item]));

export function dialectLabManifest(id: string) {
  return manifestById.get(id) || null;
}

export function dialectLabsForCapability(capability: DialectCapability) {
  return dialectLabManifests.filter(item => item.capability === capability);
}
