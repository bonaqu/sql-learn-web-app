import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/integrate-graded-exams.mjs';
let source = readFileSync(path, 'utf8');
const replacements = [
  [
    "{eligibility.missingRequiredModules.length ? ` · prerequisites: ${eligibility.missingRequiredModules.length}` : ''}",
    "{eligibility.missingRequiredModules.length ? ' · prerequisites: ' + eligibility.missingRequiredModules.length : ''}"
  ],
  [
    "`${mode}: fixed pool changed`",
    "mode + ': fixed pool changed'"
  ]
];
for (const [before, after] of replacements) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Expected one patch literal, got ${count}: ${before}`);
  source = source.replace(before, after);
}
writeFileSync(path, source);
