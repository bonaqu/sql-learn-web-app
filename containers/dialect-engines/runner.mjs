#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, chownSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const RUNNER_VERSION = 'dialect-real-engine-v1';
const MAX_REQUEST_BYTES = 96_000;
const MAX_SQL_BYTES = 24_000;
const DEFAULT_TIMEOUT_MS = 4_000;
const STARTUP_TIMEOUT_MS = 30_000;

function fail(message, code = 'runner_error') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function boundedInteger(value, fallback, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

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

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    encoding: 'utf8',
    maxBuffer: 2_000_000,
    timeout: options.timeout ?? STARTUP_TIMEOUT_MS,
    input: options.input,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(sanitizeEngineError(result.stderr || result.stdout || `${commandName} failed`));
    error.code = result.signal === 'SIGTERM' || result.signal === 'SIGKILL' ? 'engine_timeout' : 'engine_error';
    throw error;
  }
  return result.stdout || '';
}

function commandPath(name) {
  return command('sh', ['-lc', `command -v ${name}`]).trim();
}

function sanitizeEngineError(value) {
  return String(value)
    .replace(/^LINE\s+\d+:.*$/gim, '')
    .replace(/^.*at line \d+.*$/gim, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || 'Database engine rejected the statement';
}

function writePrivate(path, content) {
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(item => item.some(value => value.length));
}

function parseTsv(source) {
  return source
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => line.split('\t').map(value => value === 'NULL' ? null : value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')));
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

function boundedTable(columns, rows, limits) {
  const selectedRows = rows.slice(0, limits.maximumRows).map(row => row.map(value => {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    return Buffer.byteLength(String(value), 'utf8') <= limits.maximumCellBytes
      ? String(value)
      : `${String(value).slice(0, Math.max(0, limits.maximumCellBytes - 16))}…[truncated]`;
  }));
  const output = { columns, rows: selectedRows, truncated: rows.length > selectedRows.length };
  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized, 'utf8') > limits.maximumResultBytes) fail('Result exceeds the published size limit', 'result_too_large');
  return output;
}

function waitFor(check, timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      check();
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
  fail('Database engine did not become ready', 'engine_startup_timeout');
}

function postgresRuntime(root, timeoutMs) {
  const data = `${root}/pgdata`;
  const socket = `${root}/pgsocket`;
  const pgBin = command('pg_config', ['--bindir']).trim();
  mkdirSync(data, { recursive: true });
  mkdirSync(socket, { recursive: true });
  const postgresUid = Number(command('id', ['-u', 'postgres']).trim());
  const postgresGid = Number(command('id', ['-g', 'postgres']).trim());
  chownSync(data, postgresUid, postgresGid);
  chownSync(socket, postgresUid, postgresGid);

  command('runuser', ['-u', 'postgres', '--', `${pgBin}/initdb`, '-D', data, '--auth=trust', '--encoding=UTF8', '--no-locale']);
  command('runuser', ['-u', 'postgres', '--', `${pgBin}/pg_ctl`, '-D', data, '-w', 'start', '-o', `-F -k ${socket} -p 55432 -c listen_addresses='' -c statement_timeout=${timeoutMs}`]);
  command(`${pgBin}/psql`, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55432', '-U', 'postgres', '-d', 'postgres'], {
    input: "CREATE ROLE learner LOGIN;\nCREATE DATABASE dialect_lab OWNER learner;\n"
  });

  const baseArgs = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55432', '-U', 'learner', '-d', 'dialect_lab'];
  return {
    version: command(`${pgBin}/psql`, [...baseArgs, '-Atc', 'SHOW server_version;']).trim(),
    setup(sql) {
      command(`${pgBin}/psql`, [...baseArgs, '-q'], { input: sql, timeout: timeoutMs });
    },
    execute(sql) {
      const source = command(`${pgBin}/psql`, [...baseArgs, '--csv', '-q'], { input: sql, timeout: timeoutMs });
      const parsed = parseCsv(source);
      if (!parsed.length) return { columns: [], rows: [] };
      return { columns: parsed[0], rows: parsed.slice(1).map(row => row.map(value => normalizeValue(value))) };
    },
    stop() {
      try { command('runuser', ['-u', 'postgres', '--', `${pgBin}/pg_ctl`, '-D', data, '-m', 'immediate', '-w', 'stop']); } catch {}
    }
  };
}

function mysqlRuntime(root, timeoutMs) {
  const data = `${root}/mysql`;
  const socket = `${root}/mysql.sock`;
  const pidFile = `${root}/mysql.pid`;
  mkdirSync(data, { recursive: true });
  const mysqlUid = Number(command('id', ['-u', 'mysql']).trim());
  const mysqlGid = Number(command('id', ['-g', 'mysql']).trim());
  chownSync(data, mysqlUid, mysqlGid);
  const install = commandPath('mariadb-install-db');
  command('runuser', ['-u', 'mysql', '--', install, `--datadir=${data}`, '--auth-root-authentication-method=normal', '--skip-test-db']);
  const server = commandPath('mariadbd');
  const child = spawn('runuser', ['-u', 'mysql', '--', server,
    `--datadir=${data}`,
    `--socket=${socket}`,
    `--pid-file=${pidFile}`,
    '--skip-networking',
    '--skip-log-bin',
    '--log-error-verbosity=2'
  ], { stdio: 'ignore' });

  const client = commandPath('mariadb');
  waitFor(() => command(client, [`--socket=${socket}`, '-uroot', '-e', 'SELECT 1;'], { timeout: 1_000 }));
  command(client, [`--socket=${socket}`, '-uroot'], {
    input: "CREATE DATABASE dialect_lab CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;\nCREATE USER 'learner'@'localhost';\nGRANT ALL PRIVILEGES ON dialect_lab.* TO 'learner'@'localhost';\nFLUSH PRIVILEGES;\n"
  });
  const baseArgs = [`--socket=${socket}`, '-ulearner', '--database=dialect_lab', '--batch', '--raw'];
  return {
    version: command(client, [...baseArgs, '--skip-column-names', '-e', 'SELECT VERSION();']).trim(),
    setup(sql) {
      command(client, baseArgs, { input: sql, timeout: timeoutMs });
    },
    execute(sql) {
      const source = command(client, baseArgs, { input: sql, timeout: timeoutMs });
      const parsed = parseTsv(source);
      if (!parsed.length) return { columns: [], rows: [] };
      return { columns: parsed[0].map(String), rows: parsed.slice(1).map(row => row.map(value => typeof value === 'string' ? normalizeValue(value) : value)) };
    },
    stop() {
      try { command(commandPath('mariadb-admin'), [`--socket=${socket}`, '-uroot', 'shutdown']); } catch {}
      try { child.kill('SIGKILL'); } catch {}
    }
  };
}

function readRequest(path) {
  const bytes = readFileSync(path);
  if (bytes.byteLength > MAX_REQUEST_BYTES) fail('Request is too large', 'invalid_request');
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value || value.version !== 1 || !['postgresql', 'mysql'].includes(value.engine)) fail('Unsupported request', 'invalid_request');
  return {
    version: 1,
    requestId: safeId(value.requestId),
    engine: value.engine,
    mode: ['query', 'mutation', 'plan'].includes(value.mode) ? value.mode : 'query',
    setupSql: boundedSql(value.setupSql, 'setupSql'),
    learnerSql: boundedSql(value.learnerSql, 'learnerSql'),
    verificationSql: value.verificationSql ? boundedSql(value.verificationSql, 'verificationSql') : null,
    timeoutMs: boundedInteger(value.timeoutMs, DEFAULT_TIMEOUT_MS, 250, 10_000),
    maximumRows: boundedInteger(value.maximumRows, 200, 1, 500),
    maximumCellBytes: boundedInteger(value.maximumCellBytes, 16_000, 64, 32_000),
    maximumResultBytes: boundedInteger(value.maximumResultBytes, 256_000, 1_024, 512_000)
  };
}

const requestPath = process.argv[2];
const resultPath = process.argv[3];
if (!requestPath || !resultPath) fail('Usage: runner.mjs <request.json> <result.json>', 'invalid_request');

const startedAt = Date.now();
let runtime = null;
let root = null;
try {
  const request = readRequest(requestPath);
  root = `/tmp/sql-academy-${request.requestId}`;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  runtime = request.engine === 'postgresql'
    ? postgresRuntime(root, request.timeoutMs)
    : mysqlRuntime(root, request.timeoutMs);
  runtime.setup(request.setupSql);
  const learnerOutput = runtime.execute(request.learnerSql);
  const verifiedOutput = request.verificationSql ? runtime.execute(request.verificationSql) : learnerOutput;
  const output = boundedTable(verifiedOutput.columns, verifiedOutput.rows, request);
  writePrivate(resultPath, JSON.stringify({
    version: 1,
    runnerVersion: RUNNER_VERSION,
    engine: request.engine,
    serverVersion: runtime.version,
    success: true,
    durationMs: Math.max(1, Date.now() - startedAt),
    output
  }));
} catch (error) {
  writePrivate(resultPath, JSON.stringify({
    version: 1,
    runnerVersion: RUNNER_VERSION,
    success: false,
    durationMs: Math.max(1, Date.now() - startedAt),
    errorCode: typeof error?.code === 'string' ? error.code : 'runner_error',
    error: sanitizeEngineError(error instanceof Error ? error.message : String(error))
  }));
  process.exitCode = 1;
} finally {
  try { runtime?.stop(); } catch {}
  if (root) {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  }
}
