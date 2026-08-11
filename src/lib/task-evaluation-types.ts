import type { AttemptDiagnostic } from './attempt-diagnostics';

export const TASK_EVALUATION_CONTRACT_VERSION = 'task-evaluation-v1' as const;
export const FOUNDATION_EVIDENCE_CONTRACT_VERSION = 'foundation-evidence-v1' as const;

export type SqlResultType = 'integer' | 'real' | 'text';
export type TaskEvaluationSurface = 'practice' | 'checkpoint' | 'placement' | 'assessment';
export type TaskFixtureVisibility = 'public' | 'hidden' | 'adversarial';

export type TaskEvaluationColumn = {
  name: string;
  type: SqlResultType;
  nullable: boolean;
  numericTolerance?: number;
};

export type TaskOrderPolicy =
  | { kind: 'unordered' }
  | {
      kind: 'ordered';
      keys: Array<{ column: string; direction: 'asc' | 'desc'; nulls: 'first' | 'last' | 'not-applicable' }>;
      completeTieBreak: true;
    };

export type TaskEvaluationFixture = {
  id: string;
  label: string;
  visibility: TaskFixtureVisibility;
  setupSql: string;
};

export type FoundationConcept =
  | 'result-grain'
  | 'select-list'
  | 'from-source'
  | 'where-filter'
  | 'boolean-logic'
  | 'null-predicate'
  | 'expression'
  | 'alias'
  | 'stable-order'
  | 'limit'
  | 'aggregate';

export type TaskEvaluationContract = {
  version: typeof TASK_EVALUATION_CONTRACT_VERSION;
  id: string;
  taskId: string;
  columns: TaskEvaluationColumn[];
  duplicatePolicy: 'preserve' | 'distinct';
  nullPolicy: 'preserve';
  order: TaskOrderPolicy;
  statementPolicy: { readOnly: true; singleStatement: true };
  postState: { tablesUnchanged: string[] };
  fixtures: TaskEvaluationFixture[];
  requiredConcepts: FoundationConcept[];
};

export type TaskEvaluationDiagnosticCode =
  | 'unsafe-mutation'
  | 'syntax-error'
  | 'runtime-error'
  | 'wrong-columns'
  | 'wrong-types'
  | 'wrong-row-count'
  | 'wrong-duplicates'
  | 'wrong-null-semantics'
  | 'wrong-order'
  | 'wrong-values'
  | 'post-state-changed';

export type TaskEvaluationDiagnostic = AttemptDiagnostic & {
  contractCode: TaskEvaluationDiagnosticCode;
  fixtureId: string;
};

export type TaskEvaluationEvidence = {
  contractId: string;
  contractVersion: typeof TASK_EVALUATION_CONTRACT_VERSION;
  evidenceContractVersion: typeof FOUNDATION_EVIDENCE_CONTRACT_VERSION;
  fixtureIds: string[];
  hiddenFixtureIds: string[];
};

export type TaskEvaluationResult = {
  correct: boolean;
  output: Array<{ columns: string[]; values: unknown[][] }>;
  diagnostic: TaskEvaluationDiagnostic | null;
  evidence: TaskEvaluationEvidence | null;
};

export type TaskSqlEngine = Awaited<ReturnType<typeof import('sql.js')['default']>>;
