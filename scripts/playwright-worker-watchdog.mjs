import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const outputLog = 'wrangler-playwright.log';
const internalLog = 'wrangler-internal-playwright.log';
const configuredRestarts = Number(process.env.PLAYWRIGHT_WORKER_RESTARTS || 2);
const maxRestarts = Math.min(5, Math.max(0, Number.isFinite(configuredRestarts) ? Math.floor(configuredRestarts) : 2));
const wranglerLogsDirectory = join(homedir(), '.config', '.wrangler', 'logs');
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  'wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--config', 'wrangler.jsonc'
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
  child = spawn(command, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    appendFileSync(outputLog, chunk);
  });
  child.stderr.on('data', chunk => {
    process.stderr.write(chunk);
    appendFileSync(outputLog, chunk);
  });
  child.on('error', error => {
    write(`Wrangler process error: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    captureInternalLogs();
    child = null;
    if (stopping) {
      process.exit(0);
      return;
    }
    if (restartCount < maxRestarts) {
      restartCount += 1;
      write(`Wrangler exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'none'}); restarting ${restartCount}/${maxRestarts}.`);
      setTimeout(launch, 500);
      return;
    }
    write(`Wrangler restart budget exhausted after code=${code ?? 'null'}, signal=${signal ?? 'none'}.`);
    process.exit(code || 1);
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  write(`Stopping Playwright Worker watchdog after ${signal}.`);
  captureInternalLogs();
  if (child) child.kill(signal);
  else process.exit(0);
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGHUP', () => stop('SIGHUP'));
process.on('exit', captureInternalLogs);

launch();
