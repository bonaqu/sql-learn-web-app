import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const entrypoint = read('worker/entrypoint.ts');
const workerIndex = read('worker/index.ts');
const wrangler = JSON.parse(read('wrangler.jsonc'));
const typegen = JSON.parse(read('wrangler.typegen.jsonc'));
const productionWorkflow = read('.github/workflows/cloudflare.yml');
const stagingRenderer = read('scripts/render-staging-wrangler.mjs');
const manifest = JSON.parse(read('package.json'));

const SANDBOX_EXPORT = "export { Sandbox } from '@cloudflare/sandbox';";

assert.equal(wrangler.main, 'worker/entrypoint.ts', 'Default Wrangler config must use the compatibility entrypoint');
assert.equal(typegen.main, 'worker/entrypoint.ts', 'Worker type generation must use the compatibility entrypoint');
assert.ok(productionWorkflow.includes("main: 'worker/entrypoint.ts'"), 'Production deploy must use the compatibility entrypoint');
assert.ok(stagingRenderer.includes("main: 'worker/entrypoint.ts'"), 'Staging deploy must use the compatibility entrypoint');
assert.ok(entrypoint.includes(SANDBOX_EXPORT), 'Active Worker entrypoint must preserve the historical Sandbox Durable Object export');
assert.equal((entrypoint.match(/export \{ Sandbox \} from '@cloudflare\/sandbox';/g) || []).length, 1,
  'Active Worker entrypoint must expose exactly one direct Sandbox export');
assert.ok(workerIndex.includes(SANDBOX_EXPORT), 'Canonical HTTP Worker module must retain its Sandbox export');
assert.equal(manifest.dependencies?.['@cloudflare/sandbox'], '0.10.3',
  'Historical Sandbox export must remain backed by the reviewed pinned runtime package');
assert.ok(!JSON.stringify(wrangler).includes('durable_objects'),
  'Free-tier config must not recreate a Sandbox binding; the export exists only for deployment compatibility');
assert.ok(entrypoint.indexOf(SANDBOX_EXPORT) < entrypoint.indexOf('export default'),
  'Named Durable Object export must remain a top-level module export before the default handler');

console.log('Worker entrypoint compatibility validated: the active production/staging module preserves the historical Sandbox Durable Object export without re-enabling a free-tier binding.');
