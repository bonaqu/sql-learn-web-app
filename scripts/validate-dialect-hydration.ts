import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const progress = readFileSync(new URL('../src/lib/dialect-lab-progress.ts', import.meta.url), 'utf8');
const workbench = readFileSync(new URL('../src/components/DialectLabWorkbench.tsx', import.meta.url), 'utf8');
const browserTest = readFileSync(new URL('../tests/e2e/dialect-labs.spec.ts', import.meta.url), 'utf8');
const qualityWorkflow = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

assert.ok(progress.includes('failOnUnavailable'), 'Dialect hydration cannot expose unavailable cloud state');
assert.ok(progress.includes('Dialect progress hydration failed with HTTP'), 'Strict hydration does not reject failed HTTP responses');
assert.ok(progress.includes('DIALECT_TRANSPORT_RETRY_DELAYS_MS'), 'Dialect cloud transport has no explicit bounded retry schedule');
assert.ok(progress.includes('[250, 500, 1_000, 1_500, 2_000, 2_500]'), 'Dialect retry schedule is not bounded or reviewable');
assert.ok(progress.includes('transportAttempt <= DIALECT_TRANSPORT_RETRY_DELAYS_MS.length'), 'Dialect transport retry loop is not bounded');
assert.ok(progress.includes('isTransientDialectStatus'), 'Dialect recovery does not classify transient responses');
assert.ok(progress.includes('status === 408 || status === 425 || status === 429 || status >= 500'), 'Dialect recovery may retry permanent client failures');
assert.ok(progress.includes("response.status !== 429"), 'Dialect recovery does not handle Retry-After separately');
assert.ok(progress.includes('MAX_RETRY_AFTER_MS = 3_000'), 'Server Retry-After can stall dialect hydration without a cap');
assert.ok(progress.includes('Dialect progress transport recovery exhausted'), 'Transport retry exhaustion is not visible');
assert.ok(progress.includes('fetchDialectProgressWithRecovery({'), 'Dialect sync does not use bounded transport recovery');
assert.ok(progress.includes('const response = await fetchDialectProgressWithRecovery();'), 'Dialect hydration does not use bounded transport recovery');
assert.ok(progress.includes('conflictAttempts >= 3'), '409 conflict retries lost their independent budget');
assert.ok(!progress.includes('conflictAttempts + transportAttempt'), 'Transport failures and semantic conflicts share one retry budget');
assert.ok(workbench.includes("type HydrationState = 'hydrating' | 'ready' | 'unavailable'"), 'Workbench has no explicit hydration state machine');
assert.ok(workbench.includes('local evidence only'), 'Workbench can present local evidence as if cloud hydration succeeded');
assert.ok(workbench.includes('Повторить cloud hydration'), 'Workbench has no learner-visible hydration retry');
assert.ok(workbench.includes("setHydrationState('ready')"), 'Successful sync does not restore cloud-ready state');
assert.ok(workbench.includes("setHydrationState('unavailable')"), 'Failed sync does not mark cloud evidence unavailable');
assert.ok(browserTest.includes('Independent evidence синхронизирован между устройствами.'), 'Cross-device test does not require confirmed server sync');
assert.ok(browserTest.includes('await page.close()'), 'Cross-device test keeps the first Monaco page alive while opening another device');
assert.ok(browserTest.includes('temporary test outage'), 'Browser coverage does not exercise hydration recovery');
assert.ok(qualityWorkflow.includes('wrangler-playwright.log'), 'PR diagnostics do not preserve the local Worker process log');
assert.ok(qualityWorkflow.includes('wrangler-internal-playwright.log'), 'PR diagnostics do not preserve Wrangler internal failures');

console.log('Dialect hydration validated: bounded transient recovery, separate conflict merge budget, fail-visible local state, strict cross-device evidence and Worker diagnostics.');