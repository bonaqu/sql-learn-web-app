import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { curriculumLessons } from '../src/data/complete-curriculum.ts';
import { modules } from '../src/data/course-catalog.ts';
import {
  allCurriculumConcepts,
  allCurriculumMisconceptions,
  conceptInventory
} from '../src/data/concept-inventory.ts';
import { allKnownLessonChecks, lessonChecks } from '../src/data/lesson-checks.ts';
import { trainingSeedSql } from '../src/data/training-dataset.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const editorialMatrix = readFileSync(new URL('../docs/curriculum-editorial-matrix.md', import.meta.url), 'utf8');

const moduleIds = modules.map(([id]) => id);
assert(Object.keys(conceptInventory).length === moduleIds.length, 'Concept inventory must cover every module exactly once');
for (const moduleId of moduleIds) {
  const concepts = conceptInventory[moduleId];
  assert(Array.isArray(concepts) && concepts.length >= 1, `Missing concept for ${moduleId}`);
  for (const concept of concepts || []) {
    assert(concept.module === moduleId, `${concept.id}: module mismatch`);
    assert(concept.title.length >= 8, `${concept.id}: weak title`);
    assert(concept.mentalModel.length >= 60, `${concept.id}: mental model is too short`);
    assert(concept.evidence.length >= 35, `${concept.id}: evidence is too vague`);
    assert(concept.misconceptions.length >= 3, `${concept.id}: at least three misconceptions are required`);
    assert(new Set(concept.misconceptions.map(item => item.id)).size === concept.misconceptions.length, `${concept.id}: duplicate misconception IDs`);
    for (const item of concept.misconceptions) {
      assert(item.label.length >= 10, `${item.id}: weak misconception label`);
      assert(item.explanation.length >= 25, `${item.id}: explanation is too short to explain the failure mode`);
      assert(item.remediation.length >= 18, `${item.id}: remediation must contain a concrete next step`);
    }
  }
}

assert(new Set(allCurriculumConcepts.map(item => item.id)).size === allCurriculumConcepts.length, 'Concept IDs must be globally unique');
assert(new Set(allCurriculumMisconceptions.map(item => item.id)).size === allCurriculumMisconceptions.length, 'Misconception IDs must be globally unique');

const checks = allKnownLessonChecks(curriculumLessons);
const checkIds = new Set<string>();
const questionTexts = new Set<string>();
const positionCounts = new Map<number, number>();
for (const lesson of curriculumLessons) {
  assert(editorialMatrix.includes(`| ${lesson.id} |`), `${lesson.id}: missing from editorial matrix`);
  const lessonItems = lessonChecks(lesson);
  const kinds = new Set(lessonItems.map(item => item.kind));
  assert(lessonItems.length >= 3 && lessonItems.length <= 4, `${lesson.id}: expected 3–4 checks, got ${lessonItems.length}`);
  assert(kinds.size >= 3, `${lesson.id}: checks must cover at least three reasoning kinds`);
  assert(kinds.has('explanation') && kinds.has('diagnosis') && kinds.has('transfer'), `${lesson.id}: explanation/diagnosis/transfer are mandatory`);
  for (const check of lessonItems) {
    assert(!checkIds.has(check.id), `Duplicate check ID ${check.id}`);
    checkIds.add(check.id);
    assert(check.options.length === 4, `${check.id}: exactly four options are required`);
    assert(check.correctIndex >= 0 && check.correctIndex < check.options.length, `${check.id}: invalid correct index`);
    assert(check.optionFeedback.length === check.options.length, `${check.id}: per-option feedback is incomplete`);
    assert(check.misconceptionIds.length === check.options.length, `${check.id}: misconception mapping is incomplete`);
    assert(check.misconceptionIds[check.correctIndex] === null, `${check.id}: correct answer cannot map to a misconception`);
    assert(check.options.every(option => option.trim().length >= 2), `${check.id}: empty or unusable option text`);
    assert(new Set(check.options.map(normalized)).size === check.options.length, `${check.id}: duplicate options`);
    const question = normalized(check.question);
    assert(!questionTexts.has(question), `${check.id}: duplicate question text`);
    questionTexts.add(question);
    positionCounts.set(check.correctIndex, (positionCounts.get(check.correctIndex) || 0) + 1);
    for (let index = 0; index < check.options.length; index += 1) {
      if (index === check.correctIndex) continue;
      assert(Boolean(check.misconceptionIds[index]), `${check.id}: every distractor must map to a misconception`);
      assert(check.optionFeedback[index].length >= 35, `${check.id}: distractor feedback is too weak`);
    }
  }
}

assert(checks.length >= curriculumLessons.length * 3, 'Every lesson must have multiple checks');
const positions = [0, 1, 2, 3].map(index => positionCounts.get(index) || 0);
const maxPosition = Math.max(...positions);
const minPosition = Math.min(...positions);
assert(minPosition > 0, `Answer-position bias: one index is never correct (${positions.join(', ')})`);
assert(maxPosition - minPosition <= Math.ceil(checks.length * 0.18), `Answer-position distribution is too biased (${positions.join(', ')})`);

for (const lesson of curriculumLessons) {
  const prose = lesson.sections.flatMap(section => [section.lead, ...section.paragraphs, ...section.bullets]).map(normalized);
  assert(new Set(prose).size === prose.length, `${lesson.id}: duplicate section prose`);
  assert(lesson.objectives.length >= 3, `${lesson.id}: at least three objectives are required`);
  assert(lesson.practiceTaskIds.length >= 1, `${lesson.id}: missing transfer practice`);
}

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });
let executableCounterexamples = 0;
for (const concept of allCurriculumConcepts) {
  for (const item of concept.misconceptions) {
    const example = item.counterexample;
    if (!example) continue;
    executableCounterexamples += 1;
    const db = new SQL.Database();
    try {
      db.run(trainingSeedSql);
      const wrong = db.exec(example.wrongSql);
      const correct = db.exec(example.correctSql);
      assert(JSON.stringify(wrong) !== JSON.stringify(correct), `${item.id}: wrong/correct SQL must produce observably different results`);
    } catch (reason) {
      failures.push(`${item.id}: counterexample does not execute (${reason instanceof Error ? reason.message : String(reason)})`);
    } finally {
      db.close();
    }
  }
}
assert(executableCounterexamples >= 7, `Expected at least seven executable counterexamples, got ${executableCounterexamples}`);

if (failures.length) {
  console.error(`Concept inventory validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Concept inventory validated: ${moduleIds.length} modules, ${curriculumLessons.length} lessons, ${checks.length} checks, ${allCurriculumMisconceptions.length} misconceptions, ${executableCounterexamples} executable counterexamples, answer positions ${positions.join('/')}.`);
