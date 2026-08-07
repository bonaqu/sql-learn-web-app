import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/e2e/onboarding.spec.ts';
let source = readFileSync(path, 'utf8');

function replaceExact(needle, replacement, expected) {
  const count = source.split(needle).length - 1;
  if (count !== expected) {
    throw new Error(`Expected ${expected} occurrence(s), found ${count}: ${needle}`);
  }
  source = expected === 1 ? source.replace(needle, replacement) : source.split(needle).join(replacement);
}

replaceExact("{ name: /Support SQL/i }", "{ name: /SQL для поддержки/i }", 1);
replaceExact("expectSharedFoundationToday(page, /Support SQL/i)", "expectSharedFoundationToday(page, /SQL для поддержки/i)", 2);
replaceExact("toContainText('Support')", "toContainText('SQL для поддержки')", 1);
replaceExact("expectSharedFoundationToday(secondPage, /Support SQL/i)", "expectSharedFoundationToday(secondPage, /SQL для поддержки/i)", 1);
replaceExact("toContainText(/Backend SQL/i)", "toContainText(/SQL для бэкенда/i)", 1);

for (const stale of ['Support SQL', 'Backend SQL', "toContainText('Support')"]) {
  if (source.includes(stale)) throw new Error(`Stale onboarding E2E copy remains: ${stale}`);
}

writeFileSync(path, source);
console.log('Onboarding E2E expectations now match the localized learner-facing goal names.');
