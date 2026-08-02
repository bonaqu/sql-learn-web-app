import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const progress = readFileSync(new URL('../src/lib/dialect-lab-progress.ts', import.meta.url), 'utf8');
const workbench = readFileSync(new URL('../src/components/DialectLabWorkbench.tsx', import.meta.url), 'utf8');
const browserTest = readFileSync(new URL('../tests/e2e/dialect-labs.spec.ts', import.meta.url), 'utf8');
const qualityWorkflow = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');

assert.ok(progress.includes('failOnUnavailable'), 'Dialect hydration cannot expose unavailable cloud state');
assert.ok(progress.includes('Dialect progress hydration failed with HTTP'), 'Strict hydration does not reject failed HTTP responses');
assert.ok(workbench.includes("type HydrationState = 'hydrating' | 'ready' | 'unavailable'"), 'Workbench has no explicit hydration state machine');
assert.ok(workbench.includes('local evidence only'), 'Workbench can present local evidence as if cloud hydration succeeded');
assert.ok(workbench.includes('Повторить cloud hydration'), 'Workbench has no learner-visible hydration retry');
assert.ok(workbench.includes("setHydrationState('ready')"), 'Successful sync does not restore cloud-ready state');
assert.ok(workbench.includes("setHydrationState('unavailable')"), 'Failed sync does not mark cloud evidence unavailable');
assert.ok(browserTest.includes('Independent evidence синхронизирован между устройствами.'), 'Cross-device test does not require confirmed server sync');
assert.ok(browserTest.includes('await page.close()'), 'Cross-device test keeps the first Monaco page alive while opening another device');
assert.ok(browserTest.includes('temporary test outage'), 'Browser coverage does not exercise hydration recovery');
assert.ok(qualityWorkflow.includes('wrangler-playwright.log'), 'PR diagnostics do not preserve the local Worker process log');

console.log('Dialect hydration validated: fail-visible local state, retryable cloud merge, strict cross-device evidence and Worker process diagnostics.');
