import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const smoke = readFileSync(new URL('./dialect-labs-free-production-smoke.ts', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/cloudflare.yml', import.meta.url), 'utf8');

assert.ok(smoke.includes("stage(`preview ${caseId}`)"), 'Production smoke does not expose the exact failing lab and dialect');
assert.ok(smoke.includes("writeFileSync('cloudflare-dialect-current-case.txt'"), 'Current preview case is not persisted for failure artifacts');
assert.ok(smoke.includes('cloudflare-dialect-preview-${safeId}.json'), 'Per-case preview diagnostics are not persisted');
assert.ok(smoke.includes("'cf-ray'"), 'Cloudflare Ray ID is not captured');
assert.ok(smoke.includes("'x-request-id'"), 'Application request ID is not captured');
assert.ok(smoke.includes('body: response.body'), 'Failure response body is not preserved');
assert.ok(smoke.includes('caseId,'), 'Request diagnostics are not linked to a preview case');
assert.ok(smoke.includes('attempts: 2'), 'Server preview requests have no bounded retry for transient 5xx responses');
assert.ok(smoke.includes('body=${response.body.slice(0, 1200)}'), 'Thrown smoke error still hides the response body');
assert.ok(smoke.includes("response.headers['cf-ray']"), 'Thrown smoke error does not read the Cloudflare Ray ID');
assert.ok(smoke.includes('${ray} body='), 'Thrown smoke error does not include the captured Cloudflare Ray ID');
assert.ok(workflow.includes('cloudflare-*.json'), 'Deployment failure artifact does not include per-case JSON diagnostics');
assert.ok(workflow.includes('cloudflare-*.txt'), 'Deployment failure artifact does not include current-case and stage diagnostics');
assert.ok(workflow.includes('cloudflare-*.log'), 'Deployment failure artifact does not include deployment logs');

console.log('Dialect preview observability validated: exact case, bounded retry, response body, Cloudflare IDs and deployment artifacts are preserved.');
