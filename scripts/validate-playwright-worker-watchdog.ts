import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const watchdog = readFileSync(new URL('./playwright-worker-watchdog.mjs', import.meta.url), 'utf8');
const runner = readFileSync(new URL('./playwright-runner.mjs', import.meta.url), 'utf8');
const fullSuite = readFileSync(new URL('./playwright-full-suite.mjs', import.meta.url), 'utf8');
const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../tests/e2e/auth-helper.ts', import.meta.url), 'utf8');
const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
const e2eDirectory = fileURLToPath(new URL('../tests/e2e/', import.meta.url));
const e2eSources = readdirSync(e2eDirectory)
  .filter(name => name.endsWith('.ts'))
  .map(name => readFileSync(join(e2eDirectory, name), 'utf8'))
  .join('\n');

assert.ok(config.includes("command: 'node scripts/playwright-worker-watchdog.mjs'"), 'Playwright no longer launches the Worker through the watchdog');
assert.ok(!config.includes('npx wrangler dev --local'), 'Playwright config bypasses the watchdog with a direct Wrangler process');
assert.ok(config.includes('PLAYWRIGHT_WORKER_PORT'), 'Playwright health probe does not follow the configured Worker port');
assert.ok(config.includes("process.env.PLAYWRIGHT_WORKER_PORT || '8792'"), 'Direct Playwright runs can still collide with persistent port 8787');
assert.ok(runner.includes('FIRST_PROJECT_PORT = 8792'), 'Canonical Playwright runner does not start in the project-owned port range');
assert.ok(runner.includes('LAST_PROJECT_PORT = 8891'), 'Canonical Playwright runner has no bounded project-owned port range');
assert.ok(runner.includes('exclusive: true'), 'Canonical Playwright runner does not prove exclusive port availability');
assert.ok(fullSuite.includes("'desktop-foundation'"), 'Full E2E suite lost the desktop foundation project');
assert.ok(fullSuite.includes("'desktop-learning'"), 'Full E2E suite lost the desktop learning project');
assert.ok(fullSuite.includes("'mobile-foundation'"), 'Full E2E suite lost the mobile foundation project');
assert.ok(fullSuite.includes("'mobile-learning'"), 'Full E2E suite lost the mobile learning project');
assert.ok(fullSuite.includes("['1/2', '2/2']"), 'Full E2E suite no longer bounds preview and Worker session duration with two shards');
assert.ok(fullSuite.includes('await runPlaywright'), 'Full E2E shards bypass the canonical isolated runner');
assert.ok(vite.includes("target: `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT || '8792'}`"), 'Production preview does not proxy API calls to the selected Worker port');
assert.ok(!workflow.includes('VITE_API_BASE: http://127.0.0.1:8787'), 'PR Quality still compiles a fixed local Worker port into dist');
assert.ok(!e2eSources.includes('http://127.0.0.1:8787'), 'An E2E fixture still bypasses the selected Worker port');

assert.ok(watchdog.includes('PLAYWRIGHT_WORKER_RESTARTS'), 'Watchdog restart budget is not configurable');
assert.ok(watchdog.includes('PLAYWRIGHT_WORKER_PORT'), 'Watchdog Worker port is not configurable for occupied local ports');
assert.ok(watchdog.includes('configuredPort >= 1 && configuredPort <= 65_535'), 'Watchdog Worker port is not validated');
assert.ok(watchdog.includes('const command = process.execPath'), 'Watchdog must launch Wrangler through Node instead of a Windows .cmd shim');
assert.ok(watchdog.includes("require.resolve('wrangler')"), 'Watchdog must resolve the project-local Wrangler entrypoint');
assert.ok(watchdog.includes('PLAYWRIGHT_WORKER_ENTRYPOINT'), 'Watchdog has no deterministic injected-failure seam');
assert.ok(watchdog.includes("spawnSync('taskkill.exe'"), 'Windows teardown does not target the owned Wrangler process tree');
assert.ok(!watchdog.includes("'npx.cmd'"), 'Watchdog still uses the Node 24-incompatible Windows npx.cmd spawn path');
assert.ok(watchdog.includes('Math.min(5, Math.max(0'), 'Watchdog restart budget is not bounded between zero and five');
assert.ok(watchdog.includes('Number.isFinite(configuredRestarts)'), 'Watchdog does not reject a non-finite restart budget');
assert.ok(watchdog.includes('restartCount < maxRestarts'), 'Watchdog has no bounded restart condition');
assert.ok(watchdog.includes('restart budget exhausted'), 'Watchdog does not fail visibly after exhausting retries');
assert.ok(watchdog.includes("'.config', '.wrangler', 'logs'"), 'Watchdog does not inspect Wrangler internal logs');
assert.ok(watchdog.includes("const internalLog = 'wrangler-internal-playwright.log'"), 'Watchdog does not persist the internal Wrangler log');
assert.ok(watchdog.includes("process.on('SIGTERM'"), 'Watchdog does not handle Playwright shutdown');
assert.ok(watchdog.includes("process.on('SIGINT'"), 'Watchdog does not handle interactive shutdown');
assert.ok(watchdog.includes("child.kill(signal)"), 'Watchdog does not terminate the active Wrangler child');
assert.ok(watchdog.includes("setTimeout(launch, 500)"), 'Watchdog restart has no bounded backoff');

assert.ok(auth.includes('const WORKER_ATTEMPTS = 8'), 'Auth fixtures have no bounded Worker recovery budget');
assert.ok(auth.includes("process.env.PLAYWRIGHT_WORKER_PORT || '8792'"), 'Auth fixtures do not follow the isolated Worker port');
assert.ok(auth.includes('response.status() >= 500'), 'Registration fixtures do not retry transient Worker 5xx responses');
assert.ok(auth.includes('testUsername(`${label}${attempt}`)'), 'Registration retry can reuse a partially accepted username');
assert.ok(auth.includes('postAfterWorkerRecovery'), 'Login fixtures do not wait for Worker recovery');
assert.ok(auth.includes('attempt <= WORKER_ATTEMPTS'), 'Auth fixture retry loop is not bounded');

assert.ok(workflow.includes('wrangler-playwright.log'), 'PR artifacts lost the public Worker log');
assert.ok(workflow.includes('wrangler-internal-playwright.log'), 'PR artifacts lost the internal Wrangler log');

const watchdogPath = fileURLToPath(new URL('./playwright-worker-watchdog.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'sql-academy-watchdog-failure-'));
try {
  const fixture = join(scratch, 'injected-worker-failure.mjs');
  writeFileSync(fixture, "process.stderr.write('injected Wrangler failure: exit 23\\n'); process.exit(23);\n", 'utf8');
  const result = spawnSync(process.execPath, [watchdogPath], {
    cwd: scratch,
    env: {
      ...process.env,
      PLAYWRIGHT_WORKER_ENTRYPOINT: fixture,
      PLAYWRIGHT_WORKER_RESTARTS: '0',
      PLAYWRIGHT_WORKER_PORT: '65529'
    },
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(result.status, 23, `watchdog did not propagate injected exit 23:\n${output}`);
  assert.match(output, /injected Wrangler failure: exit 23/, 'watchdog lost the child stderr evidence');
  assert.match(output, /restart budget exhausted after code=23/, 'watchdog lost the exact child exit code');
  assert.match(output, /child pid=\d+ port=65529/, 'watchdog did not report owned child and port evidence');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write('Playwright Worker recovery validated: Node child launch, injected exit 23 propagation, project port, owned Windows process-tree teardown, bounded restarts and auth retries.\n');
