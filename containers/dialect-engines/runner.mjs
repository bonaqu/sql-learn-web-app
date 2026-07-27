#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, chownSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const RUNNER_VERSION = 'dialect-real-engine-v1';
const MAX_REQUEST_BYTES = 96_000;
const MAX_SQL_BYTES = 24_000;
const DEFAULT_TIMEOUT_MS = 4_000;
const STARTUP_TIMEOUT_MS = 30_000;
const MAX_COMMAND_BUFFER = 2_000_000;

function fail(message, code = 'runner_error') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function boundedInteger(value, fallback, minimum, maximum) { return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback; }
function safeId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(value)) fail('Invalid request id', 'invalid_request');
  return value;
}
function boundedSql(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is required`, 'invalid_request');
  if (Buffer.byteLength(value, 'utf8') > MAX_SQL_BYTES) fail(`${label} is too large`, 'invalid_request');
  if (value.includes('\0')) fail(`${label} contains a zero byte`, 'invalid_request');
  return value;
}
function sanitizeEngineError(value) {
  return String(value)
    .replace(/^LINE\s+\d+:.*$/gim, '')
    .replace(/^.*at line \d+.*$/gim, '')
    .replace(/\/tmp\/sql-academy-[^\s:]+/g, '<runtime>')
    .replace(/\/workspace\/dialect-(?:request|result)\.json/g, '<contract-file>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || 'Database engine rejected the statement';
}
function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    encoding: 'utf8', maxBuffer: MAX_COMMAND_BUFFER, timeout: options.timeout ?? STARTUP_TIMEOUT_MS,
    input: options.input, env: { ...process.env, ...(options.env || {}) }, stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.error) {
    result.error.code = result.error.code === 'ETIMEDOUT' ? 'engine_timeout' : result.error.code;
    throw result.error;
  }
  if (result.status !== 0) {
    const error = new Error(sanitizeEngineError(result.stderr || result.stdout || `${commandName} failed`));
    error.code = result.signal === 'SIGTERM' || result.signal === 'SIGKILL' ? 'engine_timeout' : 'engine_error';
    throw error;
  }
  return result.stdout || '';
}
function commandPath(name) { return command('sh', ['-lc', `command -v ${name}`]).trim(); }
function writePrivate(path, content) {
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
}
function waitFor(check, timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try { check(); return; } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
  const error = new Error(lastError instanceof Error ? lastError.message : 'Database engine did not become ready');
  error.code = 'engine_startup_timeout';
  throw error;
}
function parseCsv(source) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index], next = source[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (quoted) fail('PostgreSQL returned malformed CSV', 'engine_error');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(item => item.some(value => value.length));
}
function parseTsv(source) {
  return source.split(/\r?\n/).filter(Boolean).map(line => line.split('\t').map(value => value === 'NULL'
    ? null : value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')));
}
function normalizeValue(value) {
  if (value === null) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value) && value.length < 18) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  if (value === 't' || value === 'true') return true;
  if (value === 'f' || value === 'false') return false;
  return value;
}
function truncateUtf8(value, maximumBytes) {
  const source = String(value), bytes = Buffer.from(source, 'utf8');
  if (bytes.byteLength <= maximumBytes) return source;
  const suffix = '…[truncated]', budget = Math.max(0, maximumBytes - Buffer.byteLength(suffix, 'utf8'));
  let prefix = bytes.subarray(0, budget).toString('utf8');
  while (prefix.endsWith('\uFFFD')) prefix = prefix.slice(0, -1);
  return `${prefix}${suffix}`;
}
function boundedTable(columns, rows, limits) {
  if (!Array.isArray(columns) || !Array.isArray(rows) || columns.length > 100) fail('Invalid result table', 'engine_error');
  const selectedRows = rows.slice(0, limits.maximumRows).map(row => {
    if (!Array.isArray(row) || row.length !== columns.length) fail('Invalid result row', 'engine_error');
    return row.map(value => value === null || typeof value === 'number' || typeof value === 'boolean' ? value : truncateUtf8(value, limits.maximumCellBytes));
  });
  const output = { columns: columns.map(column => truncateUtf8(column, 256)), rows: selectedRows, truncated: rows.length > selectedRows.length };
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > limits.maximumResultBytes) fail('Result exceeds the published size limit', 'result_too_large');
  return output;
}

class InteractiveSession {
  constructor(commandName, args, env) {
    this.stdout = '';
    this.stderr = '';
    this.cursor = 0;
    this.exited = false;
    this.child = spawn(commandName, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => { this.stdout += chunk; });
    this.child.stderr.on('data', chunk => { this.stderr += chunk; });
    this.child.on('exit', () => { this.exited = true; });
  }
  async exec(sql, timeoutMs) {
    const marker = `__sql_academy_${crypto.randomUUID().replaceAll('-', '')}__`;
    const start = this.cursor;
    const stderrStart = this.stderr.length;
    this.child.stdin.write(`${sql.trim()}\nSELECT '${marker}';\n`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const segment = this.stdout.slice(start);
      const index = segment.indexOf(marker);
      if (index >= 0) {
        const result = segment.slice(0, index).trim();
        this.cursor = start + index + marker.length;
        const errors = this.stderr.slice(stderrStart);
        if (/\b(?:ERROR|FATAL)\b/i.test(errors)) fail(sanitizeEngineError(errors), 'engine_error');
        return result;
      }
      if (this.exited) fail(sanitizeEngineError(this.stderr.slice(stderrStart) || 'Database session exited'), 'engine_error');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    fail('Database session statement exceeded timeout', 'engine_timeout');
  }
  async close() {
    try { this.child.stdin.end(); } catch {}
    const deadline = Date.now() + 750;
    while (!this.exited && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (!this.exited) try { this.child.kill('SIGKILL'); } catch {}
  }
}

function postgresRuntime(root, timeoutMs, mode) {
  const data = `${root}/pgdata`, socket = `${root}/pgsocket`, pgBin = command('pg_config', ['--bindir']).trim();
  const log = `${data}/postgres.log`;
  mkdirSync(data, { recursive: true, mode: 0o700 });
  mkdirSync(socket, { recursive: true, mode: 0o755 });
  const uid = Number(command('id', ['-u', 'postgres']).trim()), gid = Number(command('id', ['-g', 'postgres']).trim());
  chownSync(data, uid, gid); chownSync(socket, uid, gid);
  command('runuser', ['-u', 'postgres', '--', `${pgBin}/initdb`, '-D', data, '--auth=trust', '--encoding=UTF8', '--no-locale']);
  command('runuser', ['-u', 'postgres', '--', `${pgBin}/pg_ctl`, '-D', data, '-l', log, '-w', 'start', '-o', `-F -k ${socket} -p 55432 -c listen_addresses='' -c statement_timeout=${timeoutMs} -c timezone=UTC`]);
  command(`${pgBin}/psql`, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55432', '-U', 'postgres', '-d', 'postgres'], { input: "CREATE ROLE learner LOGIN;\nCREATE DATABASE dialect_lab OWNER learner;\n" });
  const baseArgs = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55432', '-U', 'learner', '-d', 'dialect_lab'];
  const pgOptions = [`-c statement_timeout=${timeoutMs}`, '-c timezone=UTC', ...(mode === 'plan' ? ['-c enable_seqscan=off'] : [])].join(' ');
  const env = { PGOPTIONS: pgOptions };
  return {
    version: command(`${pgBin}/psql`, [...baseArgs, '-Atc', 'SHOW server_version;'], { env }).trim(),
    setup(sql) { command(`${pgBin}/psql`, [...baseArgs, '-q'], { input: sql, timeout: timeoutMs, env }); },
    execute(sql) {
      const parsed = parseCsv(command(`${pgBin}/psql`, [...baseArgs, '--csv', '-q'], { input: sql, timeout: timeoutMs, env }));
      return parsed.length ? { columns: parsed[0], rows: parsed.slice(1).map(row => row.map(normalizeValue)) } : { columns: [], rows: [] };
    },
    session() { return new InteractiveSession('stdbuf', ['-oL', '-eL', `${pgBin}/psql`, ...baseArgs, '-A', '-t', '-q'], env); },
    sessionPrelude: "SET TIME ZONE 'UTC'; SET statement_timeout = '4s';",
    stop() { try { command('runuser', ['-u', 'postgres', '--', `${pgBin}/pg_ctl`, '-D', data, '-m', 'immediate', '-w', 'stop']); } catch {} }
  };
}

function mysqlRuntime(root, timeoutMs, mode) {
  const data = `${root}/mysql-data`, run = `${root}/mysql-run`, socket = `${run}/mysql.sock`, pidFile = `${run}/mysql.pid`, errorLog = `${run}/mysql-error.log`;
  const mysqld = commandPath('mysqld'), client = commandPath('mysql'), admin = commandPath('mysqladmin');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  mkdirSync(run, { recursive: true, mode: 0o755 });
  const uid = Number(command('id', ['-u', 'mysql']).trim()), gid = Number(command('id', ['-g', 'mysql']).trim());
  chownSync(data, uid, gid); chownSync(run, uid, gid);
  command(mysqld, ['--no-defaults', '--initialize-insecure', `--datadir=${data}`, '--user=mysql'], { timeout: STARTUP_TIMEOUT_MS });
  const child = spawn(mysqld, [
    '--no-defaults', '--user=mysql', `--datadir=${data}`, `--socket=${socket}`, `--pid-file=${pidFile}`, `--log-error=${errorLog}`,
    '--skip-networking=ON', '--skip-log-bin', '--local-infile=OFF', '--secure-file-priv=NULL', '--max-connections=20',
    `--max-execution-time=${timeoutMs}`, '--innodb-lock-wait-timeout=2'
  ], { stdio: 'ignore' });
  waitFor(() => command(admin, [`--socket=${socket}`, '-uroot', '--connect-timeout=1', 'ping'], { timeout: 1_000 }));
  command(client, [`--socket=${socket}`, '-uroot', '--batch', '--raw'], { input: [
    "CREATE DATABASE dialect_lab CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;",
    "CREATE USER 'learner'@'localhost' IDENTIFIED BY '';",
    "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON dialect_lab.* TO 'learner'@'localhost';",
    'FLUSH PRIVILEGES;'
  ].join('\n') });
  const baseArgs = [`--socket=${socket}`, '--protocol=SOCKET', '-ulearner', '--database=dialect_lab', '--batch', '--raw', '--connect-timeout=2', '--default-character-set=utf8mb4'];
  const sessionPrefix = `SET SESSION time_zone = '+00:00'; SET SESSION max_execution_time = ${timeoutMs};\n`;
  return {
    version: command(client, [...baseArgs, '--skip-column-names', '-e', 'SELECT VERSION();']).trim(),
    setup(sql) { command(client, baseArgs, { input: `${sessionPrefix}${sql}`, timeout: timeoutMs }); },
    execute(sql) {
      const parsed = parseTsv(command(client, baseArgs, { input: `${sessionPrefix}${sql}`, timeout: timeoutMs }));
      if (mode === 'plan' && parsed.length > 1 && parsed.every(row => row.length === 1)) {
        return { columns: [String(parsed[0][0])], rows: [[parsed.slice(1).map(row => String(row[0] ?? '')).join('\n')]] };
      }
      return parsed.length ? { columns: parsed[0].map(String), rows: parsed.slice(1).map(row => row.map(value => typeof value === 'string' ? normalizeValue(value) : value)) } : { columns: [], rows: [] };
    },
    session() { return new InteractiveSession(client, [...baseArgs, '--unbuffered', '--skip-column-names', '--silent'], {}); },
    sessionPrelude: `SET SESSION time_zone = '+00:00'; SET SESSION max_execution_time = ${timeoutMs};`,
    stop() {
      try { command(admin, [`--socket=${socket}`, '-uroot', '--connect-timeout=1', 'shutdown'], { timeout: 5_000 }); } catch {}
      try { child.kill('SIGKILL'); } catch {}
    }
  };
}

function lastInteger(output, fallback) {
  const matches = String(output).match(/-?\d+/g);
  if (!matches?.length) {
    if (fallback !== undefined) return fallback;
    fail('Transaction statement did not return an integer outcome', 'engine_error');
  }
  return Number(matches.at(-1));
}
async function transactionOutput(runtime, request) {
  const a = runtime.session(), b = runtime.session();
  try {
    await a.exec(runtime.sessionPrelude, request.timeoutMs);
    await b.exec(runtime.sessionPrelude, request.timeoutMs);
    await a.exec('BEGIN;', request.timeoutMs);
    await b.exec('BEGIN;', request.timeoutMs);

    if (request.transactionKind === 'optimistic-conflict') {
      const aVersion = lastInteger(await a.exec('SELECT version FROM ticket_versions WHERE ticket_id=1002;', request.timeoutMs));
      const bVersion = lastInteger(await b.exec('SELECT version FROM ticket_versions WHERE ticket_id=1002;', request.timeoutMs));
      if (aVersion !== 7 || bVersion !== 7) fail('Both sessions must observe version 7 before the write', 'engine_error');
      const aAffected = lastInteger(await a.exec(request.learnerSql, request.timeoutMs), 0);
      await a.exec('COMMIT;', request.timeoutMs);
      const bAffected = lastInteger(await b.exec(request.learnerSql, request.timeoutMs), 0);
      await b.exec('COMMIT;', request.timeoutMs);
      return { columns: ['session', 'outcome'], rows: [['A', aAffected > 0 ? 'updated' : 'conflict'], ['B', bAffected > 0 ? 'updated' : 'conflict']] };
    }

    if (request.transactionKind === 'skip-locked') {
      const aJob = lastInteger(await a.exec(request.learnerSql, request.timeoutMs));
      const bJob = lastInteger(await b.exec(request.learnerSql, request.timeoutMs));
      await b.exec('COMMIT;', request.timeoutMs);
      await a.exec('COMMIT;', request.timeoutMs);
      return { columns: ['session', 'job_id'], rows: [['A', aJob], ['B', bJob]] };
    }
    fail('Unsupported transaction contract', 'invalid_request');
  } finally {
    try { await a.exec('ROLLBACK;', 500); } catch {}
    try { await b.exec('ROLLBACK;', 500); } catch {}
    await Promise.all([a.close(), b.close()]);
  }
}

function readRequest(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength > MAX_REQUEST_BYTES) fail('Request is too large', 'invalid_request');
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value || value.version !== 1 || !['postgresql', 'mysql'].includes(value.engine)) fail('Unsupported request', 'invalid_request');
  const mode = ['query', 'mutation', 'plan', 'transaction'].includes(value.mode) ? value.mode : 'query';
  const transactionKind = value.transactionKind === 'optimistic-conflict' || value.transactionKind === 'skip-locked' ? value.transactionKind : null;
  if (mode === 'transaction' && !transactionKind) fail('Transaction kind is required', 'invalid_request');
  return {
    version: 1, requestId: safeId(value.requestId), engine: value.engine, mode, transactionKind,
    setupSql: boundedSql(value.setupSql, 'setupSql'), learnerSql: boundedSql(value.learnerSql, 'learnerSql'),
    verificationSql: value.verificationSql ? boundedSql(value.verificationSql, 'verificationSql') : null,
    timeoutMs: boundedInteger(value.timeoutMs, DEFAULT_TIMEOUT_MS, 250, 10_000),
    maximumRows: boundedInteger(value.maximumRows, 200, 1, 500),
    maximumCellBytes: boundedInteger(value.maximumCellBytes, 16_000, 64, 32_000),
    maximumResultBytes: boundedInteger(value.maximumResultBytes, 256_000, 1_024, 512_000)
  };
}

const requestPath = process.argv[2], resultPath = process.argv[3];
if (!requestPath || !resultPath) fail('Usage: runner.mjs <request.json> <result.json>', 'invalid_request');
const startedAt = Date.now();
let runtime = null, root = null, request = null;
try {
  request = readRequest(requestPath);
  root = `/tmp/sql-academy-${request.requestId}`;
  mkdirSync(root, { recursive: true, mode: 0o755 });
  runtime = request.engine === 'postgresql' ? postgresRuntime(root, request.timeoutMs, request.mode) : mysqlRuntime(root, request.timeoutMs, request.mode);
  runtime.setup(request.setupSql);
  const learnerOutput = request.mode === 'transaction' ? await transactionOutput(runtime, request) : runtime.execute(request.learnerSql);
  const verifiedOutput = request.mode !== 'transaction' && request.verificationSql ? runtime.execute(request.verificationSql) : learnerOutput;
  const output = boundedTable(verifiedOutput.columns, verifiedOutput.rows, request);
  writePrivate(resultPath, JSON.stringify({ version: 1, runnerVersion: RUNNER_VERSION, engine: request.engine, serverVersion: runtime.version, success: true, durationMs: Math.max(1, Date.now() - startedAt), output }));
} catch (error) {
  writePrivate(resultPath, JSON.stringify({ version: 1, runnerVersion: RUNNER_VERSION, engine: request?.engine, success: false, durationMs: Math.max(1, Date.now() - startedAt), errorCode: typeof error?.code === 'string' ? error.code : 'runner_error', error: sanitizeEngineError(error instanceof Error ? error.message : String(error)) }));
  process.exitCode = 1;
} finally {
  try { runtime?.stop(); } catch {}
  if (root) try { rmSync(root, { recursive: true, force: true }); } catch {}
}
