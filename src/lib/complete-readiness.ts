import { capstoneProjects, curriculumCheckpoints, curriculumLessons } from '../data/complete-curriculum';
import { assessmentModes, type AssessmentMode, type AssessmentReport } from './assessment';
import {
  checkpointPassed,
  loadLocalCheckpointReports,
  type CheckpointReport
} from './checkpoints';
import type { CurriculumProgressV1 } from './curriculum-progress';
import { overallReadiness } from './learning-path';
import type { Progress } from './progress';

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
  for (const report of reports) {
    scores[report.mode] = Math.max(scores[report.mode] || 0, report.score);
  }
  return scores;
}

export function calculateCompleteReadiness(
  progress: Progress,
  curriculum: CurriculumProgressV1,
  reports: AssessmentReport[],
  checkpointReports: CheckpointReport[] = loadLocalCheckpointReports()
): CompleteReadiness {
  const taskReadiness = overallReadiness(progress);
  const lessonCompletion = clamp(
    curriculum.completedLessons.length / Math.max(1, curriculumLessons.length) * 100
  );
  const passedCheckpoints = curriculumCheckpoints.filter(checkpoint =>
    checkpointPassed(checkpoint.id, progress, checkpointReports)
  ).length;
  const checkpointCompletion = clamp(
    passedCheckpoints / Math.max(1, curriculumCheckpoints.length) * 100
  );
  const projectCompletion = clamp(
    curriculum.completedProjects.length / Math.max(1, capstoneProjects.length) * 100
  );
  const examScores = bestScores(reports);
  const diagnostic = examScores.diagnostic || 0;
  const production = examScores.production || 0;
  const final = examScores.final || 0;
  const examReadiness = clamp(diagnostic * 0.1 + production * 0.3 + final * 0.6);
  const total = clamp(
    taskReadiness * 0.45
    + lessonCompletion * 0.15
    + checkpointCompletion * 0.1
    + projectCompletion * 0.1
    + examReadiness * 0.2
  );

  const criteria: ReadinessCriterion[] = [
    {
      id: 'tasks',
      title: 'Task mastery',
      current: taskReadiness,
      target: 80,
      passed: taskReadiness >= 80,
      unit: '%'
    },
    {
      id: 'lessons',
      title: 'Структурированные уроки',
      current: curriculum.completedLessons.length,
      target: Math.ceil(curriculumLessons.length * 0.9),
      passed: lessonCompletion >= 90,
      unit: 'count'
    },
    {
      id: 'checkpoints',
      title: 'Исполняемые checkpoints',
      current: passedCheckpoints,
      target: curriculumCheckpoints.length,
      passed: passedCheckpoints === curriculumCheckpoints.length,
      unit: 'count'
    },
    {
      id: 'projects',
      title: 'Capstone-проекты',
      current: curriculum.completedProjects.length,
      target: capstoneProjects.length,
      passed: curriculum.completedProjects.length === capstoneProjects.length,
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
    projectCompletion,
    examReadiness,
    examScores,
    certificateEligible: total >= 82 && criteria.every(item => item.passed),
    criteria
  };
}
