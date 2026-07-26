import type { AssessmentMode, AssessmentReport } from './assessment';
import type { CheckpointReport } from './checkpoints';

export type ReadinessEvidenceKind = 'lesson' | 'practice' | 'checkpoint' | 'assessment' | 'project';
export type ReadinessEvidenceSource =
  | 'lesson-progress'
  | 'task-progress'
  | 'checkpoint-report'
  | 'legacy-checkpoint-task'
  | 'assessment-report'
  | 'capstone-report'
  | 'project-progress';

export const READINESS_POLICY = {
  moduleWeights: {
    lesson: 10,
    practice: 55,
    checkpoint: 15,
    assessment: 15,
    project: 5
  } satisfies Record<ReadinessEvidenceKind, number>,
  completeWeights: {
    tasks: 45,
    lessons: 15,
    checkpoints: 10,
    projects: 10,
    exams: 20
  },
  thresholds: {
    curriculumPrerequisite: 55,
    diagnosticModuleBypass: 70,
    diagnosticGlobalBypass: 85,
    checkpointEligibility: 42,
    phasePracticeCompletion: 48,
    assessmentEvidence: 60,
    assessmentRecommendation: 70,
    moduleMastered: 82,
    certificateOverall: 82,
    certificateTaskReadiness: 80,
    certificateLessonCompletion: 90
  }
} as const;

export type WeightedEvidenceInput = {
  kind: ReadinessEvidenceKind;
  score: number;
  applicable: boolean;
};

function clamp(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function completedAssessmentReports(reports: AssessmentReport[]) {
  return reports.filter(report => report.status === 'completed');
}

export function completedCheckpointReports(reports: CheckpointReport[]) {
  return reports.filter(report => report.status === 'completed');
}

export function normalizedEvidenceScore(inputs: WeightedEvidenceInput[]) {
  const applicable = inputs.filter(input => input.applicable);
  const weight = applicable.reduce((sum, input) => sum + READINESS_POLICY.moduleWeights[input.kind], 0);
  if (!weight) return 0;
  return clamp(applicable.reduce(
    (sum, input) => sum + clamp(input.score) * READINESS_POLICY.moduleWeights[input.kind],
    0
  ) / weight);
}

export function normalizedCompleteScore(inputs: Array<{
  kind: keyof typeof READINESS_POLICY.completeWeights;
  score: number;
}>) {
  const weight = inputs.reduce((sum, input) => sum + READINESS_POLICY.completeWeights[input.kind], 0);
  if (!weight) return 0;
  return clamp(inputs.reduce(
    (sum, input) => sum + clamp(input.score) * READINESS_POLICY.completeWeights[input.kind],
    0
  ) / weight);
}

export function bestCompletedAssessmentScore(
  reports: AssessmentReport[],
  mode: AssessmentMode
) {
  return completedAssessmentReports(reports)
    .filter(report => report.mode === mode)
    .reduce((best, report) => Math.max(best, report.score), 0);
}

export function bestCompletedModuleAssessmentScore(
  reports: AssessmentReport[],
  moduleId: string
) {
  return completedAssessmentReports(reports).reduce((best, report) => {
    const score = report.moduleScores.find(item => item.module === moduleId)?.score || 0;
    return Math.max(best, score);
  }, 0);
}

export function bestCompletedModuleCheckpointScore(
  reports: CheckpointReport[],
  moduleId: string
) {
  return completedCheckpointReports(reports).reduce((best, report) => {
    const score = report.moduleScores.find(item => item.module === moduleId)?.score || 0;
    return Math.max(best, score);
  }, 0);
}

export type PrerequisiteEvidenceInput = {
  taskMastery: number;
  lessonCompleted: boolean;
  checkpointReportPassed: boolean;
  legacyCheckpointPassed: boolean;
  diagnosticModuleScore: number;
  diagnosticGlobalScore: number;
};

export type PrerequisiteEvidenceSource =
  | 'tasks'
  | 'lessons'
  | 'checkpoint-report'
  | 'checkpoint-legacy'
  | 'diagnostic-module'
  | 'diagnostic-global'
  | 'missing';

export function prerequisiteEvidenceSource(
  input: PrerequisiteEvidenceInput
): PrerequisiteEvidenceSource {
  const thresholds = READINESS_POLICY.thresholds;
  if (input.taskMastery >= thresholds.curriculumPrerequisite) return 'tasks';
  if (input.lessonCompleted) return 'lessons';
  if (input.checkpointReportPassed) return 'checkpoint-report';
  if (input.legacyCheckpointPassed) return 'checkpoint-legacy';
  if (input.diagnosticModuleScore >= thresholds.diagnosticModuleBypass) return 'diagnostic-module';
  if (input.diagnosticGlobalScore >= thresholds.diagnosticGlobalBypass) return 'diagnostic-global';
  return 'missing';
}
