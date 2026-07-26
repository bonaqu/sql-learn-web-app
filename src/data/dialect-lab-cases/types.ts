import type { SqlDialect } from '../dialect-lab-manifests';

export type DialectLabSignal = {
  id: string;
  label: string;
  pattern: string;
  remediation: string;
};

export type DialectLabCanonicalOutput = {
  columns: string[];
  rows: unknown[][];
};

export type NormalizedPlanEvidence = {
  accessPath: 'full-scan' | 'index-search' | 'range-search';
  relation: string;
  indexName: string | null;
  sort: 'none' | 'explicit-sort';
  estimatedRows: number | null;
};

export type DialectTransactionStep = {
  order: number;
  session: 'A' | 'B' | 'database';
  action: string;
  outcome: string;
};

export type DialectLabCase = {
  id: string;
  labId: string;
  dialect: SqlDialect;
  starterSql: string;
  referenceSql: string;
  seedSql?: string;
  verificationSql?: string;
  runTwice?: boolean;
  signals: DialectLabSignal[];
  canonicalOutput?: DialectLabCanonicalOutput;
  normalizedPlan?: NormalizedPlanEvidence;
  transactionTrace?: DialectTransactionStep[];
  runtimeNote: string;
};
