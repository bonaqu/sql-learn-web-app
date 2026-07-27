export const ANALYTICS_MODULE_IDS = [
  'sql-thinking',
  'select',
  'filtering',
  'sorting',
  'aggregates',
  'grouping',
  'joins',
  'subqueries',
  'cte',
  'windows',
  'dates',
  'text',
  'set-ops',
  'data-quality',
  'indexes',
  'explain',
  'transactions',
  'schema',
  'support',
  'final',
  'dml',
  'schema-evolution',
  'null-logic-advanced',
  'conditional-aggregation',
  'advanced-joins',
  'recursive-cte',
  'window-frames',
  'json-sql',
  'sql-security',
  'concurrency',
  'pagination-patterns',
  'incident-investigation'
] as const;

export const ANALYTICS_DIAGNOSTIC_KINDS = [
  'syntax',
  'schema',
  'runtime',
  'result-shape',
  'row-set',
  'ordering',
  'values',
  'null-filter',
  'aggregation',
  'join-cardinality'
] as const;

export const ANALYTICS_EXPERIMENT_IDS = ['remediation-copy-v1'] as const;
export const ANALYTICS_VARIANTS = ['control', 'variant-a', 'variant-b'] as const;

export type AnalyticsModuleId = typeof ANALYTICS_MODULE_IDS[number];
export type AnalyticsDiagnosticKind = typeof ANALYTICS_DIAGNOSTIC_KINDS[number];
export type AnalyticsExperimentId = typeof ANALYTICS_EXPERIMENT_IDS[number];
export type AnalyticsVariant = typeof ANALYTICS_VARIANTS[number];
