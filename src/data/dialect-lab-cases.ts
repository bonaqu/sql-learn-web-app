import type { SqlDialect } from './dialect-lab-manifests';

export type DialectResultValue = string | number | null;

export type DialectLabCase = {
  labId: string;
  dialect: SqlDialect;
  starterSql: string;
  referenceSql: string;
  setupSql?: string;
  requiredPatterns: readonly string[];
  forbiddenPatterns: readonly string[];
  expected: {
    columns: readonly string[];
    rows: readonly (readonly DialectResultValue[])[];
    summary: string;
    normalizedPlan?: readonly string[];
    timeline?: readonly string[];
  };
};

const nullOrderingRows = [
  [1001, '2026-07-01 09:45:00'],
  [1003, '2026-07-02 09:40:00'],
  [1004, '2026-07-02 20:05:00'],
  [1005, '2026-07-03 11:00:00'],
  [1006, '2026-07-03 19:40:00'],
  [1008, '2026-07-04 17:10:00'],
  [1009, '2026-07-05 10:05:00'],
  [1011, '2026-07-06 11:15:00'],
  [1014, '2026-07-07 10:50:00'],
  [1013, '2026-07-07 13:30:00'],
  [1002, null],
  [1007, null],
  [1010, null],
  [1012, null]
] as const;

const jsonSetup = `
INSERT INTO ticket_events(event_id, ticket_id, event_type, event_at, payload) VALUES
  (101, 1002, 'metadata', '2026-07-01 11:00:00', '{"channel":null,"actor":"system"}'),
  (102, 1003, 'metadata', '2026-07-02 10:00:00', '{"actor":"system"}');`;

const upsertSetup = `
CREATE TABLE event_ingest(
  external_event_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);`;

export const dialectLabCases: readonly DialectLabCase[] = [
  {
    labId: 'dialect-null-ordering',
    dialect: 'sqlite',
    starterSql: 'SELECT ticket_id, closed_at\nFROM tickets\nORDER BY closed_at, ticket_id;',
    referenceSql: 'SELECT ticket_id, closed_at\nFROM tickets\nORDER BY (closed_at IS NULL), closed_at, ticket_id;',
    requiredPatterns: ['ORDER BY', 'IS NULL', 'TICKET_ID'],
    forbiddenPatterns: ['NULLS LAST'],
    expected: {
      columns: ['ticket_id', 'closed_at'],
      rows: nullOrderingRows,
      summary: 'Portable CASE/boolean sort key keeps resolved timestamps first and NULL last with a stable ticket_id tie-breaker.'
    }
  },
  {
    labId: 'dialect-null-ordering',
    dialect: 'postgresql',
    starterSql: 'SELECT ticket_id, closed_at\nFROM tickets\nORDER BY closed_at, ticket_id;',
    referenceSql: 'SELECT ticket_id, closed_at\nFROM tickets\nORDER BY closed_at NULLS LAST, ticket_id;',
    requiredPatterns: ['ORDER BY', 'NULLS LAST', 'TICKET_ID'],
    forbiddenPatterns: [],
    expected: {
      columns: ['ticket_id', 'closed_at'],
      rows: nullOrderingRows,
      summary: 'PostgreSQL uses explicit NULLS LAST and a unique tie-breaker.'
    }
  },
  {
    labId: 'dialect-null-ordering',
    dialect: 'mysql',
    starterSql: 'SELECT ticket_id, closed_at\nFROM tickets\nORDER BY closed_at, ticket_id;',
    referenceSql: 'SELECT ticket_id, closed_at\nFROM tickets\nORDER BY (closed_at IS NULL), closed_at, ticket_id;',
    requiredPatterns: ['ORDER BY', 'IS NULL', 'TICKET_ID'],
    forbiddenPatterns: ['NULLS LAST'],
    expected: {
      columns: ['ticket_id', 'closed_at'],
      rows: nullOrderingRows,
      summary: 'MySQL emulates NULLS LAST with a boolean key and stable ticket_id ordering.'
    }
  },
  {
    labId: 'dialect-date-time-boundaries',
    dialect: 'sqlite',
    starterSql: "SELECT ticket_id FROM tickets WHERE closed_at >= '2026-07-07';",
    referenceSql: "SELECT ticket_id\nFROM tickets\nWHERE closed_at >= datetime('2026-07-08 00:00:00', '-1 day')\n  AND closed_at < datetime('2026-07-08 00:00:00')\nORDER BY ticket_id;",
    requiredPatterns: ['CLOSED_AT >=', 'CLOSED_AT <', 'DATETIME', 'ORDER BY'],
    forbiddenPatterns: ['BETWEEN'],
    expected: {
      columns: ['ticket_id'],
      rows: [[1013], [1014]],
      summary: 'A half-open UTC interval includes the full previous day and never double-counts midnight.'
    }
  },
  {
    labId: 'dialect-date-time-boundaries',
    dialect: 'postgresql',
    starterSql: "SELECT ticket_id FROM tickets WHERE closed_at::date = DATE '2026-07-07';",
    referenceSql: "SELECT ticket_id\nFROM tickets\nWHERE closed_at >= TIMESTAMPTZ '2026-07-08 00:00:00+00' - INTERVAL '1 day'\n  AND closed_at < TIMESTAMPTZ '2026-07-08 00:00:00+00'\nORDER BY ticket_id;",
    requiredPatterns: ['TIMESTAMPTZ', 'INTERVAL', 'CLOSED_AT >=', 'CLOSED_AT <'],
    forbiddenPatterns: ['BETWEEN'],
    expected: {
      columns: ['ticket_id'],
      rows: [[1013], [1014]],
      summary: 'PostgreSQL keeps the absolute UTC boundary typed as timestamptz and uses a half-open interval.'
    }
  },
  {
    labId: 'dialect-date-time-boundaries',
    dialect: 'mysql',
    starterSql: "SELECT ticket_id FROM tickets WHERE DATE(closed_at) = '2026-07-07';",
    referenceSql: "SELECT ticket_id\nFROM tickets\nWHERE closed_at >= DATE_SUB(TIMESTAMP('2026-07-08 00:00:00'), INTERVAL 1 DAY)\n  AND closed_at < TIMESTAMP('2026-07-08 00:00:00')\nORDER BY ticket_id;",
    requiredPatterns: ['DATE_SUB', 'INTERVAL 1 DAY', 'CLOSED_AT >=', 'CLOSED_AT <'],
    forbiddenPatterns: ['BETWEEN'],
    expected: {
      columns: ['ticket_id'],
      rows: [[1013], [1014]],
      summary: 'MySQL uses an explicit session-timezone contract and half-open timestamp range.'
    }
  },
  {
    labId: 'dialect-json-extraction',
    dialect: 'sqlite',
    setupSql: jsonSetup,
    starterSql: "SELECT event_id, json_extract(payload, '$.channel') AS channel FROM ticket_events WHERE event_id >= 101 ORDER BY event_id;",
    referenceSql: "SELECT event_id,\n       json_extract(payload, '$.channel') AS channel,\n       CASE WHEN json_type(payload, '$.channel') IS NULL THEN 1 ELSE 0 END AS channel_missing\nFROM ticket_events\nWHERE event_id >= 101\nORDER BY event_id;",
    requiredPatterns: ['JSON_EXTRACT', 'JSON_TYPE', 'CHANNEL_MISSING', 'EVENT_ID >= 101', 'ORDER BY'],
    forbiddenPatterns: [],
    expected: {
      columns: ['event_id', 'channel', 'channel_missing'],
      rows: [[101, null, 0], [102, null, 1]],
      summary: 'The result distinguishes an explicit JSON null from a missing path.'
    }
  },
  {
    labId: 'dialect-json-extraction',
    dialect: 'postgresql',
    starterSql: "SELECT event_id, payload ->> 'channel' AS channel FROM ticket_events WHERE event_id >= 101 ORDER BY event_id;",
    referenceSql: "SELECT event_id,\n       payload ->> 'channel' AS channel,\n       NOT (payload ? 'channel') AS channel_missing\nFROM ticket_events\nWHERE event_id >= 101\nORDER BY event_id;",
    requiredPatterns: ["->> 'CHANNEL'", "PAYLOAD ? 'CHANNEL'", 'CHANNEL_MISSING', 'EVENT_ID >= 101'],
    forbiddenPatterns: [],
    expected: {
      columns: ['event_id', 'channel', 'channel_missing'],
      rows: [[101, null, 0], [102, null, 1]],
      summary: 'PostgreSQL separates text extraction from key-existence evidence.'
    }
  },
  {
    labId: 'dialect-json-extraction',
    dialect: 'mysql',
    starterSql: "SELECT event_id, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.channel')) AS channel FROM ticket_events WHERE event_id >= 101 ORDER BY event_id;",
    referenceSql: "SELECT event_id,\n       JSON_UNQUOTE(JSON_EXTRACT(payload, '$.channel')) AS channel,\n       CASE WHEN JSON_CONTAINS_PATH(payload, 'one', '$.channel') = 0 THEN 1 ELSE 0 END AS channel_missing\nFROM ticket_events\nWHERE event_id >= 101\nORDER BY event_id;",
    requiredPatterns: ['JSON_EXTRACT', 'JSON_UNQUOTE', 'JSON_CONTAINS_PATH', 'CHANNEL_MISSING', 'EVENT_ID >= 101'],
    forbiddenPatterns: [],
    expected: {
      columns: ['event_id', 'channel', 'channel_missing'],
      rows: [[101, null, 0], [102, null, 1]],
      summary: 'MySQL keeps path existence separate from scalar unquoting.'
    }
  },
  {
    labId: 'dialect-upsert-idempotency',
    dialect: 'sqlite',
    setupSql: upsertSetup,
    starterSql: "INSERT INTO event_ingest VALUES('evt-42', 'first', '2026-07-08 10:00:00');",
    referenceSql: "INSERT INTO event_ingest(external_event_id, payload, first_seen_at)\nVALUES('evt-42', 'first', '2026-07-08 10:00:00')\nON CONFLICT(external_event_id) DO UPDATE SET payload = excluded.payload;\nINSERT INTO event_ingest(external_event_id, payload, first_seen_at)\nVALUES('evt-42', 'second', '2026-07-08 10:05:00')\nON CONFLICT(external_event_id) DO UPDATE SET payload = excluded.payload;\nSELECT external_event_id, payload, first_seen_at FROM event_ingest ORDER BY external_event_id;",
    requiredPatterns: ['ON CONFLICT', 'EXTERNAL_EVENT_ID', 'EXCLUDED.PAYLOAD', 'SELECT'],
    forbiddenPatterns: ['REPLACE INTO'],
    expected: {
      columns: ['external_event_id', 'payload', 'first_seen_at'],
      rows: [['evt-42', 'second', '2026-07-08 10:00:00']],
      summary: 'Two deliveries preserve one business row and do not overwrite immutable first_seen_at.'
    }
  },
  {
    labId: 'dialect-upsert-idempotency',
    dialect: 'postgresql',
    starterSql: "INSERT INTO event_ingest VALUES('evt-42', 'first', now());",
    referenceSql: "INSERT INTO event_ingest(external_event_id, payload, first_seen_at) VALUES('evt-42', 'first', TIMESTAMPTZ '2026-07-08 10:00:00+00') ON CONFLICT(external_event_id) DO UPDATE SET payload = EXCLUDED.payload;",
    requiredPatterns: ['ON CONFLICT', 'EXTERNAL_EVENT_ID', 'EXCLUDED.PAYLOAD'],
    forbiddenPatterns: ['FIRST_SEEN_AT = EXCLUDED.FIRST_SEEN_AT'],
    expected: {
      columns: ['external_event_id', 'payload', 'first_seen_at'],
      rows: [['evt-42', 'second', '2026-07-08 10:00:00+00']],
      summary: 'PostgreSQL targets the business key and updates only mutable payload.'
    }
  },
  {
    labId: 'dialect-upsert-idempotency',
    dialect: 'mysql',
    starterSql: "INSERT INTO event_ingest VALUES('evt-42', 'first', NOW());",
    referenceSql: "INSERT INTO event_ingest(external_event_id, payload, first_seen_at) VALUES('evt-42', 'first', TIMESTAMP('2026-07-08 10:00:00')) AS incoming ON DUPLICATE KEY UPDATE payload = incoming.payload;",
    requiredPatterns: ['ON DUPLICATE KEY UPDATE', 'PAYLOAD = INCOMING.PAYLOAD', 'EXTERNAL_EVENT_ID'],
    forbiddenPatterns: ['REPLACE INTO', 'FIRST_SEEN_AT = INCOMING.FIRST_SEEN_AT'],
    expected: {
      columns: ['external_event_id', 'payload', 'first_seen_at'],
      rows: [['evt-42', 'second', '2026-07-08 10:00:00']],
      summary: 'MySQL handles the known unique key without replacing the row or immutable timestamp.'
    }
  },
  {
    labId: 'dialect-plan-vocabulary',
    dialect: 'sqlite',
    starterSql: "EXPLAIN QUERY PLAN SELECT ticket_id FROM tickets WHERE service = 'VPN';",
    referenceSql: "EXPLAIN QUERY PLAN SELECT ticket_id FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;",
    requiredPatterns: ['EXPLAIN QUERY PLAN', 'SERVICE', 'ORDER BY'],
    forbiddenPatterns: [],
    expected: {
      columns: ['plan'],
      rows: [['search:index:idx_tickets_service']],
      normalizedPlan: ['access=search', 'index=idx_tickets_service', 'sort=none'],
      summary: 'SQLite uses the service index and does not require a separate external sort.'
    }
  },
  {
    labId: 'dialect-plan-vocabulary',
    dialect: 'postgresql',
    starterSql: "EXPLAIN SELECT ticket_id FROM tickets WHERE service = 'VPN';",
    referenceSql: "EXPLAIN (FORMAT JSON) SELECT ticket_id FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;",
    requiredPatterns: ['EXPLAIN', 'FORMAT JSON', 'SERVICE', 'ORDER BY'],
    forbiddenPatterns: ['ANALYZE'],
    expected: {
      columns: ['plan'],
      rows: [['search:index:idx_tickets_service']],
      normalizedPlan: ['access=index-scan', 'index=idx_tickets_service', 'sort=possible'],
      summary: 'PostgreSQL JSON plan is normalized into access path, index and sort vocabulary without executing the query.'
    }
  },
  {
    labId: 'dialect-plan-vocabulary',
    dialect: 'mysql',
    starterSql: "EXPLAIN SELECT ticket_id FROM tickets WHERE service = 'VPN';",
    referenceSql: "EXPLAIN FORMAT=JSON SELECT ticket_id FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;",
    requiredPatterns: ['EXPLAIN FORMAT=JSON', 'SERVICE', 'ORDER BY'],
    forbiddenPatterns: ['EXPLAIN ANALYZE'],
    expected: {
      columns: ['plan'],
      rows: [['search:index:idx_tickets_service']],
      normalizedPlan: ['access=ref', 'index=idx_tickets_service', 'sort=filesort-check'],
      summary: 'MySQL JSON plan is normalized into access_type, key and sort vocabulary.'
    }
  },
  {
    labId: 'dialect-isolation-lost-update',
    dialect: 'sqlite',
    starterSql: "UPDATE ticket_versions SET priority = 'Critical' WHERE ticket_id = 1002;",
    referenceSql: "UPDATE ticket_versions SET priority = 'Critical', version = version + 1 WHERE ticket_id = 1002 AND version = 7;",
    requiredPatterns: ['UPDATE', 'VERSION = VERSION + 1', 'AND VERSION ='],
    forbiddenPatterns: [],
    expected: {
      columns: ['session', 'outcome'],
      rows: [['A', 'updated'], ['B', 'conflict']],
      timeline: ['A reads version 7', 'B reads version 7', 'A updates version 7 -> 8', 'B affected rows = 0', 'B reloads and retries'],
      summary: 'An optimistic version predicate makes the conflicting session observable instead of silently losing an update.'
    }
  },
  {
    labId: 'dialect-isolation-lost-update',
    dialect: 'postgresql',
    starterSql: "UPDATE ticket_versions SET priority = 'Critical' WHERE ticket_id = 1002;",
    referenceSql: "UPDATE ticket_versions SET priority = 'Critical', version = version + 1 WHERE ticket_id = 1002 AND version = 7 RETURNING version;",
    requiredPatterns: ['UPDATE', 'VERSION = VERSION + 1', 'AND VERSION =', 'RETURNING'],
    forbiddenPatterns: [],
    expected: {
      columns: ['session', 'outcome'],
      rows: [['A', 'updated'], ['B', 'conflict']],
      timeline: ['A snapshot sees version 7', 'B snapshot sees version 7', 'A commits version 8', 'B update returns zero rows', 'B retries from fresh state'],
      summary: 'PostgreSQL exposes optimistic conflict through zero returned rows under READ COMMITTED.'
    }
  },
  {
    labId: 'dialect-isolation-lost-update',
    dialect: 'mysql',
    starterSql: "UPDATE ticket_versions SET priority = 'Critical' WHERE ticket_id = 1002;",
    referenceSql: "UPDATE ticket_versions SET priority = 'Critical', version = version + 1 WHERE ticket_id = 1002 AND version = 7; SELECT ROW_COUNT() AS affected_rows;",
    requiredPatterns: ['UPDATE', 'VERSION = VERSION + 1', 'AND VERSION =', 'ROW_COUNT'],
    forbiddenPatterns: [],
    expected: {
      columns: ['session', 'outcome'],
      rows: [['A', 'updated'], ['B', 'conflict']],
      timeline: ['A snapshot sees version 7', 'B snapshot sees version 7', 'A commits version 8', 'B affected rows = 0', 'B retries from fresh state'],
      summary: 'MySQL detects the optimistic conflict through ROW_COUNT without relying on snapshot reads alone.'
    }
  }
] as const;

const caseByKey = new Map(dialectLabCases.map(item => [`${item.labId}:${item.dialect}`, item]));

export function dialectLabCase(labId: string, dialect: SqlDialect) {
  return caseByKey.get(`${labId}:${dialect}`) || null;
}

export function dialectCasesForLab(labId: string) {
  return dialectLabCases.filter(item => item.labId === labId);
}
