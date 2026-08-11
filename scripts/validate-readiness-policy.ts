import {
  capstoneProjects,
  curriculumCheckpoints,
  curriculumLessons,
  type CurriculumLesson
} from '../src/data/complete-curriculum.ts';
import { lessonChecks } from '../src/data/lesson-checks.ts';
import { modules, tasks } from '../src/data/course-catalog.ts';
import { evaluationContractForTask } from '../src/data/foundation-evaluation-contracts.ts';
import type { AssessmentMode, AssessmentReport, AssessmentStatus } from '../src/lib/assessment.ts';
import type { CapstoneReport } from '../src/lib/capstone-evaluator.ts';
import { CHECKPOINT_PHASE_READINESS, type CheckpointReport, type CheckpointStatus } from '../src/lib/checkpoints.ts';
import { calculateCompleteReadiness } from '../src/lib/complete-readiness.ts';
import {
  DIAGNOSTIC_GLOBAL_BYPASS,
  DIAGNOSTIC_MODULE_BYPASS,
  moduleAccessEvidence,
  PREREQUISITE_MASTERY
} from '../src/lib/curriculum-access.ts';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress.ts';
import type { Progress } from '../src/lib/progress.ts';
import { normalizedEvidenceScore, READINESS_POLICY } from '../src/lib/readiness-policy.ts';
import { buildSkillEvidenceGraph } from '../src/lib/skill-evidence.ts';
import {
  FOUNDATION_EVIDENCE_CONTRACT_VERSION,
  TASK_EVALUATION_CONTRACT_VERSION
} from '../src/lib/task-evaluation-contract.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const now = '2026-07-25T12:00:00.000Z';

function progressFor(taskIds: string[]): Progress {
  return {
    version: 4,
    completed: [...taskIds],
    taskStats: Object.fromEntries(taskIds.map(taskId => {
      const contract = evaluationContractForTask(taskId);
      const fixtureIds = contract?.fixtures.map(fixture => fixture.id) || [];
      return [taskId, {
        attempts: 1,
        incorrect: 0,
        hintsUsed: 0,
        independentPasses: 1,
        completedAt: now,
        lastAttemptAt: now,
        ...(contract ? {
          evidenceContractVersion: FOUNDATION_EVIDENCE_CONTRACT_VERSION,
          evaluationContractId: contract.id,
          evaluationContractVersion: TASK_EVALUATION_CONTRACT_VERSION,
          validatedFixtureIds: fixtureIds,
          hiddenFixtureIds: contract.fixtures
            .filter(fixture => fixture.visibility !== 'public')
            .map(fixture => fixture.id)
        } : {})
      }];
    })),
    xp: tasks.filter(task => taskIds.includes(task.id)).reduce((sum, task) => sum + task.xp, 0),
    streak: taskIds.length ? 1 : 0,
    history: days.map(day => ({ day, solved: 0 }))
  };
}

function curriculumEvidence(lessons: CurriculumLesson[], includeProjects = false) {
  return {
    ...emptyCurriculumProgress(),
    completedSections: lessons.flatMap(lesson => lesson.sections.map(section => section.id)),
    completedLessons: lessons.map(lesson => lesson.id),
    completedProjects: includeProjects ? capstoneProjects.map(project => project.id) : [],
    answers: Object.fromEntries(lessons.flatMap(lesson => lessonChecks(lesson).map(check => [check.id, {
      optionIndex: check.correctIndex,
      correct: true,
      answeredAt: now
    }]))),
    updatedAt: now
  };
}

function assessmentReport(
  id: string,
  mode: AssessmentMode,
  status: Exclude<AssessmentStatus, 'active'>,
  score: number,
  moduleScores: Array<{ module: string; score: number }> = []
): AssessmentReport {
  return {
    version: 1,
    id,
    userId: 'readiness-validator',
    mode,
    status,
    startedAt: now,
    completedAt: now,
    durationSeconds: 600,
    score,
    grade: score >= 80 ? 'strong' : score >= 65 ? 'ready' : score >= 45 ? 'developing' : 'foundation',
    accuracy: score,
    firstAttemptRate: score,
    independence: score,
    readinessDelta: 0,
    taskScores: [],
    moduleScores: moduleScores.map(item => ({
      module: item.module,
      title: item.module,
      score: item.score,
      correct: item.score >= 70 ? 1 : 0,
      total: 1
    })),
    strengths: [],
    weaknesses: [],
    localDebrief: 'Deterministic readiness policy fixture.'
  };
}

function checkpointReport(
  checkpointId: string,
  status: Exclude<CheckpointStatus, 'active'> = 'completed',
  score = 100
): CheckpointReport {
  const checkpoint = curriculumCheckpoints.find(item => item.id === checkpointId);
  if (!checkpoint) throw new Error(`Unknown checkpoint ${checkpointId}`);
  return {
    version: 1,
    id: `report-${checkpointId}-${status}`,
    userId: 'readiness-validator',
    checkpointId,
    status,
    startedAt: now,
    completedAt: now,
    durationSeconds: 600,
    attemptNumber: 1,
    score,
    bestScore: score,
    passingScore: checkpoint.passingScore,
    passed: status === 'completed' && score >= checkpoint.passingScore,
    accuracy: score,
    firstAttemptRate: score,
    independence: score,
    taskScores: checkpoint.taskIds.map(taskId => {
      const task = tasks.find(item => item.id === taskId);
      return {
        taskId,
        title: task?.title || taskId,
        module: task?.module || checkpoint.moduleIds[0] || 'sql-thinking',
        correct: score >= checkpoint.passingScore,
        skipped: false,
        attempts: 1,
        elapsedSeconds: 60,
        score
      };
    }),
    moduleScores: checkpoint.moduleIds.map(module => ({
      module,
      title: modules.find(([id]) => id === module)?.[1] || module,
      score,
      correct: score >= checkpoint.passingScore ? 1 : 0,
      total: 1
    })),
    remediationModules: []
  };
}

function capstoneReport(projectId: string, score = 100): CapstoneReport {
  return {
    version: 1,
    id: `capstone-report-${projectId}`,
    userId: 'readiness-validator',
    projectId,
    status: 'passed',
    startedAt: now,
    completedAt: now,
    durationSeconds: 1200,
    attemptNumber: 1,
    score,
    bestScore: score,
    passingScore: 80,
    passed: true,
    provenance: 'independent',
    independence: 100,
    guidanceUses: 0,
    solutionViews: 0,
    files: [],
    submissionFiles: {},
    checks: [],
    reflection: 'Verified deterministic capstone fixture.',
    remediation: []
  };
}

const thresholds = READINESS_POLICY.thresholds;
assert(PREREQUISITE_MASTERY === thresholds.curriculumPrerequisite, 'Curriculum prerequisite threshold drifted from policy');
assert(DIAGNOSTIC_MODULE_BYPASS === thresholds.diagnosticModuleBypass, 'Module diagnostic bypass drifted from policy');
assert(DIAGNOSTIC_GLOBAL_BYPASS === thresholds.diagnosticGlobalBypass, 'Global diagnostic bypass drifted from policy');
assert(CHECKPOINT_PHASE_READINESS === thresholds.checkpointEligibility, 'Checkpoint eligibility threshold drifted from policy');

assert(normalizedEvidenceScore([
  { kind: 'practice', score: 100, applicable: true },
  { kind: 'project', score: 0, applicable: false }
]) === 100, 'Unavailable project evidence must not cap module readiness');
assert(normalizedEvidenceScore([
  { kind: 'practice', score: 50, applicable: true },
  { kind: 'lesson', score: 100, applicable: true }
]) === 58, 'Applicable evidence weights must be normalized deterministically');

const moduleWithoutProject = modules.find(([moduleId]) =>
  !capstoneProjects.some(project => project.moduleIds.some(candidate => candidate === moduleId))
)?.[0];
assert(Boolean(moduleWithoutProject), 'Expected at least one module without capstone coverage');

if (moduleWithoutProject) {
  const moduleTaskIds = tasks.filter(task => task.module === moduleWithoutProject).map(task => task.id);
  const moduleLessons = curriculumLessons.filter(lesson => lesson.module === moduleWithoutProject);
  const progress = progressFor(moduleTaskIds);
  const curriculum = curriculumEvidence(moduleLessons);
  const checkpoint = curriculumCheckpoints.find(item =>
    item.moduleIds.some(candidate => candidate === moduleWithoutProject)
  );
  assert(Boolean(checkpoint), `${moduleWithoutProject}: missing checkpoint coverage`);
  if (checkpoint) {
    const completedAssessment = assessmentReport(
      'completed-module-assessment',
      'quick',
      'completed',
      100,
      [{ module: moduleWithoutProject, score: 100 }]
    );
    const graph = buildSkillEvidenceGraph(
      progress,
      curriculum,
      [completedAssessment],
      [checkpointReport(checkpoint.id)]
    );
    const evidence = graph.modules.find(item => item.moduleId === moduleWithoutProject);
    assert(evidence?.evidence.project.available === false, `${moduleWithoutProject}: unrelated project must be unavailable`);
    assert(evidence?.readiness === 100, `${moduleWithoutProject}: full applicable evidence must reach 100, got ${evidence?.readiness}`);

    const invalidGraph = buildSkillEvidenceGraph(
      progressFor([]),
      emptyCurriculumProgress(),
      [assessmentReport('expired-module-assessment', 'quick', 'expired', 100, [{ module: moduleWithoutProject, score: 100 }])],
      [checkpointReport(checkpoint.id, 'expired', 100)]
    );
    const invalidEvidence = invalidGraph.modules.find(item => item.moduleId === moduleWithoutProject);
    assert(invalidEvidence?.evidence.assessment.score === 0, 'Expired assessment must not contribute module score');
    assert(invalidEvidence?.evidence.assessment.completed === 0, 'Expired assessment must not count as completed evidence');
    assert(!invalidEvidence?.evidence.assessment.sourceIds.length, 'Expired assessment must not appear as evidence source');
    assert(invalidEvidence?.evidence.checkpoint.score === 0, 'Expired checkpoint must not contribute module score');
    assert(!invalidEvidence?.evidence.checkpoint.sourceIds.length, 'Expired checkpoint must not appear as evidence source');
  }
}

const allProgress = progressFor(tasks.map(task => task.id));
const allCurriculum = curriculumEvidence(curriculumLessons, true);
const allCheckpointReports = curriculumCheckpoints.map(checkpoint => checkpointReport(checkpoint.id));
const allCapstoneReports = capstoneProjects.map(project => capstoneReport(project.id));

const legacyProjectReadiness = calculateCompleteReadiness(
  allProgress,
  allCurriculum,
  [
    assessmentReport('legacy-completed-production', 'production', 'completed', 100),
    assessmentReport('legacy-completed-final', 'final', 'completed', 100)
  ],
  allCheckpointReports,
  []
);
assert(legacyProjectReadiness.projectCompletion === 0, 'Legacy completedProjects must contribute zero project readiness');
assert(!legacyProjectReadiness.certificateEligible, 'Legacy project checkboxes must not unlock certificate');

const expiredExamReadiness = calculateCompleteReadiness(
  allProgress,
  allCurriculum,
  [
    assessmentReport('expired-production', 'production', 'expired', 100),
    assessmentReport('abandoned-final', 'final', 'abandoned', 100)
  ],
  allCheckpointReports,
  allCapstoneReports
);
assert((expiredExamReadiness.examScores.production || 0) === 0, 'Expired Production exam must not become best score');
assert((expiredExamReadiness.examScores.final || 0) === 0, 'Abandoned Final exam must not become best score');
assert(!expiredExamReadiness.certificateEligible, 'Invalid exam attempts must never unlock certificate');

const completedExamReadiness = calculateCompleteReadiness(
  allProgress,
  allCurriculum,
  [
    assessmentReport('completed-production', 'production', 'completed', 100),
    assessmentReport('completed-final', 'final', 'completed', 100)
  ],
  allCheckpointReports,
  allCapstoneReports
);
assert(completedExamReadiness.examScores.production === 100, 'Completed Production score must be retained');
assert(completedExamReadiness.examScores.final === 100, 'Completed Final score must be retained');
assert(completedExamReadiness.projectCompletion === 100, 'All passed capstone reports must produce 100% project readiness');
assert(completedExamReadiness.certificateEligible, 'Complete valid report evidence should unlock certificate');

const projectModule = capstoneProjects[0]?.moduleIds[0];
if (projectModule) {
  const graph = buildSkillEvidenceGraph(
    allProgress,
    allCurriculum,
    [],
    allCheckpointReports,
    allCapstoneReports
  );
  const projectEvidence = graph.modules.find(item => item.moduleId === projectModule)?.evidence.project;
  assert(projectEvidence?.sourceKinds.includes('capstone-report'), `${projectModule}: project evidence must name capstone-report source`);
  assert(!projectEvidence?.sourceKinds.includes('project-progress'), `${projectModule}: legacy project-progress source must not remain authoritative`);
}

const prerequisiteModule = 'transactions';
const prerequisiteCheckpoint = curriculumCheckpoints.find(checkpoint =>
  checkpoint.moduleIds.some(moduleId => moduleId === prerequisiteModule)
);
assert(Boolean(prerequisiteCheckpoint), 'Transactions prerequisite checkpoint is missing');
if (prerequisiteCheckpoint) {
  const evidence = moduleAccessEvidence(
    prerequisiteModule,
    progressFor([]),
    emptyCurriculumProgress(),
    [],
    [checkpointReport(prerequisiteCheckpoint.id)]
  );
  assert(evidence.ready, 'Completed checkpoint report must satisfy curriculum prerequisite evidence');
  assert(evidence.source === 'checkpoint-report', 'Checkpoint prerequisite source must stay explicit');
}

if (failures.length) {
  console.error(`Readiness policy validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Readiness policy validated: normalized weights, completed-only reports, ${modules.length} modules, ${curriculumLessons.length} multi-check lessons, ${curriculumCheckpoints.length} checkpoints and ${capstoneProjects.length} immutable capstones.`);
