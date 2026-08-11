import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectPort = 8792;
const headroomUrl = 'http://127.0.0.1:8787/readyz';

function listener() {
  if (process.platform !== 'win32') throw new Error('This ownership probe is Windows-specific');
  const script = `$listener = Get-NetTCPConnection -LocalPort ${projectPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($listener) { $process = Get-Process -Id $listener.OwningProcess; [pscustomobject]@{ port = $listener.LocalPort; pid = $listener.OwningProcess; process = $process.ProcessName } | ConvertTo-Json -Compress }`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) return null;
  assert.equal(result.status, 0, `listener probe failed: ${result.stderr}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

async function headroomReady() {
  const response = await fetch(headroomUrl, { signal: AbortSignal.timeout(5_000) });
  const body = await response.json();
  return response.ok && body?.ready === true && body?.service === 'headroom-proxy';
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}

assert.equal(listener(), null, `project port ${projectPort} was occupied before the test`);
assert.equal(await headroomReady(), true, 'Headroom was not healthy before Playwright');

const child = spawn(process.execPath, [
  require.resolve('./playwright-runner.mjs'),
  '--project=desktop-foundation',
  'tests/e2e/academy.spec.ts'
], {
  cwd: new URL('../', import.meta.url),
  env: { ...process.env, PLAYWRIGHT_WORKER_PORT: String(projectPort) },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => {
  stdout += chunk;
  process.stdout.write(chunk);
});
child.stderr.on('data', chunk => {
  stderr += chunk;
  process.stderr.write(chunk);
});

const childExit = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
const timeout = new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error('Playwright isolation probe timed out')), 150_000);
  timer.unref();
});

function terminateOwnedProbe() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    if (result.status === 0) return;
  }
  child.kill('SIGTERM');
}

let during = null;
let exitCode = null;
let failure = null;
try {
  during = await waitFor(() => listener(), 45_000);
  assert.ok(during, `project port ${projectPort} never acquired a listener`);
  assert.equal(await headroomReady(), true, 'Headroom became unhealthy while Playwright owned its isolated port');
  exitCode = await Promise.race([childExit, timeout]);
  assert.equal(exitCode, 0, `Playwright isolation probe failed:\n${stdout}\n${stderr}`);
} catch (error) {
  failure = error;
} finally {
  terminateOwnedProbe();
  await Promise.race([
    childExit.catch(() => null),
    new Promise(resolve => setTimeout(resolve, 5_000))
  ]);
}

const listenerAfter = await waitFor(() => Promise.resolve(listener() === null), 20_000);
assert.equal(listenerAfter, true, `listener on ${projectPort} survived owned teardown`);
assert.equal(await headroomReady(), true, 'Headroom was not healthy after Playwright teardown');
if (failure) throw failure;

process.stdout.write(`Playwright port isolation passed: before=free; during=${during.process} pid=${during.pid} port=${during.port}; after=free; Headroom 8787 healthy before/during/after.\n`);
