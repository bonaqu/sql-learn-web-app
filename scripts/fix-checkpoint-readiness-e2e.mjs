import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/e2e/checkpoints.spec.ts';
let source = readFileSync(path, 'utf8');

function replaceOne(needle, replacement) {
  const count = source.split(needle).length - 1;
  if (count !== 1) throw new Error(`Expected one occurrence, found ${count}: ${needle}`);
  source = source.replace(needle, replacement);
}

replaceOne("{ name: /Как считается readiness/i }", "{ name: /Как считается готовность/i }");
replaceOne("/completed checkpoint report/", "/завершённый отчёт контрольного этапа/");

for (const stale of ['Как считается readiness', 'completed checkpoint report']) {
  if (source.includes(stale)) throw new Error(`Stale checkpoint readiness E2E copy remains: ${stale}`);
}

writeFileSync(path, source);
console.log('Checkpoint readiness E2E expectations match the localized explainer.');
