import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { modules } from '../src/data/course-catalog.ts';
import { errorAtlas, type ErrorAtlasCategory } from '../src/data/sql-error-atlas.ts';
import { reviewCards } from '../src/data/review-cards.ts';
import { schemaTables } from '../src/data/schema-explorer.ts';
import { trainingSeedSql } from '../src/data/training-dataset.ts';
import { gradeReviewCard } from '../src/lib/spaced-repetition.ts';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '..');
const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
const unique = (values: string[]) => new Set(values).size === values.length;

const SQL = await initSqlJs({ locateFile: file => path.join(projectRoot, 'node_modules', 'sql.js', 'dist', file) });
const database = new SQL.Database();
database.run(trainingSeedSql);

assert(schemaTables.length >= 6, `Schema Explorer requires at least 6 tables, got ${schemaTables.length}`);
assert(unique(schemaTables.map(table => table.id)), 'Schema table IDs must be unique');

for (const table of schemaTables) {
  const exists = database.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table.id.replaceAll("'", "''")}'`);
  assert(Boolean(exists[0]?.values.length), `${table.id}: table does not exist in training seed`);
  assert(table.grain.trim().length >= 12, `${table.id}: grain is too short`);
  assert(table.cardinality.trim().length >= 12, `${table.id}: cardinality hint is too short`);
  assert(unique(table.columns.map(column => column.name)), `${table.id}: duplicate column metadata`);

  const pragma = database.exec(`PRAGMA table_info(${table.id})`)[0];
  const actualColumns = new Map((pragma?.values || []).map(row => [String(row[1]), { type: String(row[2]).toUpperCase(), notNull: Number(row[3]) === 1, pk: Number(row[5]) > 0 }]));
  for (const column of table.columns) {
    const actual = actualColumns.get(column.name);
    assert(Boolean(actual), `${table.id}.${column.name}: missing from seed schema`);
    if (!actual) continue;
    assert(actual.type === column.type, `${table.id}.${column.name}: expected type ${column.type}, got ${actual.type}`);
    assert(actual.notNull === !column.nullable || column.role === 'pk', `${table.id}.${column.name}: nullable metadata mismatch`);
    assert(actual.pk === (column.role === 'pk'), `${table.id}.${column.name}: primary-key metadata mismatch`);
  }

  const foreignKeys = database.exec(`PRAGMA foreign_key_list(${table.id})`)[0]?.values || [];
  for (const column of table.columns.filter(item => item.references)) {
    const [targetTable, targetColumn] = column.references!.split('.');
    assert(foreignKeys.some(row => String(row[3]) === column.name && String(row[2]) === targetTable && String(row[4]) === targetColumn), `${table.id}.${column.name}: foreign-key metadata mismatch`);
  }

  const indexes = database.exec(`PRAGMA index_list(${table.id})`)[0]?.values || [];
  for (const index of table.indexes) {
    assert(indexes.some(row => String(row[1]) === index.name), `${table.id}: missing index ${index.name}`);
    const columns = (database.exec(`PRAGMA index_info(${index.name})`)[0]?.values || []).map(row => String(row[2]));
    assert(JSON.stringify(columns) === JSON.stringify(index.columns), `${index.name}: expected (${index.columns.join(', ')}), got (${columns.join(', ')})`);
  }

  try {
    const result = database.exec(table.sampleSql);
    assert(Boolean(result.length && result.some(item => item.values.length)), `${table.id}: sample SQL must return rows`);
  } catch (reason) {
    failures.push(`${table.id}: sample SQL failed: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
}

const categories: ErrorAtlasCategory[] = ['syntax', 'runtime', 'logical', 'performance'];
assert(errorAtlas.length >= 12, `Error Atlas requires at least 12 entries, got ${errorAtlas.length}`);
assert(unique(errorAtlas.map(entry => entry.id)), 'Error Atlas IDs must be unique');
for (const category of categories) assert(errorAtlas.filter(entry => entry.category === category).length >= 2, `Error Atlas needs at least 2 ${category} entries`);

for (const entry of errorAtlas) {
  assert(entry.checks.length >= 3, `${entry.id}: requires at least 3 diagnostic checks`);
  assert(entry.rule.trim().length >= 20, `${entry.id}: rule is too short`);
  try {
    database.exec(entry.fixedSql);
  } catch (reason) {
    failures.push(`${entry.id}: fixed SQL failed: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  if (entry.category === 'syntax' || entry.category === 'runtime') {
    let failedAsExpected = false;
    try { database.exec(entry.brokenSql); } catch { failedAsExpected = true; }
    assert(failedAsExpected, `${entry.id}: broken ${entry.category} SQL unexpectedly succeeded`);
  }
}

assert(reviewCards.length === modules.length, `Expected ${modules.length} review cards, got ${reviewCards.length}`);
assert(unique(reviewCards.map(card => card.id)), 'Review card IDs must be unique');
assert(unique(reviewCards.map(card => card.moduleId)), 'Each module must have one review card');
for (const card of reviewCards) {
  assert(card.prompt.trim().length >= 30, `${card.id}: prompt is too short`);
  assert(card.answer.trim().length >= 30, `${card.id}: answer is too short`);
  assert(card.example.trim().length >= 8, `${card.id}: example is too short`);
}

const now = Date.UTC(2026, 6, 25, 10, 0, 0);
const cardId = reviewCards[0].id;
const again = gradeReviewCard(cardId, 'again', 'validator-again', now).schedules[cardId];
const hard = gradeReviewCard(cardId, 'hard', 'validator-hard', now).schedules[cardId];
const good = gradeReviewCard(cardId, 'good', 'validator-good', now).schedules[cardId];
const easy = gradeReviewCard(cardId, 'easy', 'validator-easy', now).schedules[cardId];
assert(new Date(again.dueAt).getTime() === now + 10 * 60_000, 'Again grade must schedule a 10-minute retry');
assert(hard.intervalDays === 1, 'First Hard grade must schedule one day');
assert(good.intervalDays === 1, 'First Good grade must schedule one day');
assert(easy.intervalDays === 4, 'First Easy grade must schedule four days');
assert(easy.ease > good.ease && again.ease < good.ease, 'Review ease must respond to grades');

database.close();

if (failures.length) {
  console.error(`Learning tools validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Learning tools validated: ${schemaTables.length} schema tables, ${errorAtlas.length} error patterns and ${reviewCards.length} spaced-review cards.`);
