import assert from 'node:assert/strict';
import {
  capstoneProjects,
  curriculumCheckpoints,
  curriculumLessons
} from '../src/data/complete-curriculum';
import { tasks } from '../src/data/course-catalog';
import { lessonChecks } from '../src/data/lesson-checks';
import type { AssessmentReport } from '../src/lib/assessment';
import type { CapstoneReport } from '../src/lib/capstone-evaluator';
import type { CheckpointReport } from '../src/lib/checkpoints';
import { calculateCompleteReadiness } from '../src/lib/complete-readiness';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress';
import type { Progress, TaskStats } from '../src/lib/progress';
import { buildSkillEvidenceGraph } from '../src/lib/skill-evidence';

const userId = 'checkpoint-current-readiness-validator';
const checkpoint = curriculumCheckpoints[0];
assert.ok(checkpoint, 'Current checkpoint readiness validation requires one checkpoint.');
const now = '2026-08-03T18:00:00.000Z';

function completeProgress(): Progress {
  const taskStats: Record<string, TaskStats> = {};
  for (const task of tasks) {
    taskStats[task.id] = {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      solutionViews: 0,
      independentPasses: 1,
      completedAt: now,
      lastAttemptAt: now,
      lastIndependentAt: now
    };
  }
  return {
    version: 4,
    completed: tasks.map(task => task.id),
    taskStats,
    xp: tasks.reduce((sum, task) => sum + task.xp, 0),
    streak: 1,
    history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }))
  };
}

function completeCurriculum() {
  return {
    ...emptyCurriculumProgress(),
    completedSections: curriculumLessons.flatMap(lesson => lesson.sections.map(section => section.id)),
    completedLessons: curriculumLessons.map(lesson => lesson.id),
    completedProjects: capstoneProjects.map(project => project.id),
    answers: Object.fromEntries(curriculumLessons.flatMap(lesson => lessonChecks(lesson).map(check => [check.id, {
      optionIndex: check.correctIndex,
      correct: true,
      answeredAt: now
    }]))),
    updatedAt: now
  };
}

function checkpointReport(
  target: typeof curriculumCheckpoints[number],
  id: string,
  completedAt: string,
  attemptNumber: number,
  score: number,
  passed: boolean,
  bestScore = score
): CheckpointReport {
  return {
    version: 1,
    id,
    userId,
    checkpointId: target.id,
    status: 'completed',
    startedAt: new Date(Date.parse(completedAt) - 300_000).toISOString(),
    completedAt,
    durationSeconds: 300,
    attemptNumber,
    score,
    bestScore,
    passingScore: target.passingScore,
    passed,
    accuracy: score,
    firstAttemptRate: score,
    independence: score,
    taskScores: target.taskIds.map(taskId => {
      const task = tasks.find(item => item.id === taskId);
      return {
        taskId,
        title: task?.title || taskId,
        module: task?.module || target.moduleIds[0],
        correct: passed,
        skipped: false,
        attempts: 1,
        elapsedSeconds: 60,
        score
      };
    }),
    moduleScores: target.moduleIds.map(module => ({
      module,
      title: module,
      score,
      correct: passed ? 1 : 0,
      total: 1
    })),
    remediationModules: passed ? [] : [...target.moduleIds]
  };
}

function assessmentReport(id: string, mode: 'production' | 'final'): AssessmentReport {
  return {
    version: 1,
    id,
    userId,
    mode,
    status: 'completed',
    startedAt: now,
    completedAt: now,
    durationSeconds: 600,
    score: 100,
    grade: 'strong',
    accuracy: 100,
    firstAttemptRate: 100,
    independence: 100,
    readinessDelta: 0,
    taskScores: [],
    moduleScores: [],
    strengths: [],
    weaknesses: [],
    localDebrief: 'Current checkpoint readiness validator.'
  };
}

function capstoneReport(projectId: string): CapstoneReport {
  return {
    version: 1,
    id: `current-readiness-capstone-${projectId}`,
    userId,
    projectId,
    status: 'passed',
    startedAt: now,
    completedAt: now,
    durationSeconds: 1200,
    attemptNumber: 1,
    score: 100,
    bestScore: 100,
    passingScore: 80,
    passed: true,
    provenance: 'independent',
    independence: 100,
    guidanceUses: 0,
    solutionViews: 0,
    files: [],
    submissionFiles: {},
    checks: [],
    reflection: 'Verified current-state checkpoint certificate fixture.',
    remediation: []
  };
}

const progress = completeProgress();
const curriculum = completeCurriculum();
const exams = [
  assessmentReport('current-readiness-production', 'production'),
  assessmentReport('current-readiness-final', 'final')
];
const projects = capstoneProjects.map(project => capstoneReport(project.id));
const basePassedReports = curriculumCheckpoints.map((item, index) => checkpointReport(
  item,
  `current-readiness-pass-${item.id}`,
  new Date(Date.parse(now) + index * 60_000).toISOString(),
  1,
  100,
  true
));
const olderPass = basePassedReports[0];
const newerFail = checkpointReport(
  checkpoint,
  'current-readiness-newer-fail',
  new Date(Date.parse(olderPass.completedAt) + 30_000).toISOString(),
  2,
  45,
  false,
  100
);
const reportsAfterFail = [...basePassedReports, newerFail];

const graphAfterFail = buildSkillEvidenceGraph(progress, curriculum, exams, reportsAfterFail, projects);
const failedPhase = graphAfterFail.phases[0];
assert.equal(failedPhase.checkpointId, checkpoint.id);
assert.equal(failedPhase.checkpointPassed, false,
  'A newer failed attempt must clear phase checkpoint completion.');
assert.equal(failedPhase.completed, false);
assert.equal(failedPhase.checkpointCurrentScore, 45);
assert.equal(failedPhase.checkpointHistoricalBestScore, 100);
assert.equal(failedPhase.checkpointAttemptNumber, 2);
assert.ok(failedPhase.completionCriteria.some(item => item.includes('Текущая попытка #2: 45%')));
assert.ok(failedPhase.completionCriteria.some(item => item.includes('Исторический максимум: 100%')));
for (const moduleId of checkpoint.moduleIds) {
  const evidence = graphAfterFail.modules.find(item => item.moduleId === moduleId);
  assert.equal(evidence?.evidence.checkpoint.completed, 0,
    `${moduleId}: a failed current checkpoint must not count as completed evidence.`);
  assert.equal(evidence?.evidence.checkpoint.score, 45,
    `${moduleId}: checkpoint readiness score must use the current attempt, not historical best.`);
}

const readinessAfterFail = calculateCompleteReadiness(
  progress,
  curriculum,
  exams,
  reportsAfterFail,
  projects
);
assert.equal(readinessAfterFail.reportedCheckpoints, curriculumCheckpoints.length - 1);
assert.equal(readinessAfterFail.checkpointCompletion < 100, true);
assert.equal(readinessAfterFail.certificateEligible, false,
  'A newer failed checkpoint must revoke current certificate eligibility despite historical best 100.');
assert.equal(
  readinessAfterFail.criteria.find(item => item.id === 'checkpoints')?.passed,
  false
);

const laterPass = checkpointReport(
  checkpoint,
  'current-readiness-later-pass',
  new Date(Date.parse(newerFail.completedAt) + 30_000).toISOString(),
  3,
  88,
  true,
  100
);
const restoredReports = [...reportsAfterFail, laterPass];
const restoredGraph = buildSkillEvidenceGraph(progress, curriculum, exams, restoredReports, projects);
assert.equal(restoredGraph.phases[0].checkpointPassed, true);
assert.equal(restoredGraph.phases[0].completed, true);
assert.equal(restoredGraph.phases[0].checkpointCurrentScore, 88);
assert.equal(restoredGraph.phases[0].checkpointHistoricalBestScore, 100);
const restoredReadiness = calculateCompleteReadiness(
  progress,
  curriculum,
  exams,
  restoredReports,
  projects
);
assert.equal(restoredReadiness.checkpointCompletion, 100);
assert.equal(restoredReadiness.certificateEligible, true,
  'A later passing attempt must restore certificate eligibility when every other criterion is complete.');

console.log('Current checkpoint readiness validated: newer fail revokes phase/module/certificate gates, historical best remains visible, and later pass restores current state.');
