import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const outputLog = 'wrangler-playwright.log';
const internalLog = 'wrangler-internal-playwright.log';
const configuredRestarts = Number(process.env.PLAYWRIGHT_WORKER_RESTARTS || 2);
const maxRestarts = Math.min(5, Math.max(0, Number.isFinite(configuredRestarts) ? Math.floor(configuredRestarts) : 2));
const configuredPort = Number(process.env.PLAYWRIGHT_WORKER_PORT || 8792);
const workerPort = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65_535 ? configuredPort : 8792;
const wranglerLogsDirectory = join(homedir(), '.config', '.wrangler', 'logs');
const require = createRequire(import.meta.url);
const command = process.execPath;
const workerEntrypoint = process.env.PLAYWRIGHT_WORKER_ENTRYPOINT
  ? resolve(process.env.PLAYWRIGHT_WORKER_ENTRYPOINT)
  : require.resolve('wrangler');
const args = [
  workerEntrypoint, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(workerPort), '--config', 'wrangler.jsonc'
];

let child = null;
let restartCount = 0;
let stopping = false;
let sessionStartedAt = Date.now();
const copiedInternalLogs = new Set();

function write(message) {
  const line = message.endsWith('\n') ? message : `${message}\n`;
  process.stdout.write(line);
  appendFileSync(outputLog, line);
}

function captureInternalLogs() {
  if (!existsSync(wranglerLogsDirectory)) return;
  const candidates = readdirSync(wranglerLogsDirectory)
    .map(name => join(wranglerLogsDirectory, name))
    .filter(path => {
      try {
        return statSync(path).isFile() && statSync(path).mtimeMs >= sessionStartedAt - 2_000;
      } catch {
        return false;
      }
    })
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs);

  for (const path of candidates) {
    if (copiedInternalLogs.has(path)) continue;
    copiedInternalLogs.add(path);
    try {
      appendFileSync(internalLog, `\n===== ${path} =====\n${readFileSync(path, 'utf8')}\n`);
    } catch (error) {
      appendFileSync(internalLog, `\nUnable to copy ${path}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

function launch() {
  sessionStartedAt = Date.now();
  write(`\n===== Playwright Worker session ${restartCount + 1}/${maxRestarts + 1} =====`);
  const launched = spawn(command, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child = launched;
  write(`Playwright Worker child pid=${launched.pid ?? 'unavailable'} port=${workerPort} entrypoint=${workerEntrypoint}`);
  let settled = false;

  launched.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    appendFileSync(outputLog, chunk);
  });
  launched.stderr.on('data', chunk => {
    process.stderr.write(chunk);
    appendFileSync(outputLog, chunk);
  });

  const finish = (code, signal, detail = '') => {
    if (settled) return;
    settled = true;
    captureInternalLogs();
    child = null;
    if (stopping) {
      process.exit(0);
      return;
    }
    if (restartCount < maxRestarts) {
      restartCount += 1;
      write(`Wrangler exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'none'}${detail}); restarting ${restartCount}/${maxRestarts}.`);
      setTimeout(launch, 500);
      return;
    }
    write(`Wrangler restart budget exhausted after code=${code ?? 'null'}, signal=${signal ?? 'none'}${detail}.`);
    process.exit(code || 1);
  };

  launched.on('error', error => {
    write(`Wrangler process error: ${error.message}`);
    finish(1, null, `, error=${error.message}`);
  });
  launched.on('exit', (code, signal) => finish(code, signal));
}

function terminateOwnedChild(signal) {
  if (!child) return;
  if (process.platform === 'win32' && child.pid) {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (result.status === 0) return;
    write(`Owned process-tree cleanup fallback after taskkill status=${result.status ?? 'null'}.`);
  }
  child.kill(signal);
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  write(`Stopping Playwright Worker watchdog after ${signal}.`);
  captureInternalLogs();
  if (child) terminateOwnedChild(signal);
  else process.exit(0);
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGHUP', () => stop('SIGHUP'));
process.on('exit', captureInternalLogs);

launch();
