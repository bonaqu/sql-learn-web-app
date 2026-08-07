import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/validate-learning-path.ts';
const before = readFileSync(path, 'utf8');
const needle = "  'goal-route',\n";
const replacement = "  'Карта доказательств и goal-route',\n";
const count = before.split(needle).length - 1;
if (count !== 1) throw new Error(`Expected one broad goal-route guard, found ${count}`);
writeFileSync(path, before.replace(needle, replacement));
console.log('Learning Path goal-route guard narrowed to the removed learner-facing phrase.');
