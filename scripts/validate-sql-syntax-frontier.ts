import assert from 'node:assert/strict';
import { tasks } from '../src/data/course-catalog';
import { curriculumLessons } from '../src/data/complete-curriculum';
import { moduleOrderIndex } from '../src/data/learning-structure';
import {
  detectSqlSyntaxCapabilities,
  sqlSyntaxCapabilities,
  stripSqlCommentsAndLiterals,
  syntaxCapabilityIsAvailable,
  validateSyntaxCapabilityOwners,
  type SqlSyntaxCapabilityId
} from '../src/data/sql-syntax-frontier';

const prematureUses: string[] = [];
const coverageGaps: string[] = [];
const coverage = new Map<SqlSyntaxCapabilityId, Set<string>>();
const record = (capabilityId: SqlSyntaxCapabilityId, location: string) => {
  coverage.set(capabilityId, new Set([...(coverage.get(capabilityId) || []), location]));
};

assert.equal(validateSyntaxCapabilityOwners().length, 0, 'Every syntax capability owner must be a canonical module');
assert.equal(new Set(sqlSyntaxCapabilities.map(item => item.id)).size, sqlSyntaxCapabilities.length, 'Syntax capability ids must be unique');
for (const capability of sqlSyntaxCapabilities) {
  assert.ok(capability.title.length >= 3, `${capability.id}: weak title`);
  assert.ok(capability.rationale.length >= 45, `${capability.id}: rationale must explain the learning dependency`);
  assert.notEqual(moduleOrderIndex(capability.introducedBy), Number.MAX_SAFE_INTEGER, `${capability.id}: unknown owner ${capability.introducedBy}`);
}

const ignored = stripSqlCommentsAndLiterals(`
  SELECT 'GROUP BY JOIN OVER ( RETURNING' AS note;
  -- WITH RECURSIVE hidden AS (SELECT 1)
  /* ALTER TABLE hidden ADD COLUMN value TEXT; */
`);
assert.deepEqual(detectSqlSyntaxCapabilities(ignored).map(item => item.id), [], 'Strings or comments create false syntax capabilities');
assert.ok(detectSqlSyntaxCapabilities('WITH x AS (SELECT 1) SELECT * FROM x;').some(item => item.id === 'cte'), 'CTE detection is broken');
assert.ok(detectSqlSyntaxCapabilities("SELECT payload ->> '$.service' FROM events;").some(item => item.id === 'json-sql'), 'JSON operator detection is broken');
assert.ok(detectSqlSyntaxCapabilities('SELECT SUM(value) OVER (ORDER BY id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) FROM metrics;').some(item => item.id === 'window-frame'), 'Window frame detection is broken');

for (const task of tasks) {
  const sources = [
    ['solution', task.solution],
    ['starter', task.starter],
    ['guide example', task.guide.example]
  ] as const;
  for (const [sourceName, sql] of sources) {
    for (const capability of detectSqlSyntaxCapabilities(sql)) {
      record(capability.id, `task:${task.id}:${sourceName}:${task.module}`);
      if (!syntaxCapabilityIsAvailable(capability, task.module)) {
        prematureUses.push(`${task.id} (${task.module}) requires ${capability.title} in ${sourceName} before ${capability.introducedBy}`);
      }
    }
  }
}

for (const lesson of curriculumLessons) {
  for (const capability of detectSqlSyntaxCapabilities(lesson.example.sql)) {
    record(capability.id, `lesson:${lesson.id}:${lesson.module}`);
    if (!syntaxCapabilityIsAvailable(capability, lesson.module)) {
      prematureUses.push(`${lesson.id} (${lesson.module}) teaches ${capability.title} before ${capability.introducedBy}`);
    }
  }
}

const requiredCoverage: SqlSyntaxCapabilityId[] = [
  'grouping',
  'having',
  'joins',
  'subquery',
  'exists',
  'cte',
  'window-functions',
  'date-time-functions',
  'text-normalization',
  'set-operations',
  'indexes',
  'explain',
  'transaction-control',
  'data-mutation',
  'schema-ddl',
  'schema-evolution',
  'conditional-aggregate-filter',
  'recursive-cte',
  'window-frame',
  'json-sql'
];
for (const capabilityId of requiredCoverage) {
  if ((coverage.get(capabilityId)?.size || 0) < 1) {
    const capability = sqlSyntaxCapabilities.find(item => item.id === capabilityId);
    coverageGaps.push(`${capabilityId}: ${capability?.title || capabilityId} has no task or lesson example at/after owner ${capability?.introducedBy || 'unknown'}`);
  }
}

if (coverageGaps.length || prematureUses.length) {
  console.error(`SQL syntax frontier failed with ${coverageGaps.length} coverage gap(s) and ${prematureUses.length} premature capability use(s).`);
  if (coverageGaps.length) {
    console.error('Coverage gaps:');
    for (const gap of coverageGaps) console.error(`- ${gap}`);
  }
  if (prematureUses.length) {
    console.error('Premature uses:');
    for (const failure of prematureUses) console.error(`- ${failure}`);
  }
  process.exit(1);
}

const summary = sqlSyntaxCapabilities
  .map(capability => `${capability.id}:${coverage.get(capability.id)?.size || 0}`)
  .join(', ');
console.log(`SQL syntax frontier validated across ${tasks.length} tasks and ${curriculumLessons.length} lessons. Coverage ${summary}.`);
