import {
  capstoneProjects,
  curriculumCheckpoints,
  curriculumLessons
} from '../data/complete-curriculum';
import { modules, tasks } from '../data/course-catalog';
import type { AssessmentReport } from './assessment';
import {
  bestCheckpointReport,
  checkpointPassed,
  type CheckpointReport
} from './checkpoints';
import type { CurriculumProgressV1 } from './curriculum-progress';
import { moduleMastery, phaseDefinitions } from './learning-path';
import type { Progress } from './progress';

export type EvidenceKind = 'lesson' | 'practice' | 'checkpoint' | 'assessment' | 'project';
export type RecommendedEvidenceAction = EvidenceKind | 'review';

export type EvidenceMetric = {
  kind: EvidenceKind;
  score: number;
  completed: number;
  total: number;
  available: boolean;
  sourceIds: string[];
};

export type ModuleSkillEvidence = {
  moduleId: string;
  title: string;
  phaseId: string;
  readiness: number;
  evidence: Record<EvidenceKind, EvidenceMetric>;
  blockers: string[];
  recommendedAction: RecommendedEvidenceAction;
  recommendedTargetId: string | null;
};

export type PhaseSkillEvidence = {
  phaseId: string;
  title: string;
  moduleIds: string[];
  readiness: number;
  checkpointId: string;
  checkpointPassed: boolean;
  completed: boolean;
  blockers: string[];
  completionCriteria: string[];
};

export type SkillEvidenceGraph = {
  generatedAt: string;
  modules: ModuleSkillEvidence[];
  phases: PhaseSkillEvidence[];
  overallReadiness: number;
};

function clamp(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function bestModuleAssessmentScore(moduleId: string, reports: AssessmentReport[]) {
  return reports.reduce((best, report) => {
    const moduleScore = report.moduleScores.find(item => item.module === moduleId)?.score || 0;
    return Math.max(best, moduleScore);
  }, 0);
}

function bestModuleCheckpointScore(moduleId: string, reports: CheckpointReport[]) {
  return reports.reduce((best, report) => {
    const moduleScore = report.moduleScores.find(item => item.module === moduleId)?.score || 0;
    return Math.max(best, moduleScore);
  }, 0);
}

function metric(
  kind: EvidenceKind,
  score: number,
  completed: number,
  total: number,
  sourceIds: string[]
): EvidenceMetric {
  return {
    kind,
    score: clamp(score),
    completed,
    total,
    available: total > 0 || sourceIds.length > 0,
    sourceIds
  };
}

export function buildSkillEvidenceGraph(
  progress: Progress,
  curriculum: CurriculumProgressV1,
  assessmentReports: AssessmentReport[],
  checkpointReports: CheckpointReport[]
): SkillEvidenceGraph {
  const mastery = moduleMastery(progress);
  const completedLessons = new Set(curriculum.completedLessons);
  const completedProjects = new Set(curriculum.completedProjects);

  const moduleEvidence = modules.map(([moduleId, title]) => {
    const masteryState = mastery.find(item => item.id === moduleId);
    const moduleLessons = curriculumLessons.filter(lesson => lesson.module === moduleId);
    const completedModuleLessons = moduleLessons.filter(lesson => completedLessons.has(lesson.id));
    const moduleTasks = tasks.filter(task => task.module === moduleId);
    const solvedTasks = moduleTasks.filter(task => progress.completed.includes(task.id));
    const moduleCheckpoints = curriculumCheckpoints.filter(checkpoint =>
      checkpoint.moduleIds.some(candidate => candidate === moduleId)
    );
    const passedModuleCheckpoints = moduleCheckpoints.filter(checkpoint =>
      checkpointPassed(checkpoint.id, progress, checkpointReports)
    );
    const checkpointScore = bestModuleCheckpointScore(moduleId, checkpointReports);
    const assessmentScore = bestModuleAssessmentScore(moduleId, assessmentReports);
    const assessmentSourceIds = assessmentReports
      .filter(report => report.moduleScores.some(item => item.module === moduleId))
      .map(report => report.id);
    const relatedProjects = capstoneProjects.filter(project => project.moduleIds.some(candidate => candidate === moduleId));
    const completedRelatedProjects = relatedProjects.filter(project => completedProjects.has(project.id));

    const lessonScore = moduleLessons.length
      ? completedModuleLessons.length / moduleLessons.length * 100
      : 0;
    const practiceScore = masteryState?.mastery || 0;
    const projectScore = relatedProjects.length
      ? completedRelatedProjects.length / relatedProjects.length * 100
      : 0;

    const evidence: Record<EvidenceKind, EvidenceMetric> = {
      lesson: metric(
        'lesson',
        lessonScore,
        completedModuleLessons.length,
        moduleLessons.length,
        completedModuleLessons.map(lesson => lesson.id)
      ),
      practice: metric(
        'practice',
        practiceScore,
        solvedTasks.length,
        moduleTasks.length,
        solvedTasks.map(task => task.id)
      ),
      checkpoint: metric(
        'checkpoint',
        checkpointScore,
        passedModuleCheckpoints.length,
        moduleCheckpoints.length,
        checkpointReports
          .filter(report => report.moduleScores.some(item => item.module === moduleId))
          .map(report => report.id)
      ),
      assessment: metric(
        'assessment',
        assessmentScore,
        assessmentSourceIds.length,
        assessmentSourceIds.length ? assessmentSourceIds.length : 1,
        assessmentSourceIds
      ),
      project: metric(
        'project',
        projectScore,
        completedRelatedProjects.length,
        relatedProjects.length,
        completedRelatedProjects.map(project => project.id)
      )
    };

    const readiness = clamp(
      evidence.practice.score * 0.55
      + evidence.lesson.score * 0.1
      + evidence.checkpoint.score * 0.15
      + evidence.assessment.score * 0.15
      + evidence.project.score * 0.05
    );
    const blockers: string[] = [];
    if (evidence.lesson.score < 100) blockers.push('Не завершены структурированные уроки');
    if (evidence.practice.score < 55) blockers.push('Недостаточно самостоятельной практики');
    if (moduleCheckpoints.length && evidence.checkpoint.completed < moduleCheckpoints.length) blockers.push('Нет passed checkpoint evidence');
    if (assessmentScore < 60) blockers.push('Нет устойчивого assessment evidence');

    let recommendedAction: RecommendedEvidenceAction = 'review';
    let recommendedTargetId: string | null = null;
    const nextLesson = moduleLessons.find(lesson => !completedLessons.has(lesson.id));
    const nextTask = masteryState?.recommendedTask || null;
    const nextCheckpoint = moduleCheckpoints.find(checkpoint =>
      !checkpointPassed(checkpoint.id, progress, checkpointReports)
    );
    const nextProject = relatedProjects.find(project => !completedProjects.has(project.id));

    if (nextLesson) {
      recommendedAction = 'lesson';
      recommendedTargetId = nextLesson.id;
    } else if (practiceScore < 65 && nextTask) {
      recommendedAction = 'practice';
      recommendedTargetId = nextTask.id;
    } else if (nextCheckpoint) {
      recommendedAction = 'checkpoint';
      recommendedTargetId = nextCheckpoint.id;
    } else if (assessmentScore < 70) {
      recommendedAction = 'assessment';
    } else if (nextProject) {
      recommendedAction = 'project';
      recommendedTargetId = nextProject.id;
    }

    return {
      moduleId,
      title,
      phaseId: masteryState?.phaseId || phaseDefinitions[0].id,
      readiness,
      evidence,
      blockers,
      recommendedAction,
      recommendedTargetId
    } satisfies ModuleSkillEvidence;
  });

  const phases = phaseDefinitions.map((definition, index) => {
    const phaseModules = moduleEvidence.filter(item => definition.moduleIds.some(id => id === item.moduleId));
    const checkpoint = curriculumCheckpoints[index];
    if (!checkpoint) throw new Error(`Missing checkpoint definition for phase ${definition.id}`);
    const report = bestCheckpointReport(checkpoint.id, checkpointReports);
    const passed = checkpointPassed(checkpoint.id, progress, checkpointReports);
    const readiness = clamp(
      phaseModules.reduce((sum, item) => sum + item.readiness, 0) / Math.max(1, phaseModules.length)
    );
    const blockers: string[] = [];
    if (index > 0) {
      const previousCheckpoint = curriculumCheckpoints[index - 1];
      if (previousCheckpoint && !checkpointPassed(previousCheckpoint.id, progress, checkpointReports)) {
        blockers.push(`Не пройден предыдущий checkpoint: ${previousCheckpoint.title}`);
      }
    }
    if (phaseModules.some(item => item.evidence.practice.score < 48)) {
      blockers.push('Есть модуль с practice mastery ниже 48%');
    }
    if (!passed) blockers.push('Нет passed checkpoint report');

    return {
      phaseId: definition.id,
      title: definition.title,
      moduleIds: [...definition.moduleIds],
      readiness,
      checkpointId: checkpoint.id,
      checkpointPassed: passed,
      completed: passed && phaseModules.every(item => item.evidence.practice.score >= 48),
      blockers,
      completionCriteria: [
        'Practice mastery каждого модуля не ниже 48%',
        `Checkpoint score не ниже ${checkpoint.passingScore}%`,
        'Отчёт сохранён как evidence и доступен после синхронизации',
        report ? `Текущий лучший checkpoint score: ${report.bestScore}%` : 'Checkpoint ещё не выполнялся'
      ]
    } satisfies PhaseSkillEvidence;
  });

  return {
    generatedAt: new Date().toISOString(),
    modules: moduleEvidence,
    phases,
    overallReadiness: clamp(
      moduleEvidence.reduce((sum, item) => sum + item.readiness, 0) / Math.max(1, moduleEvidence.length)
    )
  };
}
