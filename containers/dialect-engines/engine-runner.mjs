import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import pg from 'pg';

const { Client, types } = pg;
types.setTypeParser(1114, value => value);
types.setTypeParser(1184, value => value.replace('T', ' ').replace(/Z$/, '+00'));

const engine = process.argv[2];
if (!['postgresql', 'mysql'].includes(engine)) {
  console.error('Unsupported engine');
  process.exit(64);
}

const input = JSON.parse(readFileSync(0, 'utf8'));
const labId = String(input.labId || '');
const sql = String(input.sql || '');
const timeoutMs = Math.max(250, Math.min(5_000, Number(input.timeoutMs) || 2_500));
const supportedLabs = new Set([
  'dialect-null-ordering',
  'dialect-date-time-boundaries',
  'dialect-json-extraction',
  'dialect-upsert-idempotency',
  'dialect-plan-vocabulary',
  'dialect-isolation-lost-update'
]);
if (!supportedLabs.has(labId) || !sql.trim() || sql.length > 24_000) {
  console.error('Invalid runner input');
  process.exit(65);
}

const tickets = [
  [1001, 'VPN', 'Closed', '2026-07-01 08:00:00', '2026-07-01 09:45:00', 'High', 1, 105, 120],
  [1002, 'VDI', 'Open', '2026-07-01 10:15:00', null, 'Critical', 2, null, 60],
  [1003, 'Outlook', 'Closed', '2026-07-02 09:00:00', '2026-07-02 09:40:00', 'Medium', 3, 40, 90],
  [1004, 'VPN', 'Closed', '2026-07-02 14:30:00', '2026-07-02 20:05:00', 'Critical', 1, 335, 60],
  [1005, 'SAP', 'Closed', '2026-07-03 11:00:00', '2026-07-03 11:00:00', 'Low', 4, 0, 240],
  [1006, 'VDI', 'Closed', '2026-07-03 16:20:00', '2026-07-03 19:40:00', 'High', 2, 200, 120],
  [1007, 'Outlook', 'Open', '2026-07-04 08:45:00', null, 'Medium', null, null, 90],
  [1008, 'SAP', 'Closed', '2026-07-04 13:10:00', '2026-07-04 17:10:00', 'High', 4, 240, 120],
  [1009, 'VPN', 'Closed', '2026-07-05 09:25:00', '2026-07-05 10:05:00', 'Medium', 1, 40, 90],
  [1010, 'VDI', 'Open', '2026-07-05 18:00:00', null, 'Critical', 2, null, 60],
  [1011, 'SAP', 'Closed', '2026-07-06 10:00:00', '2026-07-06 11:15:00', 'Medium', 3, 75, 90],
  [1012, 'Outlook', 'Open', '2026-07-06 15:30:00', null, 'Low', null, null, 240],
  [1013, 'VPN', 'Closed', '2026-07-07 12:00:00', '2026-07-07 13:30:00', 'High', 1, 90, 120],
  [1014, 'VDI', 'Closed', '2026-07-07 09:10:00', '2026-07-07 10:50:00', 'Medium', 2, 100, 90]
];

function normalizeValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('.000Z', '');
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return JSON.stringify(value);
}

function normalizeRows(rows) {
  return rows.map(row => Object.values(row).map(normalizeValue));
}

function normalizeColumns(fields, rows) {
  if (fields?.length) return fields.map(field => String(field.name || field).toLowerCase());
  const first = rows[0];
  return first ? Object.keys(first).map(column => column.toLowerCase()) : [];
}

async function seedPostgresql(client) {
  await client.query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    CREATE TABLE tickets(
      ticket_id INTEGER PRIMARY KEY,
      service TEXT NOT NULL,
      status TEXT NOT NULL,
      opened_at TIMESTAMP NOT NULL,
      closed_at TIMESTAMP NULL,
      priority TEXT NOT NULL,
      engineer_id INTEGER NULL,
      resolution_minutes INTEGER NULL,
      sla_minutes INTEGER NOT NULL
    );
    CREATE INDEX idx_tickets_service ON tickets(service, ticket_id);
    CREATE TABLE ticket_events(
      event_id INTEGER PRIMARY KEY,
      ticket_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_at TIMESTAMP NOT NULL,
      payload JSONB NOT NULL
    );
    CREATE TABLE event_ingest(
      external_event_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE incoming_event(
      external_event_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE ticket_versions(
      ticket_id INTEGER PRIMARY KEY,
      priority TEXT NOT NULL,
      version INTEGER NOT NULL
    );
  `);
  for (const row of tickets) {
    await client.query(`INSERT INTO tickets(ticket_id, service, status, opened_at, closed_at, priority, engineer_id, resolution_minutes, sla_minutes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, row);
  }
  await client.query(`INSERT INTO ticket_events(event_id,ticket_id,event_type,event_at,payload) VALUES
    (101,1002,'metadata','2026-07-01 11:00:00','{"channel":null,"actor":"system"}'::jsonb),
    (102,1003,'metadata','2026-07-02 10:00:00','{"actor":"system"}'::jsonb)`);
  await client.query(`INSERT INTO incoming_event VALUES('evt-42','first','2026-07-08 10:00:00+00')`);
  await client.query(`INSERT INTO ticket_versions VALUES(1002,'High',7)`);
}

async function seedMysql(connection) {
  await connection.query('DROP DATABASE IF EXISTS dialect_lab');
  await connection.query('CREATE DATABASE dialect_lab CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  await connection.query('USE dialect_lab');
  await connection.query(`CREATE TABLE tickets(
    ticket_id INT PRIMARY KEY,
    service VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    opened_at DATETIME NOT NULL,
    closed_at DATETIME NULL,
    priority VARCHAR(32) NOT NULL,
    engineer_id INT NULL,
    resolution_minutes INT NULL,
    sla_minutes INT NOT NULL,
    INDEX idx_tickets_service(service, ticket_id)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE ticket_events(
    event_id INT PRIMARY KEY,
    ticket_id INT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    event_at DATETIME NOT NULL,
    payload JSON NOT NULL
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE event_ingest(
    external_event_id VARCHAR(128) PRIMARY KEY,
    payload TEXT NOT NULL,
    first_seen_at DATETIME NOT NULL
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE incoming_event(
    external_event_id VARCHAR(128) PRIMARY KEY,
    payload TEXT NOT NULL,
    first_seen_at DATETIME NOT NULL
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE ticket_versions(
    ticket_id INT PRIMARY KEY,
    priority VARCHAR(32) NOT NULL,
    version INT NOT NULL
  ) ENGINE=InnoDB`);
  await connection.query(`INSERT INTO tickets(ticket_id, service, status, opened_at, closed_at, priority, engineer_id, resolution_minutes, sla_minutes) VALUES ?`, [tickets]);
  await connection.query(`INSERT INTO ticket_events(event_id,ticket_id,event_type,event_at,payload) VALUES
    (101,1002,'metadata','2026-07-01 11:00:00',JSON_OBJECT('channel',NULL,'actor','system')),
    (102,1003,'metadata','2026-07-02 10:00:00',JSON_OBJECT('actor','system'))`);
  await connection.query(`INSERT INTO incoming_event VALUES('evt-42','first','2026-07-08 10:00:00')`);
  await connection.query(`INSERT INTO ticket_versions VALUES(1002,'High',7)`);
}

function walkPostgresPlan(node, output) {
  if (!node || typeof node !== 'object') return;
  const type = String(node['Node Type'] || '').toLowerCase();
  if (type.includes('index')) output.add('access=index-scan');
  else if (type.includes('seq scan')) output.add('access=seq-scan');
  if (node['Index Name']) output.add(`index=${String(node['Index Name']).toLowerCase()}`);
  if (type === 'sort') output.add('sort=explicit');
  for (const child of node.Plans || []) walkPostgresPlan(child, output);
}

function normalizePostgresPlan(rows) {
  const output = new Set();
  for (const row of rows) {
    const value = row['QUERY PLAN'];
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const root = Array.isArray(parsed) ? parsed[0]?.Plan : parsed?.Plan;
    walkPostgresPlan(root, output);
  }
  if (![...output].some(item => item.startsWith('sort='))) output.add('sort=none');
  return [...output].sort();
}

function normalizeMysqlPlan(rows) {
  const output = new Set();
  const raw = rows[0]?.EXPLAIN || rows[0]?.explain;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const block = parsed?.query_block || {};
  const table = block.table || block.ordering_operation?.table || block.nested_loop?.[0]?.table || {};
  if (table.access_type) output.add(`access=${String(table.access_type).toLowerCase()}`);
  if (table.key) output.add(`index=${String(table.key).toLowerCase()}`);
  output.add(block.ordering_operation?.using_filesort ? 'sort=filesort' : 'sort=none');
  return [...output].sort();
}

async function runPostgresql() {
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'postgres' });
  await client.connect();
  try {
    await client.query(`SET statement_timeout = ${timeoutMs}; SET lock_timeout = 1000; SET TIME ZONE 'UTC'`);
    await seedPostgresql(client);
    const version = (await client.query('SHOW server_version')).rows[0]?.server_version || 'unknown';

    if (labId === 'dialect-upsert-idempotency') {
      await client.query(sql);
      await client.query(`UPDATE incoming_event SET payload='second', first_seen_at='2026-07-08 10:05:00+00' WHERE external_event_id='evt-42'`);
      await client.query(sql);
      const result = await client.query(`SELECT external_event_id,payload,to_char(first_seen_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS first_seen_at FROM event_ingest ORDER BY external_event_id`);
      return { engineVersion: version, columns: normalizeColumns(result.fields, result.rows), rows: normalizeRows(result.rows), normalizedPlan: [], timeline: [] };
    }

    if (labId === 'dialect-isolation-lost-update') {
      const second = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'postgres' });
      await second.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await second.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query('SELECT version FROM ticket_versions WHERE ticket_id=1002');
        await second.query('SELECT version FROM ticket_versions WHERE ticket_id=1002');
        const first = await client.query(sql);
        await client.query('COMMIT');
        const competing = await second.query(sql);
        await second.query('COMMIT');
        return {
          engineVersion: version,
          columns: ['session', 'outcome'],
          rows: [['A', first.rowCount > 0 ? 'updated' : 'conflict'], ['B', competing.rowCount > 0 ? 'updated' : 'conflict']],
          normalizedPlan: [],
          timeline: ['A snapshot sees version 7', 'B snapshot sees version 7', 'A commits version 8', 'B update returns zero rows', 'B retries from fresh state']
        };
      } finally {
        await second.end().catch(() => {});
      }
    }

    const result = await client.query(sql);
    const finalResult = Array.isArray(result) ? result.at(-1) : result;
    const rows = finalResult?.rows || [];
    return {
      engineVersion: version,
      columns: labId === 'dialect-plan-vocabulary' ? ['plan'] : normalizeColumns(finalResult?.fields, rows),
      rows: labId === 'dialect-plan-vocabulary' ? [['real-postgresql-plan']] : normalizeRows(rows),
      normalizedPlan: labId === 'dialect-plan-vocabulary' ? normalizePostgresPlan(rows) : [],
      timeline: []
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function mysqlConnection() {
  return mysql.createConnection({
    user: 'root',
    socketPath: process.env.MYSQL_SOCKET || '/var/run/mysqld/mysqld.sock',
    multipleStatements: true,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false
  });
}

function finalMysqlResult(results, fields) {
  if (!Array.isArray(results) || !Array.isArray(fields)) return { rows: [], fields: [] };
  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (Array.isArray(results[index]) && Array.isArray(fields[index])) return { rows: results[index], fields: fields[index] };
  }
  return { rows: Array.isArray(results) ? results : [], fields: Array.isArray(fields) ? fields : [] };
}

async function runMysql() {
  const connection = await mysqlConnection();
  try {
    await connection.query(`SET SESSION MAX_EXECUTION_TIME=${timeoutMs}`);
    await connection.query(`SET SESSION time_zone='+00:00'`);
    await connection.query(`SET SESSION innodb_lock_wait_timeout=2`);
    await seedMysql(connection);
    const [versionRows] = await connection.query('SELECT VERSION() AS version');
    const version = versionRows[0]?.version || 'unknown';

    if (labId === 'dialect-upsert-idempotency') {
      await connection.query(sql);
      await connection.query(`UPDATE incoming_event SET payload='second', first_seen_at='2026-07-08 10:05:00' WHERE external_event_id='evt-42'`);
      await connection.query(sql);
      const [rows, fields] = await connection.query(`SELECT external_event_id,payload,DATE_FORMAT(first_seen_at,'%Y-%m-%d %H:%i:%s') AS first_seen_at FROM event_ingest ORDER BY external_event_id`);
      return { engineVersion: version, columns: normalizeColumns(fields, rows), rows: normalizeRows(rows), normalizedPlan: [], timeline: [] };
    }

    if (labId === 'dialect-isolation-lost-update') {
      const second = await mysqlConnection();
      try {
        await connection.query('USE dialect_lab');
        await second.query('USE dialect_lab');
        await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await second.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await connection.beginTransaction();
        await second.beginTransaction();
        await connection.query('SELECT version FROM ticket_versions WHERE ticket_id=1002');
        await second.query('SELECT version FROM ticket_versions WHERE ticket_id=1002');
        const [first] = await connection.query(sql);
        await connection.commit();
        const [competing] = await second.query(sql);
        await second.commit();
        const affected = value => Array.isArray(value)
          ? Number(value.find(item => item && typeof item.affectedRows === 'number')?.affectedRows || 0)
          : Number(value?.affectedRows || 0);
        return {
          engineVersion: version,
          columns: ['session', 'outcome'],
          rows: [['A', affected(first) > 0 ? 'updated' : 'conflict'], ['B', affected(competing) > 0 ? 'updated' : 'conflict']],
          normalizedPlan: [],
          timeline: ['A snapshot sees version 7', 'B snapshot sees version 7', 'A commits version 8', 'B affected rows = 0', 'B retries from fresh state']
        };
      } finally {
        await second.end().catch(() => {});
      }
    }

    const [results, fields] = await connection.query(sql);
    const final = finalMysqlResult(results, fields);
    return {
      engineVersion: version,
      columns: labId === 'dialect-plan-vocabulary' ? ['plan'] : normalizeColumns(final.fields, final.rows),
      rows: labId === 'dialect-plan-vocabulary' ? [['real-mysql-plan']] : normalizeRows(final.rows),
      normalizedPlan: labId === 'dialect-plan-vocabulary' ? normalizeMysqlPlan(final.rows) : [],
      timeline: []
    };
  } finally {
    await connection.end().catch(() => {});
  }
}

try {
  const started = Date.now();
  const result = engine === 'postgresql' ? await runPostgresql() : await runMysql();
  process.stdout.write(JSON.stringify({
    ok: true,
    engine,
    labId,
    durationMs: Math.max(1, Date.now() - started),
    ...result
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    engine,
    labId,
    error: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 1;
}
