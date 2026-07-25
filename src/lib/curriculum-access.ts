import { curriculumLessons, type CurriculumLesson } from '../data/complete-curriculum';
import { sqlExams } from '../data/sql-exams';
import type { AssessmentReport } from './assessment';
import type { CurriculumProgressV1 } from './curriculum-progress';
import { moduleMastery } from './learning-path';
import type { Progress } from './progress';

export const PREREQUISITE_MASTERY = 55;
export const DIAGNOSTIC_MODULE_BYPASS = 70;
export const DIAGNOSTIC_GLOBAL_BYPASS = 85;

export type ModuleAccessEvidence = {
  moduleId: string;
  ready: boolean;
  taskMastery: number;
  lessonsCompleted: number;
  lessonsTotal: number;
  diagnosticModuleScore: number;
  diagnosticGlobalScore: number;
  source: 'tasks' | 'lessons' | 'diagnostic-module' | 'diagnostic-global' | 'missing';
};

export type LessonAccess = {
  unlocked: boolean;
  missing: ModuleAccessEvidence[];
  bypassed: ModuleAccessEvidence[];
};

function bestDiagnosticReports(reports: AssessmentReport[]) {
  return reports
    .filter(report => report.mode === 'diagnostic' && report.status === 'completed')
    .sort((left, right) => right.score - left.score || right.completedAt.localeCompare(left.completedAt));
}

export function moduleAccessEvidence(
  moduleId: string,
  progress: Progress,
  curriculum: CurriculumProgressV1,
  reports: AssessmentReport[]
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

  const source = mastery >= PREREQUISITE_MASTERY
    ? 'tasks'
    : lessons.length > 0 && lessonsCompleted === lessons.length
      ? 'lessons'
      : diagnosticModuleScore >= DIAGNOSTIC_MODULE_BYPASS
        ? 'diagnostic-module'
        : diagnosticGlobalScore >= DIAGNOSTIC_GLOBAL_BYPASS
          ? 'diagnostic-global'
          : 'missing';

  return {
    moduleId,
    ready: source !== 'missing',
    taskMastery: mastery,
    lessonsCompleted,
    lessonsTotal: lessons.length,
    diagnosticModuleScore,
    diagnosticGlobalScore,
    source
  };
}

export function lessonAccess(
  lesson: CurriculumLesson,
  progress: Progress,
  curriculum: CurriculumProgressV1,
  reports: AssessmentReport[]
): LessonAccess {
  const evidence = lesson.prerequisites.map(moduleId => moduleAccessEvidence(moduleId, progress, curriculum, reports));
  return {
    unlocked: evidence.every(item => item.ready),
    missing: evidence.filter(item => !item.ready),
    bypassed: evidence.filter(item => item.source === 'diagnostic-module' || item.source === 'diagnostic-global')
  };
}

export function unlockedLessons(
  progress: Progress,
  curriculum: CurriculumProgressV1,
  reports: AssessmentReport[]
) {
  return curriculumLessons.filter(lesson => lessonAccess(lesson, progress, curriculum, reports).unlocked);
}

export function diagnosticPassingScore() {
  return sqlExams.find(exam => exam.id === 'diagnostic')?.passingScore || 60;
}
