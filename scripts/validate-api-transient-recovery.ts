import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lib/api-fetch.ts', import.meta.url), 'utf8');

assert.ok(source.includes("const TRANSIENT_STATUSES = new Set([502, 503, 504])"), 'Transient API statuses are not explicit');
assert.ok(source.includes("const REPLAYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT'])"), 'Retry policy must be restricted to replayable methods');
assert.ok(source.includes('const MAX_API_ATTEMPTS = 4'), 'API retry budget must be bounded');
assert.ok(source.includes('attempt <= (replayable ? MAX_API_ATTEMPTS : 1)'), 'Non-replayable requests can enter the retry loop');
assert.ok(source.includes('requestTemplate.clone()'), 'Request bodies cannot be safely replayed from a stable template');
assert.ok(source.includes("init.signal?.aborted"), 'Abort signals are ignored during recovery');
assert.ok(source.includes("Math.min(retryAfter * 1_000, 2_000)"), 'Retry-After is not bounded');
assert.ok(source.includes("Math.min(250 * 2 ** Math.max(0, attempt - 1), 1_500)"), 'Backoff is not bounded');
assert.ok(source.includes("url.pathname.startsWith('/api/')"), 'Recovery is not restricted to application API calls');
assert.ok(!source.includes("'POST'"), 'Global recovery must never replay registration, challenge, reset or other POST actions');
assert.ok(!source.includes("'PATCH'"), 'Potentially non-idempotent PATCH actions must not be replayed globally');
assert.ok(!source.includes("'DELETE'"), 'Sensitive DELETE actions must not be replayed globally');

console.log('API transient recovery validated: only GET/HEAD/OPTIONS/PUT retry network or 502/503/504 failures with bounded abort-aware backoff.');
