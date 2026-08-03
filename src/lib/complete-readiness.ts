import { capstoneProjects, curriculumCheckpoints, curriculumLessons } from '../data/complete-curriculum';
import { assessmentModes, type AssessmentMode, type AssessmentReport } from './assessment';
import type { CapstoneReport } from './capstone-evaluator';
import { bestCapstoneReport } from './capstone-report-policy';
import { loadLocalCapstoneReports } from './capstone-reports';
import { checkpointAttemptSnapshotFromReports } from './checkpoint-attempt-policy';
import {
  legacyCheckpointPassed,
  loadLocalCheckpointReports,
  type CheckpointReport
} from './checkpoints';
import type { CurriculumProgressV1 } from './curriculum-progress';
import { overallReadiness } from './learning-path';
import { masterySummary } from './mastery-loop';
import type { Progress } from './progress';
import {
  bestCompletedAssessmentScore,
  normalizedCompleteScore,
  READINESS_POLICY
} from './readiness-policy';

export type ReadinessCriterion = {
  id: string;
  title: string;
  current: number;
  target: number;
  passed: boolean;
  unit: '%' | 'count' | 'score';
};

export type CompleteReadiness = {
  total: number;
  taskReadiness: number;
  lessonCompletion: number;
  checkpointCompletion: number;
  reportedCheckpoints: number;
  legacyCheckpoints: number;
  projectCompletion: number;
  examReadiness: number;
  examScores: Partial<Record<AssessmentMode, number>>;
  certificateEligible: boolean;
  criteria: ReadinessCriterion[];
};

function clamp(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function bestScores(reports: AssessmentReport[]) {
  const scores: Partial<Record<AssessmentMode, number>> = {};
  for (const mode of Object.keys(assessmentModes) as AssessmentMode[]) {
    const score = bestCompletedAssessmentScore(reports, mode);
    if (score > 0) scores[mode] = score;
  }
  return scores;
}

export function calculateCompleteReadiness(
  progress: Progress,
  curriculum: CurriculumProgressV1,
  reports: AssessmentReport[],
  checkpointReports: CheckpointReport[] = loadLocalCheckpointReports(),
  capstoneReports: CapstoneReport[] = loadLocalCapstoneReports()
): CompleteReadiness {
  const thresholds = READINESS_POLICY.thresholds;
  const taskReadiness = overallReadiness(progress);
  const lessonMastery = masterySummary(progress, curriculum);
  const lessonCompletion = clamp(
    lessonMastery.applied / Math.max(1, curriculumLessons.length) * 100
  );

  const checkpointOwnerId = checkpointReports.find(report => report.status === 'completed')?.userId || null;
  const checkpointSnapshot = checkpointAttemptSnapshotFromReports(checkpointReports, checkpointOwnerId);
  const checkpointStates = new Map(checkpointSnapshot.states.map(state => [state.checkpointId, state]));
  const checkpointEvidence = curriculumCheckpoints.map(checkpoint => {
    const state = checkpointStates.get(checkpoint.id) || null;
    const reported = state?.currentAttempt.passed === true;
    const legacy = !state && legacyCheckpointPassed(checkpoint.id, progress);
    return { reported, legacy, passed: reported || legacy };
  });
  const reportedCheckpoints = checkpointEvidence.filter(item => item.reported).length;
  const legacyCheckpoints = checkpointEvidence.filter(item => item.legacy).length;
  const passedCheckpoints = checkpointEvidence.filter(item => item.passed).length;
  const checkpointCompletion = clamp(
    passedCheckpoints / Math.max(1, curriculumCheckpoints.length) * 100
  );

  const passedProjects = capstoneProjects.filter(project => Boolean(bestCapstoneReport(project.id, capstoneReports)));
  const projectCompletion = clamp(
    passedProjects.length / Math.max(1, capstoneProjects.length) * 100
  );
  const examScores = bestScores(reports);
  const diagnostic = examScores.diagnostic || 0;
  const production = examScores.production || 0;
  const final = examScores.final || 0;
  const examReadiness = clamp(diagnostic * 0.1 + production * 0.3 + final * 0.6);
  const total = normalizedCompleteScore([
    { kind: 'tasks', score: taskReadiness },
    { kind: 'lessons', score: lessonCompletion },
    { kind: 'checkpoints', score: checkpointCompletion },
    { kind: 'projects', score: projectCompletion },
    { kind: 'exams', score: examReadiness }
  ]);

  const criteria: ReadinessCriterion[] = [
    {
      id: 'tasks',
      title: 'Task mastery',
      current: taskReadiness,
      target: thresholds.certificateTaskReadiness,
      passed: taskReadiness >= thresholds.certificateTaskReadiness,
      unit: '%'
    },
    {
      id: 'lessons',
      title: 'Applied lesson mastery',
      current: lessonMastery.applied,
      target: Math.ceil(curriculumLessons.length * thresholds.certificateLessonCompletion / 100),
      passed: lessonCompletion >= thresholds.certificateLessonCompletion,
      unit: 'count'
    },
    {
      id: 'checkpoints',
      title: legacyCheckpoints
        ? `Checkpoints: ${reportedCheckpoints} current reports + ${legacyCheckpoints} migrated`
        : 'Исполняемые checkpoints · current attempts',
      current: passedCheckpoints,
      target: curriculumCheckpoints.length,
      passed: passedCheckpoints === curriculumCheckpoints.length,
      unit: 'count'
    },
    {
      id: 'projects',
      title: 'Verified executable capstones',
      current: passedProjects.length,
      target: capstoneProjects.length,
      passed: passedProjects.length === capstoneProjects.length,
      unit: 'count'
    },
    {
      id: 'production-exam',
      title: assessmentModes.production.title,
      current: production,
      target: assessmentModes.production.passingScore,
      passed: production >= assessmentModes.production.passingScore,
      unit: 'score'
    },
    {
      id: 'final-exam',
      title: assessmentModes.final.title,
      current: final,
      target: assessmentModes.final.passingScore,
      passed: final >= assessmentModes.final.passingScore,
      unit: 'score'
    }
  ];

  return {
    total,
    taskReadiness,
    lessonCompletion,
    checkpointCompletion,
    reportedCheckpoints,
    legacyCheckpoints,
    projectCompletion,
    examReadiness,
    examScores,
    certificateEligible: total >= thresholds.certificateOverall && criteria.every(item => item.passed),
    criteria
  };
}
