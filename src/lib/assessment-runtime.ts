import type { QueryExecResult } from 'sql.js';
import { trainingSeedSql } from '../data/training-dataset';

export type AssessmentSqlEngine = Awaited<ReturnType<typeof import('sql.js')['default']>>;
export type AssessmentSqlTable = { columns: string[]; values: unknown[][] };

function normalize(value: unknown) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return Number.isInteger(value)
    ? String(value)
    : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

export function comparableAssessmentResults(results: QueryExecResult[]) {
  return JSON.stringify(results.map(block => ({
    columns: block.columns.map(column => column.toLowerCase()),
    values: block.values.map(row => row.map(normalize))
  })));
}

export function executeAssessmentSql(engine: AssessmentSqlEngine, source: string) {
  const database = new engine.Database();
  try {
    database.run(trainingSeedSql);
    return database.exec(source);
  } finally {
    database.close();
  }
}

export function evaluateAssessmentSql(engine: AssessmentSqlEngine, source: string, solution: string) {
  const output = executeAssessmentSql(engine, source);
  const expected = executeAssessmentSql(engine, solution);
  return {
    correct: comparableAssessmentResults(output) === comparableAssessmentResults(expected),
    output: output as AssessmentSqlTable[]
  };
}
