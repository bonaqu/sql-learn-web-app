import {
  curriculumCheckpoints,
  curriculumLessons,
  type CurriculumLesson
} from '../data/complete-curriculum';
import { sqlExams } from '../data/sql-exams';
import type { AssessmentReport } from './assessment';
import {
  bestCheckpointReport,
  legacyCheckpointPassed,
  loadLocalCheckpointReports,
  type CheckpointReport
} from './checkpoints';
import type { CurriculumProgressV1 } from './curriculum-progress';
import { moduleMastery } from './learning-path';
import type { Progress } from './progress';
import {
  completedAssessmentReports,
  prerequisiteEvidenceSource,
  READINESS_POLICY,
  type PrerequisiteEvidenceSource
} from './readiness-policy';

export const PREREQUISITE_MASTERY = READINESS_POLICY.thresholds.curriculumPrerequisite;
export const DIAGNOSTIC_MODULE_BYPASS = READINESS_POLICY.thresholds.diagnosticModuleBypass;
export const DIAGNOSTIC_GLOBAL_BYPASS = READINESS_POLICY.thresholds.diagnosticGlobalBypass;

export type ModuleAccessEvidence = {
  moduleId: string;
  ready: boolean;
  taskMastery: number;
  lessonsCompleted: number;
  lessonsTotal: number;
  checkpointReportPassed: boolean;
  checkpointLegacyPassed: boolean;
  diagnosticModuleScore: number;
  diagnosticGlobalScore: number;
  source: PrerequisiteEvidenceSource;
};

export type LessonAccess = {
  unlocked: boolean;
  missing: ModuleAccessEvidence[];
  bypassed: ModuleAccessEvidence[];
};

function browserCheckpointReports() {
  return typeof localStorage === 'undefined' ? [] : loadLocalCheckpointReports();
}

function bestDiagnosticReports(reports: AssessmentReport[]) {
  return completedAssessmentReports(reports)
    .filter(report => report.mode === 'diagnostic')
    .sort((left, right) => right.score - left.score || right.completedAt.localeCompare(left.completedAt));
}

export function moduleAccessEvidence(
  moduleId: string,
  progress: Progress,
  curriculum: CurriculumProgressV1,
  reports: AssessmentReport[],
  checkpointReports: CheckpointReport[] = browserCheckpointReports()
): ModuleAccessEvidence {
  const mastery = moduleMastery(progress).find(item => item.id === moduleId)?.mastery || 0;
  const lessons = curriculumLessons.filter(lesson => lesson.module === moduleId);
  const lessonsCompleted = lessons.filter(lesson => curriculum.completedLessons.includes(lesson.id)).length;
  const diagnostics = bestDiagnosticReports(reports);
  const diagnosticGlobalScore = diagnostics[0]?.score || 0;
  const diagnosticModuleScore = diagnostics.reduce((best, report) => {
    const score = report.moduleScores.find(item => item.module === moduleId)?.score || 0;
    return Math.max(best, score);
  }, 0);

  const relatedCheckpoints = curriculumCheckpoints.filter(checkpoint =>
    checkpoint.moduleIds.some(candidate => candidate === moduleId)
  );
  const checkpointReportPassed = relatedCheckpoints.some(checkpoint =>
    Boolean(bestCheckpointReport(checkpoint.id, checkpointReports)?.passed)
  );
  const checkpointLegacyPassed = !checkpointReportPassed && relatedCheckpoints.some(checkpoint =>
    legacyCheckpointPassed(checkpoint.id, progress)
  );

  const candidateSource = prerequisiteEvidenceSource({
    taskMastery: mastery,
    lessonCompleted: lessons.length > 0 && lessonsCompleted === lessons.length,
    checkpointReportPassed,
    legacyCheckpointPassed: checkpointLegacyPassed,
    diagnosticModuleScore,
    diagnosticGlobalScore
  });
  const source: PrerequisiteEvidenceSource = candidateSource === 'diagnostic-global'
    ? 'missing'
    : candidateSource;

  return {
    moduleId,
    ready: source !== 'missing',
    taskMastery: mastery,
    lessonsCompleted,
    lessonsTotal: lessons.length,
    checkpointReportPassed,
    checkpointLegacyPassed,
    diagnosticModuleScore,
    diagnosticGlobalScore,
    source
  };
}

export function lessonAccess(
  lesson: CurriculumLesson,
  progress: Progress,
  curriculum: CurriculumProgressV1,
  reports: AssessmentReport[],
  checkpointReports: CheckpointReport[] = browserCheckpointReports()
): LessonAccess {
  const evidence = lesson.prerequisites.map(moduleId =>
    moduleAccessEvidence(moduleId, progress, curriculum, reports, checkpointReports)
  );
  return {
    unlocked: evidence.every(item => item.ready),
    missing: evidence.filter(item => !item.ready),
    bypassed: evidence.filter(item => item.source === 'diagnostic-module')
  };
}

export function unlockedLessons(
  progress: Progress,
  curriculum: CurriculumProgressV1,
  reports: AssessmentReport[],
  checkpointReports: CheckpointReport[] = browserCheckpointReports()
) {
  return curriculumLessons.filter(lesson =>
    lessonAccess(lesson, progress, curriculum, reports, checkpointReports).unlocked
  );
}

export function diagnosticPassingScore() {
  return sqlExams.find(exam => exam.id === 'diagnostic')?.passingScore || 60;
}
