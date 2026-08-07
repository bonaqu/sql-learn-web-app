import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const entrypoint = read('worker/entrypoint.ts');
const workerIndex = read('worker/index.ts');
const wrangler = JSON.parse(read('wrangler.jsonc'));
const typegen = JSON.parse(read('wrangler.typegen.jsonc'));
const productionWorkflow = read('.github/workflows/cloudflare.yml');
const pagesWorkflow = read('.github/workflows/pages.yml');
const stagingWorkflow = read('.github/workflows/cloudflare-staging.yml');
const stagingRenderer = read('scripts/render-staging-wrangler.mjs');
const manifest = JSON.parse(read('package.json'));
const lockfile = JSON.parse(read('package-lock.json'));

const SANDBOX_VERSION = '0.12.4';
const SANDBOX_EXPORT = "export { Sandbox } from '@cloudflare/sandbox';";
const ENTRYPOINT_PREFLIGHT = 'node scripts/validate-worker-entrypoint-compatibility.mjs';

assert.equal(wrangler.main, 'worker/entrypoint.ts', 'Default Wrangler config must use the compatibility entrypoint');
assert.equal(typegen.main, 'worker/entrypoint.ts', 'Worker type generation must use the compatibility entrypoint');
assert.ok(productionWorkflow.includes("main: 'worker/entrypoint.ts'"), 'Production deploy must use the compatibility entrypoint');
assert.ok(stagingRenderer.includes("main: 'worker/entrypoint.ts'"), 'Staging deploy must use the compatibility entrypoint');
assert.ok(entrypoint.includes(SANDBOX_EXPORT), 'Active Worker entrypoint must preserve the historical Sandbox Durable Object export');
assert.equal((entrypoint.match(/export \{ Sandbox \} from '@cloudflare\/sandbox';/g) || []).length, 1,
  'Active Worker entrypoint must expose exactly one direct Sandbox export');
assert.ok(workerIndex.includes(SANDBOX_EXPORT), 'Canonical HTTP Worker module must retain its Sandbox export');
assert.equal(manifest.dependencies?.['@cloudflare/sandbox'], SANDBOX_VERSION,
  'Historical Sandbox export must remain backed by the reviewed exact runtime package');
assert.equal(lockfile.packages?.['node_modules/@cloudflare/sandbox']?.version, SANDBOX_VERSION,
  'Sandbox package-lock entry must match the reviewed exact runtime package');
assert.match(lockfile.packages?.['node_modules/@cloudflare/sandbox']?.integrity || '', /^sha512-/,
  'Sandbox package-lock entry must retain npm integrity evidence');
for (const source of [entrypoint, workerIndex]) {
  assert.doesNotMatch(source, /\bsandbox\.desktop\b|\bDesktopClient\b|\bDesktopSession\b/,
    'Sandbox 0.12 removed desktop APIs; the compatibility entrypoint must not depend on them');
}
assert.ok(!JSON.stringify(wrangler).includes('durable_objects'),
  'Free-tier config must not recreate a Sandbox binding; the export exists only for deployment compatibility');
assert.ok(entrypoint.indexOf(SANDBOX_EXPORT) < entrypoint.indexOf('export default'),
  'Named Durable Object export must remain a top-level module export before the default handler');
assert.ok(manifest.scripts?.['validate:deployment-smoke']?.startsWith(`${ENTRYPOINT_PREFLIGHT} && `),
  'Every repository deployment-smoke validation must begin with the active-entrypoint compatibility preflight');
assert.ok(manifest.scripts?.check?.includes('npm run validate:deployment-smoke'),
  'The canonical repository check must include deployment-smoke validation');
for (const scriptName of ['deploy:cloudflare', 'deploy:cloudflare:dry']) {
  assert.ok(manifest.scripts?.[scriptName]?.startsWith(`${ENTRYPOINT_PREFLIGHT} && `),
    `${scriptName} must fail before build or Wrangler when the active entrypoint is incompatible`);
}
for (const [name, workflow] of [
  ['Cloudflare production', productionWorkflow],
  ['GitHub Pages production', pagesWorkflow],
  ['Cloudflare staging', stagingWorkflow]
]) {
  assert.ok(workflow.includes('npm run check'), `${name} deployment must run the canonical repository check`);
}

console.log(`Worker entrypoint compatibility validated: Sandbox ${SANDBOX_VERSION} preserves the historical Durable Object export, desktop APIs are absent, and free-tier bindings remain disabled.`);
