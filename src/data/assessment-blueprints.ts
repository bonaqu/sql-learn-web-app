import { tasks, type Difficulty, type SqlTask } from './course-catalog';

export const ASSESSMENT_BLUEPRINT_VERSION = 'assessment-blueprint-v3';
export const ASSESSMENT_THRESHOLD_VERSION = 'assessment-thresholds-v2';

export type CalibratedAssessmentMode = 'quick' | 'interview' | 'exam' | 'diagnostic' | 'production' | 'final';
export type AssessmentReasoningSkill =
  | 'result-contract'
  | 'row-selection'
  | 'aggregation'
  | 'relationships'
  | 'query-structure'
  | 'time-series'
  | 'data-shaping'
  | 'safe-write'
  | 'performance'
  | 'security'
  | 'operations';
export type AssessmentErrorClass =
  | 'contract'
  | 'logic'
  | 'null'
  | 'cardinality'
  | 'aggregation-grain'
  | 'ordering'
  | 'mutation-safety'
  | 'performance-plan'
  | 'concurrency'
  | 'data-quality';
export type AssessmentDifficultyBand = 'foundation' | 'working' | 'advanced' | 'expert';

export interface AssessmentItemDefinition {
  taskId: string;
  moduleId: string;
  reasoningSkill: AssessmentReasoningSkill;
  errorClass: AssessmentErrorClass;
  authoredDifficulty: Difficulty;
  difficultyBand: AssessmentDifficultyBand;
  expectedSeconds: number;
  eligibleModes: CalibratedAssessmentMode[];
}

export interface AssessmentBlueprintSlot {
  reasoningSkill: AssessmentReasoningSkill;
  count: number;
  difficultyBands?: AssessmentDifficultyBand[];
}

export interface AssessmentBlueprint {
  version: typeof ASSESSMENT_BLUEPRINT_VERSION;
  thresholdVersion: typeof ASSESSMENT_THRESHOLD_VERSION;
  mode: CalibratedAssessmentMode;
  taskCount: number;
  minimumDistinctModules: number;
  minimumDistinctSkills: number;
  slots: AssessmentBlueprintSlot[];
  fixedTaskIds?: string[];
  anchorTaskIds?: string[];
  maximumFormOverlap: number;
}

const skillModules: Record<AssessmentReasoningSkill, readonly string[]> = {
  'result-contract': ['sql-thinking', 'select', 'sorting'],
  'row-selection': ['filtering', 'null-logic-advanced'],
  aggregation: ['aggregates', 'grouping', 'conditional-aggregation'],
  relationships: ['joins', 'subqueries', 'advanced-joins'],
  'query-structure': ['cte', 'recursive-cte', 'set-ops'],
  'time-series': ['dates', 'windows', 'window-frames'],
  'data-shaping': ['text', 'json-sql', 'data-quality'],
  'safe-write': ['dml', 'schema', 'schema-evolution', 'transactions'],
  performance: ['indexes', 'explain', 'pagination-patterns'],
  security: ['sql-security'],
  operations: ['support', 'concurrency', 'incident-investigation', 'final']
};

const errorModules: Record<AssessmentErrorClass, readonly string[]> = {
  contract: ['sql-thinking', 'select'],
  logic: ['filtering', 'subqueries', 'cte', 'recursive-cte', 'set-ops'],
  null: ['filtering', 'null-logic-advanced', 'text', 'json-sql'],
  cardinality: ['joins', 'advanced-joins'],
  'aggregation-grain': ['aggregates', 'grouping', 'conditional-aggregation', 'windows', 'window-frames'],
  ordering: ['sorting', 'windows', 'window-frames', 'pagination-patterns'],
  'mutation-safety': ['dml', 'schema', 'schema-evolution', 'transactions'],
  'performance-plan': ['indexes', 'explain', 'pagination-patterns'],
  concurrency: ['transactions', 'concurrency'],
  'data-quality': ['dates', 'data-quality', 'sql-security', 'support', 'incident-investigation', 'final']
};

const difficultyMap: Record<Difficulty, AssessmentDifficultyBand> = {
  'База': 'foundation',
  'Рабочий': 'working',
  'Продвинутый': 'advanced',
  'Экспертный': 'expert'
};

const expectedSecondsByBand: Record<AssessmentDifficultyBand, number> = {
  foundation: 150,
  working: 240,
  advanced: 360,
  expert: 480
};

export function reasoningSkillForModule(moduleId: string): AssessmentReasoningSkill {
  return (Object.entries(skillModules) as Array<[AssessmentReasoningSkill, readonly string[]]>)
    .find(([, moduleIds]) => moduleIds.includes(moduleId))?.[0] || 'operations';
}

export function errorClassForModule(moduleId: string): AssessmentErrorClass {
  return (Object.entries(errorModules) as Array<[AssessmentErrorClass, readonly string[]]>)
    .find(([, moduleIds]) => moduleIds.includes(moduleId))?.[0] || 'logic';
}

function eligibleModes(task: SqlTask): CalibratedAssessmentMode[] {
  const modes: CalibratedAssessmentMode[] = ['quick'];
  if (task.mode === 'interview' && task.evaluationContractId && task.learningContract) modes.push('interview');
  if (task.mode !== 'lesson' && task.mode !== 'puzzle') modes.push('exam');
  if (task.mode !== 'puzzle') modes.push('diagnostic');
  if (task.mode !== 'lesson' && task.mode !== 'puzzle') modes.push('production', 'final');
  return Array.from(new Set(modes));
}

export const assessmentItemBank: AssessmentItemDefinition[] = tasks.map(task => {
  const difficultyBand = difficultyMap[task.difficulty];
  return {
    taskId: task.id,
    moduleId: task.module,
    reasoningSkill: reasoningSkillForModule(task.module),
    errorClass: errorClassForModule(task.module),
    authoredDifficulty: task.difficulty,
    difficultyBand,
    expectedSeconds: expectedSecondsByBand[difficultyBand],
    eligibleModes: eligibleModes(task)
  };
});

const itemById = new Map(assessmentItemBank.map(item => [item.taskId, item]));

export function assessmentItem(taskId: string) {
  return itemById.get(taskId) || null;
}

const diagnosticTasks = ['task-002', 'task-014', 'task-026', 'task-034', 'task-040', 'task-058', 'task-094'];
const productionAnchors = ['task-080', 'task-087', 'task-093', 'task-099', 'task-105', 'task-111', 'task-117', 'task-124', 'task-132', 'task-148', 'task-155', 'task-166', 'task-184', 'task-196', 'task-205', 'task-214', 'task-226', 'task-234'];
const finalAnchors = ['task-005', 'task-017', 'task-029', 'task-035', 'task-041', 'task-047', 'task-053', 'task-059', 'task-065', 'task-071', 'task-077', 'task-083', 'task-089', 'task-095', 'task-101', 'task-107', 'task-113', 'task-119', 'task-128', 'task-139', 'task-150', 'task-160', 'task-170', 'task-180', 'task-190', 'task-200', 'task-210', 'task-220', 'task-230', 'task-240'];

export const assessmentBlueprints: Record<CalibratedAssessmentMode, AssessmentBlueprint> = {
  quick: {
    version: ASSESSMENT_BLUEPRINT_VERSION,
    thresholdVersion: ASSESSMENT_THRESHOLD_VERSION,
    mode: 'quick',
    taskCount: 3,
    minimumDistinctModules: 3,
    minimumDistinctSkills: 3,
    slots: [
      { reasoningSkill: 'result-contract', count: 1 },
      { reasoningSkill: 'aggregation', count: 1 },
      { reasoningSkill: 'relationships', count: 1 }
    ],
    maximumFormOverlap: 0.34
  },
  interview: {
    version: ASSESSMENT_BLUEPRINT_VERSION,
    thresholdVersion: ASSESSMENT_THRESHOLD_VERSION,
    mode: 'interview',
    taskCount: 5,
    minimumDistinctModules: 5,
    minimumDistinctSkills: 5,
    // The authored interview bank is partitioned into four parallel forms. Keeping
    // slots open here lets every original scenario participate while the selector
    // still enforces five distinct reasoning skills per form.
    slots: [],
    maximumFormOverlap: 0
  },
  exam: {
    version: ASSESSMENT_BLUEPRINT_VERSION,
    thresholdVersion: ASSESSMENT_THRESHOLD_VERSION,
    mode: 'exam',
    taskCount: 8,
    minimumDistinctModules: 7,
    minimumDistinctSkills: 7,
    slots: [
      { reasoningSkill: 'row-selection', count: 1, difficultyBands: ['working', 'advanced'] },
      { reasoningSkill: 'aggregation', count: 1, difficultyBands: ['working', 'advanced', 'expert'] },
      { reasoningSkill: 'relationships', count: 1, difficultyBands: ['working', 'advanced', 'expert'] },
      { reasoningSkill: 'query-structure', count: 1, difficultyBands: ['working', 'advanced', 'expert'] },
      { reasoningSkill: 'time-series', count: 1, difficultyBands: ['working', 'advanced', 'expert'] },
      { reasoningSkill: 'safe-write', count: 1, difficultyBands: ['working', 'advanced', 'expert'] },
      { reasoningSkill: 'performance', count: 1, difficultyBands: ['working', 'advanced', 'expert'] },
      { reasoningSkill: 'operations', count: 1, difficultyBands: ['working', 'advanced', 'expert'] }
    ],
    maximumFormOverlap: 0.38
  },
  diagnostic: {
    version: ASSESSMENT_BLUEPRINT_VERSION,
    thresholdVersion: ASSESSMENT_THRESHOLD_VERSION,
    mode: 'diagnostic',
    taskCount: diagnosticTasks.length,
    minimumDistinctModules: 7,
    minimumDistinctSkills: 6,
    slots: [],
    fixedTaskIds: diagnosticTasks,
    maximumFormOverlap: 1
  },
  production: {
    version: ASSESSMENT_BLUEPRINT_VERSION,
    thresholdVersion: ASSESSMENT_THRESHOLD_VERSION,
    mode: 'production',
    taskCount: 18,
    minimumDistinctModules: 12,
    minimumDistinctSkills: 8,
    slots: [
      { reasoningSkill: 'result-contract', count: 1, difficultyBands: ['foundation', 'working', 'advanced'] },
      { reasoningSkill: 'row-selection', count: 1, difficultyBands: ['foundation', 'working', 'advanced'] },
      { reasoningSkill: 'aggregation', count: 2, difficultyBands: ['working', 'advanced', 'expert'] },
      { reasoningSkill: 'relationships', count: 2, difficultyBands: ['working', 'advanced', 'expert'] },
      { reasoningSkill: 'data-shaping', count: 2, difficultyBands: ['working', 'advanced'] },
      { reasoningSkill: 'safe-write', count: 4, difficultyBands: ['working', 'advanced', 'expert'] },
      { reasoningSkill: 'performance', count: 3, difficultyBands: ['working', 'advanced', 'expert'] },
      { reasoningSkill: 'operations', count: 3, difficultyBands: ['working', 'advanced', 'expert'] }
    ],
    anchorTaskIds: productionAnchors,
    maximumFormOverlap: 0.55
  },
  final: {
    version: ASSESSMENT_BLUEPRINT_VERSION,
    thresholdVersion: ASSESSMENT_THRESHOLD_VERSION,
    mode: 'final',
    taskCount: 30,
    minimumDistinctModules: 20,
    minimumDistinctSkills: 11,
    slots: [
      { reasoningSkill: 'result-contract', count: 2 },
      { reasoningSkill: 'row-selection', count: 2 },
      { reasoningSkill: 'aggregation', count: 3 },
      { reasoningSkill: 'relationships', count: 3 },
      { reasoningSkill: 'query-structure', count: 3 },
      { reasoningSkill: 'time-series', count: 3 },
      { reasoningSkill: 'data-shaping', count: 3 },
      { reasoningSkill: 'safe-write', count: 4 },
      { reasoningSkill: 'performance', count: 3 },
      { reasoningSkill: 'security', count: 1 },
      { reasoningSkill: 'operations', count: 3 }
    ],
    anchorTaskIds: finalAnchors,
    maximumFormOverlap: 0.6
  }
};
