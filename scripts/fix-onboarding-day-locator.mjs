import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/e2e/onboarding.spec.ts';
const before = readFileSync(path, 'utf8');
const needle = "await dialog.getByRole('button', { name: 'Вт' }).click();";
const replacement = "await dialog.getByRole('button', { name: 'Вт', exact: true }).click();";
const count = before.split(needle).length - 1;
if (count !== 1) throw new Error(`Expected one ambiguous weekday locator, found ${count}`);
writeFileSync(path, before.replace(needle, replacement));
console.log('Onboarding weekday locator is now exact and cannot match schedule-description text.');
