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

const CORE_ANALYTICS_MODULE_IDS = ANALYTICS_MODULE_IDS.slice(0, 20);
const ADVANCED_ANALYTICS_MODULE_IDS = ANALYTICS_MODULE_IDS.slice(20);

export const ANALYTICS_TASK_IDS = Array.from(
  { length: 240 },
  (_, index) => `task-${String(index + 1).padStart(3, '0')}`
);

export const ANALYTICS_LESSON_IDS = [
  ...CORE_ANALYTICS_MODULE_IDS.map(moduleId => `lesson-${moduleId}`),
  ...ADVANCED_ANALYTICS_MODULE_IDS.flatMap(moduleId => [
    `lesson-${moduleId}-foundation`,
    `lesson-${moduleId}-applied`
  ])
];

export function analyticsLessonForTaskId(taskId: string) {
  const match = /^task-(\d{3})$/.exec(taskId);
  const taskNumber = Number(match?.[1] || 0);
  if (taskNumber >= 1 && taskNumber <= 120) {
    const moduleId = CORE_ANALYTICS_MODULE_IDS[Math.floor((taskNumber - 1) / 6)];
    return moduleId ? `lesson-${moduleId}` : null;
  }
  if (taskNumber >= 121 && taskNumber <= 240) {
    const offset = taskNumber - 121;
    const moduleId = ADVANCED_ANALYTICS_MODULE_IDS[Math.floor(offset / 10)];
    if (!moduleId) return null;
    return `lesson-${moduleId}-${offset % 10 < 5 ? 'foundation' : 'applied'}`;
  }
  return null;
}

export type AnalyticsModuleId = typeof ANALYTICS_MODULE_IDS[number];
export type AnalyticsDiagnosticKind = typeof ANALYTICS_DIAGNOSTIC_KINDS[number];
export type AnalyticsExperimentId = typeof ANALYTICS_EXPERIMENT_IDS[number];
export type AnalyticsVariant = typeof ANALYTICS_VARIANTS[number];
