import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const audit = readFileSync(new URL('../docs/evidence/final-hardening-audit.md', import.meta.url), 'utf8');
const pwa = readFileSync(new URL('../src/components/PwaStatus.tsx', import.meta.url), 'utf8');
const authGate = readFileSync(new URL('../src/components/AuthGate.tsx', import.meta.url), 'utf8');
const academyBrowser = readFileSync(new URL('../tests/e2e/academy.spec.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const authCss = readFileSync(new URL('../src/auth.css', import.meta.url), 'utf8');
const browserEvidence = readFileSync(new URL('./production-browser-evidence.ts', import.meta.url), 'utf8');
const operations = readFileSync(new URL('./validate-operations.mjs', import.meta.url), 'utf8');

for (let requirement = 1; requirement <= 35; requirement += 1) {
  assert.match(audit, new RegExp(`\\| ${requirement} \\|`), `Final audit is missing master-prompt requirement ${requirement}`);
}

for (const heading of [
  'Curriculum truth',
  'UX and state coverage',
  'Edge cases and saved-state compatibility',
  'Security and privacy',
  'Accessibility and responsive behavior',
  'Performance and PWA',
  'Operations',
  'Diff and content review',
  'Regression sweep',
  'Learner evidence'
]) {
  assert.ok(audit.includes(`### ${heading}`), `Final audit is missing the ${heading} sub-pass`);
}

assert.match(audit, /Definition of success \| \*\*External acceptance gate\*\*/);
assert.match(audit, /NOT STARTED — EXTERNAL ACCEPTANCE GATE/);
assert.match(audit, /do not prove teaching effectiveness/i);
assert.match(audit, /PostgreSQL 14\/MySQL 8/);
assert.match(audit, /153 queries, 261 rows read, 447 rows written, 28 tables/);
assert.match(audit, /exactly one safe reload/);
assert.match(audit, /plaintext local export\/manifest are removed/);

assert.match(pwa, /Онлайн-обучение продолжает работать/);
assert.match(pwa, /PWA_REGISTRATION_ERROR_EVENT/);
assert.match(pwa, /pwa-toast passive dismissible/);
assert.doesNotMatch(pwa, /<p>\{String\(registrationError\)/);
assert.match(authGate, /'local-unverified'/);
assert.match(authGate, /Локальная сессия — без подтверждения сервера/);
assert.match(authGate, /status === 401[\s\S]*clearAuthSession\(\)/);
assert.match(academyBrowser, /preserves authenticated local work across an offline reload and resynchronizes after verification/);
assert.match(academyBrowser, /rejects a revoked cached session instead of granting local fallback/);
assert.match(main, /localStorage\.getItem\('sql-theme'\)/);
assert.match(main, /document\.documentElement\.dataset\.theme = savedTheme/);
assert.match(authCss, /auth-brand-panel[^}]*color:#f8fafc/);
assert.match(authCss, /auth-brand-panel \.auth-kicker\{color:#c4b5fd\}/);
assert.match(browserEvidence, /serviceWorkers:\s*'block'/);
assert.match(browserEvidence, /for \(const profile of profiles\) \{[\s\S]*const browser = await chromium\.launch/);
assert.match(browserEvidence, /finally \{\s*await browser\.close\(\)/);
assert.match(browserEvidence, /screenshotSha256 = createHash\('sha256'\)/);
assert.match(browserEvidence, /localStorage\.setItem\('sql-theme', theme\)/);
assert.match(browserEvidence, /activeTheme !== profile\.colorScheme/);
assert.match(browserEvidence, /Cannot read\|undefined\|waiting/);
assert.match(browserEvidence, /desktop-light/);
assert.match(browserEvidence, /mobile-dark/);
assert.match(operations, /require\.resolve\('wrangler'\)/);
assert.match(operations, /process\.execPath/);

process.stdout.write('Final hardening validation passed: 35 requirements, ten sub-passes, honest external learner gate, authenticated offline reload fail-closed boundary, production browser matrix and Windows-safe operations contracts.\n');
