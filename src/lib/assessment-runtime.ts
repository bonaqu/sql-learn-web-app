import type { QueryExecResult } from 'sql.js';
import { trainingSeedSql } from '../data/training-dataset';

export type AssessmentSqlEngine = Awaited<ReturnType<typeof import('sql.js')['default']>>;
export type AssessmentSqlTable = { columns: string[]; values: unknown[][] };
export type AssessmentSqlErrorKind = 'learner' | 'technical';

export class AssessmentSqlExecutionError extends Error {
  readonly kind: AssessmentSqlErrorKind;

  constructor(kind: AssessmentSqlErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AssessmentSqlExecutionError';
    this.kind = kind;
  }
}

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

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function executeAssessmentSql(engine: AssessmentSqlEngine, source: string, role: 'learner' | 'reference' = 'learner') {
  let database: InstanceType<AssessmentSqlEngine['Database']>;
  try {
    database = new engine.Database();
  } catch (reason) {
    throw new AssessmentSqlExecutionError('technical', `SQLite engine initialization failed: ${errorMessage(reason)}`, { cause: reason });
  }
  try {
    try {
      database.run(trainingSeedSql);
    } catch (reason) {
      throw new AssessmentSqlExecutionError('technical', `Training dataset initialization failed: ${errorMessage(reason)}`, { cause: reason });
    }
    try {
      return database.exec(source);
    } catch (reason) {
      const kind: AssessmentSqlErrorKind = role === 'learner' ? 'learner' : 'technical';
      const label = role === 'learner' ? 'Learner SQL' : 'Reference SQL';
      throw new AssessmentSqlExecutionError(kind, `${label}: ${errorMessage(reason)}`, { cause: reason });
    }
  } finally {
    try { database.close(); } catch { /* Closing a disposable assessment DB must not overwrite primary evidence. */ }
  }
}

export function evaluateAssessmentSql(engine: AssessmentSqlEngine, source: string, solution: string) {
  const output = executeAssessmentSql(engine, source, 'learner');
  const expected = executeAssessmentSql(engine, solution, 'reference');
  return {
    correct: comparableAssessmentResults(output) === comparableAssessmentResults(expected),
    output: output as AssessmentSqlTable[]
  };
}
