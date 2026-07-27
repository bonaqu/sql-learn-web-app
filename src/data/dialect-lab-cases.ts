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

type CaseInput = Omit<DialectLabCase, 'dialect'>;
const dialects: readonly SqlDialect[] = ['sqlite', 'postgresql', 'mysql'];
const cases: DialectLabCase[] = [];
const add = (dialect: SqlDialect, input: CaseInput) => cases.push({ dialect, ...input });

const nullOrderingRows = [
  [1001, '2026-07-01 09:45:00'], [1003, '2026-07-02 09:40:00'], [1004, '2026-07-02 20:05:00'],
  [1005, '2026-07-03 11:00:00'], [1006, '2026-07-03 19:40:00'], [1008, '2026-07-04 17:10:00'],
  [1009, '2026-07-05 10:05:00'], [1011, '2026-07-06 11:15:00'], [1014, '2026-07-07 10:50:00'],
  [1013, '2026-07-07 13:30:00'], [1002, null], [1007, null], [1010, null], [1012, null]
] as const;

for (const dialect of dialects) {
  const postgres = dialect === 'postgresql';
  add(dialect, {
    labId: 'dialect-null-ordering',
    starterSql: 'SELECT ticket_id, closed_at\nFROM tickets\nORDER BY closed_at, ticket_id;',
    referenceSql: postgres
      ? 'SELECT ticket_id, closed_at\nFROM tickets\nORDER BY closed_at NULLS LAST, ticket_id;'
      : 'SELECT ticket_id, closed_at\nFROM tickets\nORDER BY (closed_at IS NULL), closed_at, ticket_id;',
    requiredPatterns: postgres ? ['ORDER BY', 'NULLS LAST', 'TICKET_ID'] : ['ORDER BY', 'IS NULL', 'TICKET_ID'],
    forbiddenPatterns: postgres ? [] : ['NULLS LAST'],
    expected: { columns: ['ticket_id', 'closed_at'], rows: nullOrderingRows, summary: 'Explicit NULL bucket and unique ticket_id tie-breaker produce one stable order.' }
  });
}

const dateSql: Record<SqlDialect, string> = {
  sqlite: "SELECT ticket_id FROM tickets WHERE closed_at >= datetime('2026-07-08 00:00:00', '-1 day') AND closed_at < datetime('2026-07-08 00:00:00') ORDER BY ticket_id;",
  postgresql: "SELECT ticket_id FROM tickets WHERE closed_at >= TIMESTAMPTZ '2026-07-08 00:00:00+00' - INTERVAL '1 day' AND closed_at < TIMESTAMPTZ '2026-07-08 00:00:00+00' ORDER BY ticket_id;",
  mysql: "SELECT ticket_id FROM tickets WHERE closed_at >= DATE_SUB(TIMESTAMP('2026-07-08 00:00:00'), INTERVAL 1 DAY) AND closed_at < TIMESTAMP('2026-07-08 00:00:00') ORDER BY ticket_id;"
};
for (const dialect of dialects) add(dialect, {
  labId: 'dialect-date-time-boundaries',
  starterSql: "SELECT ticket_id FROM tickets WHERE closed_at >= '2026-07-07';",
  referenceSql: dateSql[dialect],
  requiredPatterns: dialect === 'sqlite' ? ['DATETIME', 'CLOSED_AT >=', 'CLOSED_AT <', 'ORDER BY'] : dialect === 'postgresql' ? ['TIMESTAMPTZ', 'INTERVAL', 'CLOSED_AT >=', 'CLOSED_AT <'] : ['DATE_SUB', 'INTERVAL 1 DAY', 'CLOSED_AT >=', 'CLOSED_AT <'],
  forbiddenPatterns: ['BETWEEN'],
  expected: { columns: ['ticket_id'], rows: [[1013], [1014]], summary: 'Half-open UTC interval includes the previous full day exactly once.' }
});

const jsonSetup = `
INSERT INTO ticket_events(event_id, ticket_id, event_type, event_at, payload) VALUES
  (101, 1002, 'metadata', '2026-07-01 11:00:00', '{"channel":null,"actor":"system"}'),
  (102, 1003, 'metadata', '2026-07-02 10:00:00', '{"actor":"system"}');`;
const jsonReference: Record<SqlDialect, string> = {
  sqlite: "SELECT event_id, json_extract(payload, '$.channel') AS channel, CASE WHEN json_type(payload, '$.channel') IS NULL THEN 1 ELSE 0 END AS channel_missing FROM ticket_events WHERE event_id >= 101 ORDER BY event_id;",
  postgresql: "SELECT event_id, payload ->> 'channel' AS channel, CASE WHEN payload ? 'channel' THEN 0 ELSE 1 END AS channel_missing FROM ticket_events WHERE event_id >= 101 ORDER BY event_id;",
  mysql: "SELECT event_id, CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$.channel')) = 'NULL' THEN NULL ELSE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.channel')) END AS channel, CASE WHEN JSON_CONTAINS_PATH(payload, 'one', '$.channel') = 0 THEN 1 ELSE 0 END AS channel_missing FROM ticket_events WHERE event_id >= 101 ORDER BY event_id;"
};
for (const dialect of dialects) add(dialect, {
  labId: 'dialect-json-extraction',
  ...(dialect === 'sqlite' ? { setupSql: jsonSetup } : {}),
  starterSql: "SELECT event_id, payload FROM ticket_events WHERE event_id >= 101 ORDER BY event_id;",
  referenceSql: jsonReference[dialect],
  requiredPatterns: dialect === 'sqlite' ? ['JSON_EXTRACT', 'JSON_TYPE', 'CHANNEL_MISSING'] : dialect === 'postgresql' ? ["->> 'CHANNEL'", "PAYLOAD ? 'CHANNEL'", 'CHANNEL_MISSING'] : ['JSON_EXTRACT', 'JSON_UNQUOTE', 'JSON_TYPE', 'JSON_CONTAINS_PATH'],
  forbiddenPatterns: [],
  expected: { columns: ['event_id', 'channel', 'channel_missing'], rows: [[101, null, 0], [102, null, 1]], summary: 'JSON null and missing path remain observably different.' }
});

const sqliteUpsertSetup = `
CREATE TABLE event_ingest(external_event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, first_seen_at TEXT NOT NULL);
INSERT INTO event_ingest VALUES('evt-42', 'first', '2026-07-08 10:00:00');`;
const upsertSql: Record<SqlDialect, string> = {
  sqlite: "INSERT INTO event_ingest(external_event_id,payload,first_seen_at) VALUES('evt-42','second','2026-07-08 10:05:00') ON CONFLICT(external_event_id) DO UPDATE SET payload=excluded.payload; SELECT external_event_id,payload,first_seen_at FROM event_ingest ORDER BY external_event_id;",
  postgresql: "INSERT INTO event_ingest(external_event_id,payload,first_seen_at) VALUES('evt-42','second',TIMESTAMPTZ '2026-07-08 10:05:00+00') ON CONFLICT(external_event_id) DO UPDATE SET payload=EXCLUDED.payload;",
  mysql: "INSERT INTO event_ingest(external_event_id,payload,first_seen_at) VALUES('evt-42','second',TIMESTAMP('2026-07-08 10:05:00')) AS incoming ON DUPLICATE KEY UPDATE payload=incoming.payload;"
};
for (const dialect of dialects) add(dialect, {
  labId: 'dialect-upsert-idempotency',
  ...(dialect === 'sqlite' ? { setupSql: sqliteUpsertSetup } : {}),
  starterSql: "INSERT INTO event_ingest VALUES('evt-42','second','2026-07-08 10:05:00');",
  referenceSql: upsertSql[dialect],
  requiredPatterns: dialect === 'mysql' ? ['ON DUPLICATE KEY UPDATE', 'INCOMING.PAYLOAD', 'EXTERNAL_EVENT_ID'] : ['ON CONFLICT', 'EXTERNAL_EVENT_ID', 'EXCLUDED.PAYLOAD'],
  forbiddenPatterns: ['REPLACE INTO', 'FIRST_SEEN_AT ='],
  expected: { columns: ['external_event_id', 'payload', 'first_seen_at'], rows: [['evt-42', 'second', '2026-07-08 10:00:00']], summary: 'Retry updates mutable payload while preserving one row and immutable first_seen_at.' }
});

const generatedSql = `CREATE TABLE ticket_metrics(
  ticket_id INTEGER PRIMARY KEY,
  opened_minutes INTEGER NOT NULL,
  paused_minutes INTEGER NOT NULL,
  active_minutes INTEGER GENERATED ALWAYS AS (opened_minutes - paused_minutes) STORED
);
INSERT INTO ticket_metrics(ticket_id,opened_minutes,paused_minutes) VALUES(2001,120,30),(2002,45,45);
SELECT ticket_id,active_minutes FROM ticket_metrics ORDER BY ticket_id;`;
for (const dialect of dialects) add(dialect, {
  labId: 'dialect-generated-columns',
  starterSql: 'CREATE TABLE ticket_metrics(ticket_id INTEGER PRIMARY KEY, opened_minutes INTEGER, paused_minutes INTEGER, active_minutes INTEGER);',
  referenceSql: generatedSql,
  requiredPatterns: ['GENERATED ALWAYS AS', 'OPENED_MINUTES - PAUSED_MINUTES', 'STORED', 'SELECT'],
  forbiddenPatterns: ['ACTIVE_MINUTES) VALUES', 'UPDATE TICKET_METRICS SET ACTIVE_MINUTES'],
  expected: { columns: ['ticket_id', 'active_minutes'], rows: [[2001, 90], [2002, 0]], summary: 'The engine computes active_minutes from base columns and rejects manual drift.' }
});

const recursiveSql: Record<SqlDialect, string> = {
  sqlite: `WITH RECURSIVE tree(service_id,parent_id,name,depth,path) AS (
    SELECT service_id,parent_id,name,0,printf('%04d',service_id) FROM service_tree WHERE service_id=1
    UNION ALL
    SELECT s.service_id,s.parent_id,s.name,t.depth+1,t.path||'.'||printf('%04d',s.service_id)
    FROM service_tree s JOIN tree t ON s.parent_id=t.service_id WHERE t.depth<8
  ) SELECT service_id,name,depth FROM tree ORDER BY path;`,
  postgresql: `WITH RECURSIVE tree(service_id,parent_id,name,depth,path) AS (
    SELECT service_id,parent_id,name,0,LPAD(service_id::text,4,'0') FROM service_tree WHERE service_id=1
    UNION ALL
    SELECT s.service_id,s.parent_id,s.name,t.depth+1,t.path||'.'||LPAD(s.service_id::text,4,'0')
    FROM service_tree s JOIN tree t ON s.parent_id=t.service_id WHERE t.depth<8
  ) SELECT service_id,name,depth FROM tree ORDER BY path;`,
  mysql: `WITH RECURSIVE tree(service_id,parent_id,name,depth,path) AS (
    SELECT service_id,parent_id,name,0,CAST(LPAD(CAST(service_id AS CHAR),4,'0') AS CHAR(80)) FROM service_tree WHERE service_id=1
    UNION ALL
    SELECT s.service_id,s.parent_id,s.name,t.depth+1,CONCAT(t.path,'.',LPAD(CAST(s.service_id AS CHAR),4,'0'))
    FROM service_tree s JOIN tree t ON s.parent_id=t.service_id WHERE t.depth<8
  ) SELECT service_id,name,depth FROM tree ORDER BY path;`
};
const treeRows = [[1, 'Digital Workplace', 0], [2, 'Remote Access', 1], [4, 'VPN', 2], [5, 'VDI', 2], [3, 'Collaboration', 1], [6, 'Email', 2], [7, 'LMS', 2], [8, 'Identity', 1], [9, 'Access', 2]] as const;
for (const dialect of dialects) add(dialect, {
  labId: 'dialect-recursive-service-tree',
  starterSql: 'SELECT service_id,name,0 AS depth FROM service_tree WHERE service_id=1;',
  referenceSql: recursiveSql[dialect],
  requiredPatterns: ['WITH RECURSIVE', 'UNION ALL', 'DEPTH + 1', 'PARENT_ID', 'ORDER BY PATH'],
  forbiddenPatterns: ['UNION SELECT'],
  expected: { columns: ['service_id', 'name', 'depth'], rows: treeRows, summary: 'Bounded recursive traversal returns one stable depth-first service tree.' }
});

const windowSetup = `
CREATE TABLE window_samples(sample_id INTEGER PRIMARY KEY, team VARCHAR(20) NOT NULL, minute_no INTEGER NOT NULL, opened INTEGER NOT NULL);
INSERT INTO window_samples VALUES(1,'A',1,2),(2,'A',2,3),(3,'A',2,5),(4,'A',3,7),(5,'B',1,4),(6,'B',2,6);`;
const windowSql = `SELECT sample_id,team,minute_no,
  SUM(opened) OVER(PARTITION BY team ORDER BY minute_no,sample_id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS rolling_opened
FROM window_samples ORDER BY team,minute_no,sample_id;`;
for (const dialect of dialects) add(dialect, {
  labId: 'dialect-window-frame',
  ...(dialect === 'sqlite' ? { setupSql: windowSetup } : {}),
  starterSql: 'SELECT sample_id,team,minute_no,SUM(opened) OVER(PARTITION BY team ORDER BY minute_no) AS rolling_opened FROM window_samples;',
  referenceSql: windowSql,
  requiredPatterns: ['SUM(OPENED) OVER', 'PARTITION BY TEAM', 'ORDER BY MINUTE_NO,SAMPLE_ID', 'ROWS BETWEEN 1 PRECEDING AND CURRENT ROW'],
  forbiddenPatterns: ['RANGE BETWEEN'],
  expected: { columns: ['sample_id', 'team', 'minute_no', 'rolling_opened'], rows: [[1, 'A', 1, 2], [2, 'A', 2, 5], [3, 'A', 2, 8], [4, 'A', 3, 12], [5, 'B', 1, 4], [6, 'B', 2, 10]], summary: 'Explicit ROWS frame counts one previous physical row even when sort-key peers exist.' }
});

const keysetSql = "SELECT ticket_id,created_at FROM tickets WHERE (created_at,ticket_id) > ('2026-07-03 14:10:00',1006) ORDER BY created_at,ticket_id LIMIT 4;";
for (const dialect of dialects) add(dialect, {
  labId: 'dialect-keyset-pagination',
  starterSql: 'SELECT ticket_id,created_at FROM tickets ORDER BY created_at,ticket_id LIMIT 4 OFFSET 6;',
  referenceSql: keysetSql,
  requiredPatterns: ['(CREATED_AT,TICKET_ID) >', 'ORDER BY CREATED_AT,TICKET_ID', 'LIMIT 4'],
  forbiddenPatterns: ['OFFSET'],
  expected: { columns: ['ticket_id', 'created_at'], rows: [[1007, '2026-07-04 12:30:00'], [1008, '2026-07-04 16:45:00'], [1009, '2026-07-05 08:05:00'], [1010, '2026-07-05 13:25:00']], summary: 'Composite seek cursor returns the next stable page without OFFSET drift.' }
});

const planSql: Record<SqlDialect, string> = {
  sqlite: "EXPLAIN QUERY PLAN SELECT ticket_id FROM tickets WHERE service='VPN' ORDER BY ticket_id;",
  postgresql: "EXPLAIN (FORMAT JSON) SELECT ticket_id FROM tickets WHERE service='VPN' ORDER BY ticket_id;",
  mysql: "EXPLAIN FORMAT=JSON SELECT ticket_id FROM tickets WHERE service='VPN' ORDER BY ticket_id;"
};
for (const dialect of dialects) add(dialect, {
  labId: 'dialect-plan-vocabulary',
  starterSql: "EXPLAIN SELECT ticket_id FROM tickets WHERE service='VPN';",
  referenceSql: planSql[dialect],
  requiredPatterns: dialect === 'sqlite' ? ['EXPLAIN QUERY PLAN', 'SERVICE', 'ORDER BY'] : dialect === 'postgresql' ? ['EXPLAIN', 'FORMAT JSON', 'SERVICE', 'ORDER BY'] : ['EXPLAIN FORMAT=JSON', 'SERVICE', 'ORDER BY'],
  forbiddenPatterns: ['ANALYZE'],
  expected: {
    columns: ['plan'], rows: [['search:index:idx_tickets_service']],
    normalizedPlan: dialect === 'sqlite' ? ['access=search', 'index=idx_tickets_service', 'sort=none'] : dialect === 'postgresql' ? ['access=index-scan', 'index=idx_tickets_service', 'sort=possible'] : ['access=ref', 'index=idx_tickets_service', 'sort=possible'],
    summary: 'Engine-specific plan is normalized to indexed access, chosen index and sort evidence.'
  }
});

const isolationSql: Record<SqlDialect, string> = {
  sqlite: "UPDATE ticket_versions SET priority='Critical',version=version+1 WHERE ticket_id=1002 AND version=7; SELECT changes() AS affected_rows;",
  postgresql: "UPDATE ticket_versions SET priority='Critical',version=version+1 WHERE ticket_id=1002 AND version=7 RETURNING version;",
  mysql: "UPDATE ticket_versions SET priority='Critical',version=version+1 WHERE ticket_id=1002 AND version=7; SELECT ROW_COUNT() AS affected_rows;"
};
for (const dialect of dialects) add(dialect, {
  labId: 'dialect-isolation-lost-update',
  starterSql: "UPDATE ticket_versions SET priority='Critical' WHERE ticket_id=1002;",
  referenceSql: isolationSql[dialect],
  requiredPatterns: ['UPDATE', 'VERSION=VERSION+1', 'AND VERSION='],
  forbiddenPatterns: [],
  expected: {
    columns: ['session', 'outcome'], rows: [['A', 'updated'], ['B', 'conflict']],
    timeline: ['A reads version 7', 'B reads version 7', 'A commits version 8', 'B affects zero rows', 'B reloads fresh state'],
    summary: 'Optimistic version predicate exposes the second writer conflict instead of silently losing A.'
  }
});

const lockingSql: Record<SqlDialect, string> = {
  sqlite: "UPDATE work_queue SET claimed_by='A' WHERE job_id=(SELECT job_id FROM work_queue WHERE status='ready' AND claimed_by IS NULL ORDER BY job_id LIMIT 1) AND claimed_by IS NULL RETURNING job_id;",
  postgresql: "SELECT job_id FROM work_queue WHERE status='ready' ORDER BY job_id LIMIT 1 FOR UPDATE SKIP LOCKED;",
  mysql: "SELECT job_id FROM work_queue WHERE status='ready' ORDER BY job_id LIMIT 1 FOR UPDATE SKIP LOCKED;"
};
for (const dialect of dialects) add(dialect, {
  labId: 'dialect-locking-work-queue',
  starterSql: "SELECT job_id FROM work_queue WHERE status='ready' ORDER BY job_id LIMIT 1;",
  referenceSql: lockingSql[dialect],
  requiredPatterns: dialect === 'sqlite' ? ['UPDATE WORK_QUEUE', 'CLAIMED_BY IS NULL', 'ORDER BY JOB_ID', 'RETURNING JOB_ID'] : ['FOR UPDATE SKIP LOCKED', 'ORDER BY JOB_ID', 'LIMIT 1'],
  forbiddenPatterns: dialect === 'sqlite' ? ['FOR UPDATE'] : [],
  expected: {
    columns: ['session', 'job_id'], rows: [['A', 1], ['B', 2]],
    timeline: ['A begins and locks job 1', 'B begins before A commits', 'B skips job 1 and locks job 2', 'Both transactions commit'],
    summary: 'Two concurrent consumers claim distinct jobs while the first row remains locked.'
  }
});

export const dialectLabCases: readonly DialectLabCase[] = cases;
const caseByKey = new Map(dialectLabCases.map(item => [`${item.labId}:${item.dialect}`, item]));
export function dialectLabCase(labId: string, dialect: SqlDialect) { return caseByKey.get(`${labId}:${dialect}`) || null; }
export function dialectCasesForLab(labId: string) { return dialectLabCases.filter(item => item.labId === labId); }
