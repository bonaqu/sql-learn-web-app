import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleLearningAnalyticsRequest } from '../worker/learning-analytics';

class TestStatement {
  private parameters: unknown[] = [];

  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}

  bind(...parameters: unknown[]) {
    this.parameters = parameters;
    return this;
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.parameters) || null) as T | null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.parameters);
    return { meta: { changes: Number(result.changes) || 0 } };
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.parameters) as T[] };
  }
}

class TestD1 {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new TestStatement(this.database, sql);
  }

  async batch(statements: TestStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function monday() {
  const date = new Date();
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    periodStart: monday(),
    courseVersion: 3,
    rows: [{
      moduleId: 'sql-thinking',
      opened: 1,
      attempted: 1,
      understood: 1,
      independent: 1,
      retained: 0,
      lapses: 0,
      remediations: 1,
      remediationSuccesses: 1,
      hintDependent: 1,
      solutionDependent: 0,
      placementChecks: 1,
      placementMatches: 1,
      studyMinutesBucket: 15,
      overload: 0,
      stalled: 0,
      reviewDebt: 0,
      topDiagnosticKind: 'result-shape'
    }],
    items: [{
      taskId: 'task-001',
      lessonId: 'lesson-sql-thinking',
      attempted: 1,
      independent: 1,
      hinted: 1,
      solutionViewed: 0,
      misconceptions: 1,
      remediations: 1,
      remediationSuccesses: 1,
      retained: 0,
      placementChecks: 1,
      placementMatches: 1
    }],
    mastery: { 'same-session': 1, 'same-day': 0, '2-7-days': 0, '8-30-days': 0, 'over-30-days': 0 },
    experiments: { 'remediation-copy-v1': 'control' },
    ...overrides
  };
}

async function call(env: Cloudflare.Env, userId: string, path: string, method = 'GET', body?: unknown) {
  const response = await handleLearningAnalyticsRequest(new Request(`https://academy.test${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env, userId);
  assert.ok(response);
  return { status: response.status, body: await response.json() as Record<string, any> };
}

const database = new DatabaseSync(':memory:');
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users(user_id TEXT PRIMARY KEY);
  ${readFileSync(new URL('../migrations/0017_learning_analytics.sql', import.meta.url), 'utf8')}
`);
const env = { DB: new TestD1(database) } as unknown as Cloudflare.Env;

for (let index = 1; index <= 5; index += 1) {
  const userId = `lifecycle-user-${index}`;
  database.prepare('INSERT INTO users(user_id) VALUES(?)').run(userId);
  assert.equal((await call(env, userId, '/api/learning-analytics/preferences', 'PUT', { sharing: 'coarse-opt-in' })).status, 200);
  assert.equal((await call(env, userId, '/api/learning-analytics/snapshot', 'PUT', { snapshot: snapshot() })).status, 200);
}

const legacyUser = 'lifecycle-user-legacy';
database.prepare('INSERT INTO users(user_id) VALUES(?)').run(legacyUser);
await call(env, legacyUser, '/api/learning-analytics/preferences', 'PUT', { sharing: 'coarse-opt-in' });
const current = snapshot();
const legacyRow = { ...current.rows[0] } as Record<string, unknown>;
for (const key of ['hintDependent', 'solutionDependent', 'placementChecks', 'placementMatches']) delete legacyRow[key];
const legacy = { ...current, version: 1, rows: [legacyRow] } as Record<string, unknown>;
delete legacy.items;
assert.equal((await call(env, legacyUser, '/api/learning-analytics/snapshot', 'PUT', { snapshot: legacy })).status, 200);
const legacyExport = await call(env, legacyUser, '/api/learning-analytics/export');
assert.equal(legacyExport.body.snapshots[0].version, 1);
assert.deepEqual(legacyExport.body.snapshots[0].items, []);

const report = await call(env, 'lifecycle-user-1', '/api/learning-analytics/report');
assert.equal(report.status, 200);
assert.equal(report.body.version, 2);
assert.equal(report.body.items.length, 1);
assert.equal(report.body.items[0].contributors, 5);
assert.equal(report.body.items[0].taskId, 'task-001');
assert.equal(report.body.suppressedItems, 0);

const exported = await call(env, 'lifecycle-user-1', '/api/learning-analytics/export');
assert.equal(exported.body.version, 2);
assert.equal(exported.body.snapshots.length, 1);
assert.equal(exported.body.snapshots[0].items[0].lessonId, 'lesson-sql-thinking');
const exportedText = JSON.stringify(exported.body).toLowerCase();
for (const forbidden of ['select * from', 'password', 'token', 'lifecycle-user-1', 'person@example.com']) {
  assert.ok(!exportedText.includes(forbidden), `Export leaked forbidden value: ${forbidden}`);
}

const forgedSql = snapshot();
(forgedSql.items[0] as Record<string, unknown>).sql = 'SELECT * FROM private_customer_data';
assert.equal((await call(env, 'lifecycle-user-1', '/api/learning-analytics/snapshot', 'PUT', { snapshot: forgedSql })).status, 400);

const mismatchedLesson = snapshot();
mismatchedLesson.items[0].lessonId = 'lesson-select';
assert.equal((await call(env, 'lifecycle-user-1', '/api/learning-analytics/snapshot', 'PUT', { snapshot: mismatchedLesson })).status, 400);

assert.equal((await call(env, 'lifecycle-user-1', '/api/learning-analytics/preferences', 'PUT', { sharing: 'off' })).status, 200);
const afterOptOut = await call(env, 'lifecycle-user-1', '/api/learning-analytics/export');
assert.equal(afterOptOut.body.sharing, 'off');
assert.equal(afterOptOut.body.snapshots.length, 0);

assert.equal((await call(env, 'lifecycle-user-2', '/api/learning-analytics', 'DELETE')).status, 200);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_analytics_preferences WHERE user_id = ?').get('lifecycle-user-2')?.count, 0);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_analytics_snapshots WHERE user_id = ?').get('lifecycle-user-2')?.count, 0);

database.prepare('DELETE FROM users WHERE user_id = ?').run('lifecycle-user-3');
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_analytics_preferences WHERE user_id = ?').get('lifecycle-user-3')?.count, 0);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_analytics_snapshots WHERE user_id = ?').get('lifecycle-user-3')?.count, 0);

process.stdout.write('Learning analytics D1 lifecycle passed: v1 read compatibility, five-contributor item release, strict SQL/free-text rejection, published task/lesson mapping, export, opt-out, explicit deletion and account cascade.\n');
