import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/styles-curriculum.css';
const source = readFileSync(path, 'utf8');
const before = '.project-rubric small { margin-top: .25rem; color: #71717a; font-size: .68rem; line-height: 1.45; }';
const after = '.project-rubric small { margin-top: .25rem; color: #a1a1aa; font-size: .68rem; line-height: 1.45; }';
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`Expected one rubric contrast rule, found ${count}`);
writeFileSync(path, source.replace(before, after));
