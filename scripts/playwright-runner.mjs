import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HOST = '127.0.0.1';
const FIRST_PROJECT_PORT = 8792;
const LAST_PROJECT_PORT = 8891;
const require = createRequire(import.meta.url);

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function canListen(port) {
  return new Promise(resolve => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: HOST, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function selectWorkerPort(preferred = process.env.PLAYWRIGHT_WORKER_PORT) {
  if (preferred) {
    const configured = parsePort(preferred);
    if (!configured) throw new Error(`PLAYWRIGHT_WORKER_PORT must be an integer from 1 to 65535, got ${preferred}`);
    if (!(await canListen(configured))) throw new Error(`PLAYWRIGHT_WORKER_PORT ${configured} is already in use`);
    return configured;
  }

  for (let port = FIRST_PROJECT_PORT; port <= LAST_PROJECT_PORT; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free project-owned Worker port in ${FIRST_PROJECT_PORT}-${LAST_PROJECT_PORT}`);
}

export async function runPlaywright(args = process.argv.slice(2)) {
  const workerPort = await selectWorkerPort();
  process.stdout.write(`Playwright runner selected project-owned Worker port ${workerPort}; persistent service port 8787 is untouched.\n`);

  const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...args], {
    env: { ...process.env, PLAYWRIGHT_WORKER_PORT: String(workerPort) },
    stdio: 'inherit',
    windowsHide: true
  });

  const forward = signal => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  process.once('SIGINT', () => forward('SIGINT'));
  process.once('SIGTERM', () => forward('SIGTERM'));

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Playwright exited after signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runPlaywright();
  } catch (error) {
    process.stderr.write(`Playwright runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
