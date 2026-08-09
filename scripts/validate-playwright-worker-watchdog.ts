import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const watchdog = readFileSync(new URL('./playwright-worker-watchdog.mjs', import.meta.url), 'utf8');
const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../tests/e2e/auth-helper.ts', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

assert.ok(config.includes("command: 'node scripts/playwright-worker-watchdog.mjs'"), 'Playwright no longer launches the Worker through the watchdog');
assert.ok(!config.includes('npx wrangler dev --local'), 'Playwright config bypasses the watchdog with a direct Wrangler process');
assert.ok(config.includes('PLAYWRIGHT_WORKER_PORT'), 'Playwright health probe does not follow the configured Worker port');

assert.ok(watchdog.includes('PLAYWRIGHT_WORKER_RESTARTS'), 'Watchdog restart budget is not configurable');
assert.ok(watchdog.includes('PLAYWRIGHT_WORKER_PORT'), 'Watchdog Worker port is not configurable for occupied local ports');
assert.ok(watchdog.includes('configuredPort >= 1 && configuredPort <= 65_535'), 'Watchdog Worker port is not validated');
assert.ok(watchdog.includes('const command = process.execPath'), 'Watchdog must launch Wrangler through Node instead of a Windows .cmd shim');
assert.ok(watchdog.includes("require.resolve('wrangler')"), 'Watchdog must resolve the project-local Wrangler entrypoint');
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
assert.ok(auth.includes('response.status() >= 500'), 'Registration fixtures do not retry transient Worker 5xx responses');
assert.ok(auth.includes('testUsername(`${label}${attempt}`)'), 'Registration retry can reuse a partially accepted username');
assert.ok(auth.includes('postAfterWorkerRecovery'), 'Login fixtures do not wait for Worker recovery');
assert.ok(auth.includes('attempt <= WORKER_ATTEMPTS'), 'Auth fixture retry loop is not bounded');

assert.ok(workflow.includes('wrangler-playwright.log'), 'PR artifacts lost the public Worker log');
assert.ok(workflow.includes('wrangler-internal-playwright.log'), 'PR artifacts lost the internal Wrangler log');

console.log('Playwright Worker recovery validated: zero-to-five restarts, internal Wrangler diagnostics, clean shutdown and bounded auth retries.');
