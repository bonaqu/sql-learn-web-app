import type { SqlTask } from '../data/course';
import {
  TaskSqlExecutionError,
  evaluateTaskSql,
  executeTaskSql,
  type TaskSqlEngine
} from './task-evaluation-contract';

export type AssessmentSqlEngine = TaskSqlEngine;
export type AssessmentSqlTable = { columns: string[]; values: unknown[][] };
export const AssessmentSqlExecutionError = TaskSqlExecutionError;

export function executeAssessmentSql(
  engine: AssessmentSqlEngine,
  source: string,
  role: 'learner' | 'reference' = 'learner'
) {
  return executeTaskSql(engine, source, role);
}

export function evaluateAssessmentSql(
  engine: AssessmentSqlEngine,
  source: string,
  task: SqlTask,
  surface: 'checkpoint' | 'placement' | 'assessment' = 'assessment'
) {
  return evaluateTaskSql(engine, task, source, surface);
}
