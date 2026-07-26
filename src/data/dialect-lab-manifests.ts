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

const readOnlyPolicy: DialectStatementPolicy = {
  allow: ['SELECT', 'WITH', 'EXPLAIN'],
  deny: ['ATTACH', 'DETACH', 'PRAGMA', 'LOAD_EXTENSION', 'COPY', 'INTO OUTFILE', 'SLEEP', 'BENCHMARK'],
  maximumStatements: 2,
  timeoutMs: 2_500,
  maximumRows: 200,
  maximumCellBytes: 16_000,
  maximumResultBytes: 256_000
};

const schemaPolicy: DialectStatementPolicy = {
  allow: ['CREATE TABLE', 'CREATE INDEX', 'INSERT', 'SELECT', 'EXPLAIN'],
  deny: ['DROP DATABASE', 'CREATE USER', 'ALTER USER', 'GRANT', 'REVOKE', 'COPY', 'LOAD DATA', 'ATTACH', 'LOAD_EXTENSION'],
  maximumStatements: 8,
  timeoutMs: 3_500,
  maximumRows: 200,
  maximumCellBytes: 16_000,
  maximumResultBytes: 256_000
};

const transactionPolicy: DialectStatementPolicy = {
  allow: ['BEGIN', 'START TRANSACTION', 'SELECT', 'UPDATE', 'COMMIT', 'ROLLBACK', 'SET TRANSACTION'],
  deny: ['LOCK TABLES', 'UNLOCK TABLES', 'KILL', 'VACUUM', 'ANALYZE', 'CREATE USER', 'GRANT', 'REVOKE'],
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

export const dialectLabManifests: readonly DialectLabManifest[] = [
  {
    version: 1,
    id: 'dialect-null-ordering',
    title: 'NULL ordering across engines',
    kind: 'query',
    capability: 'null-ordering',
    objective: 'Сделать порядок NULL явным и переносимым вместо зависимости от default sort semantics конкретного движка.',
    productionFailureMode: 'Одинаковый отчёт меняет порядок строк после миграции между SQLite, PostgreSQL и MySQL, ломая pagination и top-N.',
    dataset: supportDataset,
    statementPolicy: readOnlyPolicy,
    behaviors: [
      {
        dialect: 'sqlite',
        executionMode: 'local-sqlite',
        expectedSummary: 'ASC помещает NULL раньше non-NULL, если порядок не нормализован выражением.',
        semanticInvariants: ['Все строки сохранены', 'NULL bucket определяется явно', 'Tie-breaker уникален']
      },
      {
        dialect: 'postgresql',
        executionMode: 'remote-sandbox',
        expectedSummary: 'ASC по умолчанию помещает NULL после non-NULL; доступны NULLS FIRST и NULLS LAST.',
        semanticInvariants: ['Использован явный NULLS FIRST/LAST либо portable CASE key', 'Tie-breaker уникален']
      },
      {
        dialect: 'mysql',
        executionMode: 'remote-sandbox',
        expectedSummary: 'ASC рассматривает NULL как минимальное значение; NULLS FIRST/LAST синтаксически недоступны.',
        semanticInvariants: ['NULL bucket задан boolean/CASE expression', 'Tie-breaker уникален']
      }
    ],
    portabilityChallenge: {
      prompt: 'Напиши один semantic contract сортировки: сначала активные SLA, затем неизвестные, внутри — по deadline и ticket_id.',
      requiredDialects: ['sqlite', 'postgresql', 'mysql'],
      equivalenceInvariants: ['Одинаковые ticket_id во всех dialect results', 'Одинаковый полный порядок', 'NULL не теряются']
    },
    evidence: {
      requiresExecution: true,
      requiresIndependentAttempt: true,
      minimumPassingDialects: 3,
      retainedCheckDays: [7, 30]
    }
  },
  {
    version: 1,
    id: 'dialect-date-time-boundaries',
    title: 'Date/time boundary semantics',
    kind: 'query',
    capability: 'date-time',
    objective: 'Считать интервалы и календарные границы через явный timestamp contract, timezone и half-open ranges.',
    productionFailureMode: 'Отчёты по SLA расходятся на границах суток, DST и при смешивании timestamp/date функций разных движков.',
    dataset: supportDataset,
    statementPolicy: readOnlyPolicy,
    behaviors: [
      {
        dialect: 'sqlite',
        executionMode: 'local-sqlite',
        expectedSummary: 'Дата и время вычисляются функциями datetime/julianday без отдельного timezone-aware type.',
        semanticInvariants: ['Использован half-open interval', 'Timezone assumption указан явно', 'Граница окончания не дублируется']
      },
      {
        dialect: 'postgresql',
        executionMode: 'remote-sandbox',
        expectedSummary: 'interval, date_trunc и timestamptz имеют типизированную timezone-aware семантику.',
        semanticInvariants: ['timestamptz используется для абсолютного времени', 'Граница периода half-open']
      },
      {
        dialect: 'mysql',
        executionMode: 'remote-sandbox',
        expectedSummary: 'TIMESTAMPDIFF/DATE_ADD и session time_zone требуют явного operational contract.',
        semanticInvariants: ['Session timezone зафиксирован', 'Граница периода half-open']
      }
    ],
    portabilityChallenge: {
      prompt: 'Посчитай обращения, закрытые в предыдущие полные UTC-сутки, без двойного учёта полуночи.',
      requiredDialects: ['sqlite', 'postgresql', 'mysql'],
      equivalenceInvariants: ['Одинаковый набор ticket_id', 'Начало включительно', 'Конец исключительно']
    },
    evidence: {
      requiresExecution: true,
      requiresIndependentAttempt: true,
      minimumPassingDialects: 3,
      retainedCheckDays: [7, 30]
    }
  },
  {
    version: 1,
    id: 'dialect-json-extraction',
    title: 'JSON extraction and missing values',
    kind: 'query',
    capability: 'json',
    objective: 'Различать missing path, JSON null и SQL NULL и строить переносимый result contract.',
    productionFailureMode: 'Фильтры по JSON silently теряют строки или смешивают отсутствующий ключ с явным null.',
    dataset: supportDataset,
    statementPolicy: readOnlyPolicy,
    behaviors: [
      {
        dialect: 'sqlite',
        executionMode: 'local-sqlite',
        expectedSummary: 'json_extract возвращает SQL scalar для scalar paths; тип проверяется json_type.',
        semanticInvariants: ['Missing и JSON null различимы', 'Invalid JSON обрабатывается']
      },
      {
        dialect: 'postgresql',
        executionMode: 'remote-sandbox',
        expectedSummary: 'Операторы -> и ->> различают JSON value и text extraction; path existence проверяется отдельно.',
        semanticInvariants: ['Выбор ->/->> соответствует result type', 'Missing path не смешан с JSON null']
      },
      {
        dialect: 'mysql',
        executionMode: 'remote-sandbox',
        expectedSummary: 'JSON_EXTRACT возвращает JSON value; JSON_UNQUOTE переводит scalar в text.',
        semanticInvariants: ['JSON null проверяется отдельно', 'Missing path не теряется']
      }
    ],
    portabilityChallenge: {
      prompt: 'Выведи channel как text и отдельный флаг channel_missing, сохранив строки с JSON null и отсутствующим ключом.',
      requiredDialects: ['sqlite', 'postgresql', 'mysql'],
      equivalenceInvariants: ['Одинаковое число строк', 'channel_missing совпадает', 'Text values совпадают']
    },
    evidence: {
      requiresExecution: true,
      requiresIndependentAttempt: true,
      minimumPassingDialects: 3,
      retainedCheckDays: [14, 45]
    }
  },
  {
    version: 1,
    id: 'dialect-upsert-idempotency',
    title: 'UPSERT and idempotent writes',
    kind: 'schema',
    capability: 'upsert',
    objective: 'Связать dialect-specific UPSERT syntax с единым idempotency и conflict-target contract.',
    productionFailureMode: 'Повторная доставка события создаёт дубли или обновляет не ту строку из-за неверного unique conflict target.',
    dataset: supportDataset,
    statementPolicy: schemaPolicy,
    behaviors: [
      {
        dialect: 'sqlite',
        executionMode: 'local-sqlite',
        expectedSummary: 'INSERT ... ON CONFLICT(target) DO UPDATE требует уникального conflict target.',
        semanticInvariants: ['Повторная доставка не создаёт строку', 'Обновляется только разрешённый набор столбцов']
      },
      {
        dialect: 'postgresql',
        executionMode: 'remote-sandbox',
        expectedSummary: 'ON CONFLICT поддерживает явный target и EXCLUDED values.',
        semanticInvariants: ['Conflict target соответствует business key', 'Immutable fields не перезаписываются']
      },
      {
        dialect: 'mysql',
        executionMode: 'remote-sandbox',
        expectedSummary: 'ON DUPLICATE KEY UPDATE реагирует на любой нарушенный unique key, поэтому schema contract критичен.',
        semanticInvariants: ['Все unique keys проверены на unintended conflicts', 'Повтор идемпотентен']
      }
    ],
    portabilityChallenge: {
      prompt: 'Сделай повторно исполняемую запись ticket event по external_event_id и докажи отсутствие дублей после двух запусков.',
      requiredDialects: ['sqlite', 'postgresql', 'mysql'],
      equivalenceInvariants: ['Одна business row после повторов', 'Payload обновлён предсказуемо', 'Immutable identity сохранена']
    },
    evidence: {
      requiresExecution: true,
      requiresIndependentAttempt: true,
      minimumPassingDialects: 3,
      retainedCheckDays: [14, 45]
    }
  },
  {
    version: 1,
    id: 'dialect-plan-vocabulary',
    title: 'Normalized query-plan vocabulary',
    kind: 'plan',
    capability: 'query-plan',
    objective: 'Сравнивать не текст EXPLAIN, а переносимые признаки: scan/search, access path, join strategy, sort и row estimate.',
    productionFailureMode: 'Learner запоминает строку SQLite EXPLAIN и не умеет распознать full scan, bad join order или external sort в другом движке.',
    dataset: supportDataset,
    statementPolicy: schemaPolicy,
    behaviors: [
      {
        dialect: 'sqlite',
        executionMode: 'local-sqlite',
        expectedSummary: 'EXPLAIN QUERY PLAN сообщает SCAN/SEARCH и используемый index.',
        semanticInvariants: ['Access path классифицирован', 'Sort operation замечена', 'Filter columns связаны с index prefix']
      },
      {
        dialect: 'postgresql',
        executionMode: 'remote-sandbox',
        expectedSummary: 'EXPLAIN JSON содержит node types, costs и estimated rows.',
        semanticInvariants: ['Seq/Index Scan нормализован', 'Join strategy нормализована', 'Estimate не выдаётся за actual']
      },
      {
        dialect: 'mysql',
        executionMode: 'remote-sandbox',
        expectedSummary: 'EXPLAIN FORMAT=JSON описывает access_type, key, rows и nested loop.',
        semanticInvariants: ['ALL/range/ref нормализованы', 'Filesort замечен', 'Key choice объяснён']
      }
    ],
    portabilityChallenge: {
      prompt: 'Сравни планы одного SLA query и выдай общий диагноз без копирования dialect-specific text.',
      requiredDialects: ['sqlite', 'postgresql', 'mysql'],
      equivalenceInvariants: ['Есть access-path verdict', 'Есть sort verdict', 'Есть join/filter rationale']
    },
    evidence: {
      requiresExecution: true,
      requiresIndependentAttempt: true,
      minimumPassingDialects: 3,
      retainedCheckDays: [14, 60]
    }
  },
  {
    version: 1,
    id: 'dialect-isolation-lost-update',
    title: 'Lost update under concurrent sessions',
    kind: 'transaction',
    capability: 'transaction-isolation',
    objective: 'Увидеть interleaving двух сессий и выбрать optimistic/pessimistic protection вместо надежды на transaction keyword.',
    productionFailureMode: 'Два инженера одновременно меняют ticket state, и последняя запись silently перетирает первую.',
    dataset: supportDataset,
    statementPolicy: transactionPolicy,
    behaviors: [
      {
        dialect: 'sqlite',
        executionMode: 'deterministic-simulation',
        expectedSummary: 'Single-writer locking моделируется отдельно; BEGIN mode влияет на момент получения write lock.',
        semanticInvariants: ['Interleaving показан пошагово', 'Write conflict имеет deterministic outcome'],
        unsupportedOfflineReason: 'Browser SQLite не даёт надёжно воспроизвести две независимые process-level sessions.'
      },
      {
        dialect: 'postgresql',
        executionMode: 'deterministic-simulation',
        expectedSummary: 'READ COMMITTED допускает lost-update pattern для read-modify-write без predicate/version check.',
        semanticInvariants: ['Показана видимость каждого statement', 'Version predicate или row lock предотвращает потерю']
      },
      {
        dialect: 'mysql',
        executionMode: 'deterministic-simulation',
        expectedSummary: 'InnoDB REPEATABLE READ и locking reads требуют различать snapshot read и SELECT ... FOR UPDATE.',
        semanticInvariants: ['Snapshot и locking read различены', 'Защитный pattern завершает обе сессии предсказуемо']
      }
    ],
    portabilityChallenge: {
      prompt: 'Защити изменение priority от lost update с помощью version column и affected-row check.',
      requiredDialects: ['sqlite', 'postgresql', 'mysql'],
      equivalenceInvariants: ['Одна сессия обнаруживает конфликт', 'Ни одно изменение не теряется silently', 'Retry contract определён']
    },
    evidence: {
      requiresExecution: true,
      requiresIndependentAttempt: true,
      minimumPassingDialects: 3,
      retainedCheckDays: [14, 60]
    }
  }
] as const;

export function dialectLabManifest(id: string) {
  return dialectLabManifests.find(lab => lab.id === id) || null;
}

export function dialectLabsFor(capability: DialectCapability) {
  return dialectLabManifests.filter(lab => lab.capability === capability);
}
