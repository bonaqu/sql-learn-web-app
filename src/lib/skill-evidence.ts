import {
  capstoneProjects,
  curriculumCheckpoints,
  curriculumLessons
} from '../data/complete-curriculum';
import { modules, tasks } from '../data/course-catalog';
import type { AssessmentReport } from './assessment';
import type { CapstoneReport } from './capstone-evaluator';
import { bestCapstoneReport } from './capstone-report-policy';
import { loadLocalCapstoneReports } from './capstone-reports';
import {
  checkpointAttemptSnapshotFromReports,
  type CheckpointAttemptState
} from './checkpoint-attempt-policy';
import {
  checkpointPassed,
  legacyCheckpointPassed,
  type CheckpointReport
} from './checkpoints';
import type { CurriculumProgressV1 } from './curriculum-progress';
import { moduleMastery, phaseDefinitions } from './learning-path';
import { moduleAppliedLessonScore } from './mastery-loop';
import type { Progress } from './progress';
import {
  bestCompletedModuleAssessmentScore,
  completedAssessmentReports,
  normalizedEvidenceScore,
  READINESS_POLICY,
  type ReadinessEvidenceKind,
  type ReadinessEvidenceSource
} from './readiness-policy';

export type EvidenceKind = ReadinessEvidenceKind;
export type RecommendedEvidenceAction = EvidenceKind | 'review';

export type EvidenceMetric = {
  kind: EvidenceKind;
  score: number;
  completed: number;
  total: number;
  available: boolean;
  sourceIds: string[];
  sourceKinds: ReadinessEvidenceSource[];
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
  checkpointSource: 'report' | 'legacy' | 'none';
  checkpointCurrentScore: number | null;
  checkpointHistoricalBestScore: number | null;
  checkpointAttemptNumber: number | null;
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

function metric(
  kind: EvidenceKind,
  score: number,
  completed: number,
  total: number,
  available: boolean,
  sourceIds: string[],
  sourceKinds: ReadinessEvidenceSource[]
): EvidenceMetric {
  return {
    kind,
    score: clamp(score),
    completed,
    total,
    available,
    sourceIds: [...new Set(sourceIds)],
    sourceKinds: [...new Set(sourceKinds)]
  };
}

function currentModuleCheckpointScore(state: CheckpointAttemptState, moduleId: string) {
  const moduleScores = state.currentAttempt.source.moduleScores;
  if (!Array.isArray(moduleScores)) return 0;
  return moduleScores.reduce((best, candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return best;
    const item = candidate as Record<string, unknown>;
    if (item.module !== moduleId) return best;
    const score = Number(item.score);
    return Number.isFinite(score) ? Math.max(best, clamp(score)) : best;
  }, 0);
}

export function buildSkillEvidenceGraph(
  progress: Progress,
  curriculum: CurriculumProgressV1,
  assessmentReports: AssessmentReport[],
  checkpointReports: CheckpointReport[],
  capstoneReports: CapstoneReport[] = loadLocalCapstoneReports()
): SkillEvidenceGraph {
  const thresholds = READINESS_POLICY.thresholds;
  const mastery = moduleMastery(progress);
  const validAssessmentReports = completedAssessmentReports(assessmentReports);
  const checkpointOwnerId = checkpointReports.find(report => report.status === 'completed')?.userId || null;
  const checkpointSnapshot = checkpointAttemptSnapshotFromReports(checkpointReports, checkpointOwnerId);
  const checkpointStates = new Map(checkpointSnapshot.states.map(state => [state.checkpointId, state]));

  const moduleEvidence = modules.map(([moduleId, title]) => {
    const masteryState = mastery.find(item => item.id === moduleId);
    const moduleLessons = curriculumLessons.filter(lesson => lesson.module === moduleId);
    const appliedLessons = moduleAppliedLessonScore(moduleId, progress, curriculum);
    const moduleTasks = tasks.filter(task => task.module === moduleId);
    const solvedTasks = moduleTasks.filter(task => progress.completed.includes(task.id));
    const moduleCheckpoints = curriculumCheckpoints.filter(checkpoint =>
      checkpoint.moduleIds.some(candidate => candidate === moduleId)
    );
    const moduleAttemptStates = moduleCheckpoints.flatMap(checkpoint => {
      const state = checkpointStates.get(checkpoint.id);
      return state ? [state] : [];
    });
    const directPassedCheckpoints = moduleCheckpoints.filter(checkpoint =>
      checkpointStates.get(checkpoint.id)?.currentAttempt.passed === true
    );
    const legacyPassedCheckpoints = moduleCheckpoints.filter(checkpoint =>
      !checkpointStates.has(checkpoint.id)
      && legacyCheckpointPassed(checkpoint.id, progress)
    );
    const checkpointScore = Math.max(
      ...moduleAttemptStates.map(state => currentModuleCheckpointScore(state, moduleId)),
      ...legacyPassedCheckpoints.map(checkpoint => checkpoint.passingScore),
      0
    );

    const assessmentScore = bestCompletedModuleAssessmentScore(validAssessmentReports, moduleId);
    const assessmentSourceIds = validAssessmentReports
      .filter(report => report.moduleScores.some(item => item.module === moduleId))
      .map(report => report.id);
    const relatedProjects = capstoneProjects.filter(project => project.moduleIds.some(candidate => candidate === moduleId));
    const completedRelatedProjects = relatedProjects.flatMap(project => {
      const report = bestCapstoneReport(project.id, capstoneReports);
      return report ? [{ project, report }] : [];
    });

    const lessonScore = appliedLessons.score;
    const practiceScore = masteryState?.mastery || 0;
    const projectScore = relatedProjects.length
      ? completedRelatedProjects.reduce((sum, item) => sum + item.report.score, 0) / relatedProjects.length
      : 0;

    const checkpointSourceIds = [
      ...moduleAttemptStates.map(state => state.currentAttempt.id),
      ...legacyPassedCheckpoints.map(checkpoint => `legacy:${checkpoint.id}`)
    ];
    const checkpointSourceKinds: ReadinessEvidenceSource[] = [
      ...(moduleAttemptStates.length ? ['checkpoint-report' as const] : []),
      ...(legacyPassedCheckpoints.length ? ['legacy-checkpoint-task' as const] : [])
    ];

    const evidence: Record<EvidenceKind, EvidenceMetric> = {
      lesson: metric(
        'lesson',
        lessonScore,
        appliedLessons.completed,
        appliedLessons.total,
        moduleLessons.length > 0,
        appliedLessons.lessonIds,
        appliedLessons.completed ? ['lesson-progress'] : []
      ),
      practice: metric(
        'practice',
        practiceScore,
        solvedTasks.length,
        moduleTasks.length,
        moduleTasks.length > 0,
        solvedTasks.map(task => task.id),
        solvedTasks.length ? ['task-progress'] : []
      ),
      checkpoint: metric(
        'checkpoint',
        checkpointScore,
        directPassedCheckpoints.length + legacyPassedCheckpoints.length,
        moduleCheckpoints.length,
        moduleCheckpoints.length > 0,
        checkpointSourceIds,
        checkpointSourceKinds
      ),
      assessment: metric(
        'assessment',
        assessmentScore,
        assessmentSourceIds.length ? 1 : 0,
        1,
        true,
        assessmentSourceIds,
        assessmentSourceIds.length ? ['assessment-report'] : []
      ),
      project: metric(
        'project',
        projectScore,
        completedRelatedProjects.length,
        relatedProjects.length,
        relatedProjects.length > 0,
        completedRelatedProjects.map(item => item.report.id),
        completedRelatedProjects.length ? ['capstone-report'] : []
      )
    };

    const readiness = normalizedEvidenceScore(
      (Object.keys(evidence) as EvidenceKind[]).map(kind => ({
        kind,
        score: evidence[kind].score,
        applicable: evidence[kind].available
      }))
    );
    const blockers: string[] = [];
    if (evidence.lesson.available && evidence.lesson.score < 100) blockers.push('Не завершён lesson mastery loop: теория, check и independent SQL');
    if (evidence.practice.available && evidence.practice.score < thresholds.curriculumPrerequisite) blockers.push('Недостаточно самостоятельной практики');
    if (evidence.checkpoint.available && evidence.checkpoint.completed < evidence.checkpoint.total) blockers.push('Нет passed checkpoint evidence');
    if (evidence.assessment.available && assessmentScore < thresholds.assessmentEvidence) blockers.push('Нет устойчивого completed assessment evidence');

    let recommendedAction: RecommendedEvidenceAction = 'review';
    let recommendedTargetId: string | null = null;
    const nextLesson = moduleLessons.find(lesson => !appliedLessons.lessonIds.includes(lesson.id));
    const nextTask = masteryState?.recommendedTask || null;
    const nextCheckpoint = moduleCheckpoints.find(checkpoint =>
      !checkpointPassed(checkpoint.id, progress, checkpointReports)
    );
    const nextProject = relatedProjects.find(project => !bestCapstoneReport(project.id, capstoneReports));

    if (nextLesson) {
      recommendedAction = 'lesson';
      recommendedTargetId = nextLesson.id;
    } else if (practiceScore < 65 && nextTask) {
      recommendedAction = 'practice';
      recommendedTargetId = nextTask.id;
    } else if (nextCheckpoint) {
      recommendedAction = 'checkpoint';
      recommendedTargetId = nextCheckpoint.id;
    } else if (assessmentScore < thresholds.assessmentRecommendation) {
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
    const attemptState = checkpointStates.get(checkpoint.id) || null;
    const reportPassed = attemptState?.currentAttempt.passed === true;
    const legacyPassed = !attemptState && legacyCheckpointPassed(checkpoint.id, progress);
    const passed = reportPassed || legacyPassed;
    const checkpointSource = reportPassed ? 'report' : legacyPassed ? 'legacy' : 'none';
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
    if (phaseModules.some(item => item.evidence.practice.score < thresholds.phasePracticeCompletion)) {
      blockers.push(`Есть модуль с practice mastery ниже ${thresholds.phasePracticeCompletion}%`);
    }
    if (!passed) blockers.push('Нет passed checkpoint evidence');

    return {
      phaseId: definition.id,
      title: definition.title,
      moduleIds: [...definition.moduleIds],
      readiness,
      checkpointId: checkpoint.id,
      checkpointPassed: passed,
      checkpointSource,
      checkpointCurrentScore: attemptState?.currentAttempt.score ?? null,
      checkpointHistoricalBestScore: attemptState?.historicalBestScore ?? null,
      checkpointAttemptNumber: attemptState?.currentAttempt.attemptNumber ?? null,
      completed: passed && phaseModules.every(item => item.evidence.practice.score >= thresholds.phasePracticeCompletion),
      blockers,
      completionCriteria: [
        `Practice mastery каждого модуля не ниже ${thresholds.phasePracticeCompletion}%`,
        `Checkpoint score не ниже ${checkpoint.passingScore}%`,
        checkpointSource === 'report'
          ? 'Источник: текущая completed checkpoint attempt, синхронизируемая между устройствами'
          : checkpointSource === 'legacy'
            ? 'Источник: migrated legacy task evidence; рекомендуется подтвердить новым report'
            : attemptState
              ? 'Последняя completed attempt не пройдена; historical best не открывает текущий gate'
              : 'Checkpoint evidence ещё не получено',
        attemptState
          ? `Текущая попытка #${attemptState.currentAttempt.attemptNumber}: ${attemptState.currentAttempt.score}%. Исторический максимум: ${attemptState.historicalBestScore}%`
          : 'Новый executable report отсутствует'
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
