import {
  curriculumCheckpoints,
  type CourseModuleId,
  type CurriculumCheckpoint
} from '../data/complete-curriculum';
import { modules, tasks, type SqlTask } from '../data/course-catalog';
import { loadAuthSession } from './auth';
import {
  checkpointAttemptState,
  compareCheckpointAttempts
} from './checkpoint-attempt-policy';
import {
  CheckpointReportConflictError,
  sameImmutableCheckpointReport
} from './checkpoint-report-integrity';
import { moduleMastery } from './learning-path';
import type { Progress } from './progress';

export type CheckpointStatus = 'active' | 'completed' | 'expired' | 'abandoned';

export type CheckpointAnswer = {
  taskId: string;
  sql: string;
  attempts: number;
  incorrect: number;
  correct: boolean;
  skipped: boolean;
  elapsedSeconds: number;
  startedAt: string;
  completedAt?: string;
};

export type CheckpointSession = {
  version: 1;
  id: string;
  userId: string;
  checkpointId: string;
  status: CheckpointStatus;
  startedAt: string;
  updatedAt: string;
  deadlineAt: string;
  taskIds: string[];
  currentIndex: number;
  answers: Record<string, CheckpointAnswer>;
};

export type CheckpointTaskScore = {
  taskId: string;
  title: string;
  module: string;
  correct: boolean;
  skipped: boolean;
  attempts: number;
  elapsedSeconds: number;
  score: number;
};

export type CheckpointModuleScore = {
  module: string;
  title: string;
  score: number;
  correct: number;
  total: number;
};

export type CheckpointReport = {
  version: 1;
  id: string;
  userId: string;
  checkpointId: string;
  status: Exclude<CheckpointStatus, 'active'>;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  attemptNumber: number;
  score: number;
  bestScore: number;
  passingScore: number;
  passed: boolean;
  accuracy: number;
  firstAttemptRate: number;
  independence: number;
  taskScores: CheckpointTaskScore[];
  moduleScores: CheckpointModuleScore[];
  remediationModules: string[];
};

export type CheckpointEligibility = {
  eligible: boolean;
  checkpoint: CurriculumCheckpoint;
  phaseReadiness: number;
  previousCheckpointId: string | null;
  previousPassed: boolean;
  blockers: string[];
};

export const CHECKPOINT_CHANGED_EVENT = 'sql-academy-checkpoint-changed';
export const CHECKPOINT_REPORTS_CHANGED_EVENT = 'sql-academy-checkpoint-reports-changed';
export const CHECKPOINT_PHASE_READINESS = 42;

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function sessionKey(userId: string) {
  return `sql-academy-checkpoint-session-v1:${userId}`;
}

function reportsKey(userId: string) {
  return `sql-academy-checkpoint-reports-v1:${userId}`;
}

function moduleTitle(moduleId: string) {
  return modules.find(([id]) => id === moduleId)?.[1] || moduleId;
}

function checkpointContainsModule(checkpoint: CurriculumCheckpoint, moduleId: string) {
  return checkpoint.moduleIds.some(candidate => candidate === moduleId);
}

function validModuleId(moduleId: string): moduleId is CourseModuleId {
  return modules.some(([id]) => id === moduleId);
}

function validReport(report: unknown, userId?: string): report is CheckpointReport {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return false;
  const value = report as Partial<CheckpointReport>;
  return value.version === 1
    && typeof value.id === 'string'
    && typeof value.userId === 'string'
    && (!userId || value.userId === userId)
    && typeof value.checkpointId === 'string'
    && Boolean(checkpointById(value.checkpointId))
    && (value.status === 'completed' || value.status === 'expired' || value.status === 'abandoned')
    && typeof value.completedAt === 'string'
    && typeof value.attemptNumber === 'number'
    && typeof value.score === 'number'
    && typeof value.bestScore === 'number'
    && typeof value.passed === 'boolean'
    && Array.isArray(value.taskScores)
    && Array.isArray(value.moduleScores)
    && Array.isArray(value.remediationModules);
}

export function checkpointById(checkpointId: string) {
  return curriculumCheckpoints.find(checkpoint => checkpoint.id === checkpointId) || null;
}

export function checkpointDurationMinutes(checkpointId: string) {
  const index = curriculumCheckpoints.findIndex(item => item.id === checkpointId);
  return index >= 4 ? 35 : 30;
}

function legacyCheckpointTask(checkpoint: CurriculumCheckpoint): SqlTask | null {
  const candidates = tasks.filter(task => checkpointContainsModule(checkpoint, task.module));
  return [...candidates].sort((left, right) => {
    const weight = (task: SqlTask) => task.mode === 'interview'
      ? 3
      : task.mode === 'puzzle'
        ? 2
        : task.mode === 'practice'
          ? 1
          : 0;
    return weight(right) - weight(left) || right.id.localeCompare(left.id);
  })[0] || null;
}

export function legacyCheckpointPassed(checkpointId: string, progress: Progress) {
  const checkpoint = checkpointById(checkpointId);
  const task = checkpoint ? legacyCheckpointTask(checkpoint) : null;
  return Boolean(task && progress.completed.includes(task.id));
}

export function bestCheckpointReport(checkpointId: string, reports: CheckpointReport[]) {
  return reports
    .filter(report => report.checkpointId === checkpointId && report.status === 'completed')
    .sort((left, right) =>
      right.score - left.score
      || compareCheckpointAttempts(left, right)
    )[0] || null;
}

export function currentCheckpointReport(checkpointId: string, reports: CheckpointReport[]) {
  const ownerId = reports.find(report => report.status === 'completed')?.userId || null;
  const state = checkpointAttemptState(checkpointId, reports, ownerId);
  if (!state) return null;
  return reports.find(report =>
    report.status === 'completed'
    && report.id === state.currentAttempt.id
    && report.userId === state.currentAttempt.userId
  ) || null;
}

export function checkpointPassed(checkpointId: string, progress: Progress, reports: CheckpointReport[]) {
  const current = currentCheckpointReport(checkpointId, reports);
  return current ? current.passed : legacyCheckpointPassed(checkpointId, progress);
}

export function checkpointEligibility(
  checkpointId: string,
  progress: Progress,
  reports: CheckpointReport[]
): CheckpointEligibility {
  const checkpoint = checkpointById(checkpointId);
  if (!checkpoint) throw new Error(`Unknown checkpoint ${checkpointId}`);

  const index = curriculumCheckpoints.findIndex(item => item.id === checkpointId);
  const previous = index > 0 ? curriculumCheckpoints[index - 1] : null;
  const mastery = moduleMastery(progress).filter(item => checkpointContainsModule(checkpoint, item.id));
  const phaseReadiness = clamp(
    mastery.reduce((sum, item) => sum + item.mastery, 0) / Math.max(1, mastery.length)
  );
  const previousPassed = !previous || checkpointPassed(previous.id, progress, reports);
  const blockers: string[] = [];

  if (!previousPassed && previous) blockers.push(`Сначала пройди «${previous.title}»`);
  if (phaseReadiness < CHECKPOINT_PHASE_READINESS) {
    blockers.push(`Подними readiness модулей этапа до ${CHECKPOINT_PHASE_READINESS}%`);
  }

  return {
    eligible: previousPassed && phaseReadiness >= CHECKPOINT_PHASE_READINESS,
    checkpoint,
    phaseReadiness,
    previousCheckpointId: previous?.id || null,
    previousPassed,
    blockers
  };
}

export function createCheckpointSession(
  checkpointId: string,
  progress: Progress,
  reports = loadLocalCheckpointReports()
): CheckpointSession {
  const auth = loadAuthSession();
  if (!auth) throw new Error('Необходим вход в аккаунт');

  const eligibility = checkpointEligibility(checkpointId, progress, reports);
  if (!eligibility.eligible) {
    throw new Error(eligibility.blockers.join('. ') || 'Checkpoint пока закрыт');
  }

  const selected = eligibility.checkpoint.taskIds.flatMap(taskId => {
    const task = tasks.find(item => item.id === taskId);
    return task ? [task] : [];
  });
  if (selected.length !== eligibility.checkpoint.taskIds.length) {
    throw new Error('Checkpoint содержит неизвестные задачи');
  }
  if (new Set(selected.map(task => task.id)).size !== selected.length) {
    throw new Error('Checkpoint содержит повторяющиеся задачи');
  }
  if (selected.some(task => !checkpointContainsModule(eligibility.checkpoint, task.module))) {
    throw new Error('Checkpoint содержит задачу из чужого модуля');
  }

  const now = new Date();
  const session: CheckpointSession = {
    version: 1,
    id: crypto.randomUUID(),
    userId: auth.userId,
    checkpointId,
    status: 'active',
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + checkpointDurationMinutes(checkpointId) * 60_000).toISOString(),
    taskIds: selected.map(task => task.id),
    currentIndex: 0,
    answers: Object.fromEntries(selected.map(task => [task.id, {
      taskId: task.id,
      sql: task.starter,
      attempts: 0,
      incorrect: 0,
      correct: false,
      skipped: false,
      elapsedSeconds: 0,
      startedAt: now.toISOString()
    }]))
  };

  return saveCheckpointSession(session);
}

export function loadCheckpointSession(userId = loadAuthSession()?.userId): CheckpointSession | null {
  if (!userId || typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionKey(userId)) || 'null') as CheckpointSession | null;
    if (!parsed
      || parsed.version !== 1
      || parsed.userId !== userId
      || parsed.status !== 'active'
      || !checkpointById(parsed.checkpointId)
      || !Array.isArray(parsed.taskIds)
      || !parsed.answers
      || typeof parsed.answers !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCheckpointSession(session: CheckpointSession) {
  const next = { ...session, updatedAt: new Date().toISOString() };
  localStorage.setItem(sessionKey(next.userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHECKPOINT_CHANGED_EVENT, { detail: next }));
  return next;
}

export function clearCheckpointSession(userId = loadAuthSession()?.userId) {
  if (!userId || typeof localStorage === 'undefined') return;
  localStorage.removeItem(sessionKey(userId));
  window.dispatchEvent(new CustomEvent(CHECKPOINT_CHANGED_EVENT, { detail: null }));
}

export function remainingCheckpointSeconds(session: CheckpointSession, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(session.deadlineAt).getTime() - now) / 1000));
}

export function currentCheckpointTask(session: CheckpointSession) {
  return tasks.find(task => task.id === session.taskIds[session.currentIndex]) || null;
}

export function mergeCheckpointAnswer(previous: CheckpointAnswer, patch: Partial<CheckpointAnswer>) {
  return {
    ...previous,
    ...patch,
    attempts: Math.max(previous.attempts, patch.attempts ?? previous.attempts),
    incorrect: Math.max(previous.incorrect, patch.incorrect ?? previous.incorrect),
    elapsedSeconds: Math.max(previous.elapsedSeconds, patch.elapsedSeconds ?? previous.elapsedSeconds),
    correct: previous.correct || patch.correct === true,
    skipped: patch.skipped ?? previous.skipped,
    completedAt: patch.completedAt || previous.completedAt
  } satisfies CheckpointAnswer;
}

export function updateCheckpointAnswer(
  session: CheckpointSession,
  taskId: string,
  patch: Partial<CheckpointAnswer>
) {
  const stored = loadCheckpointSession(session.userId);
  const base = stored?.id === session.id ? stored : session;
  const previous = base.answers[taskId];
  if (!previous) return base;

  return saveCheckpointSession({
    ...base,
    answers: {
      ...base.answers,
      [taskId]: mergeCheckpointAnswer(previous, patch)
    }
  });
}

export function goToCheckpointTask(session: CheckpointSession, index: number) {
  return saveCheckpointSession({
    ...session,
    currentIndex: clamp(index, 0, session.taskIds.length - 1)
  });
}

export function advanceCheckpoint(session: CheckpointSession) {
  return goToCheckpointTask(session, session.currentIndex + 1);
}

function taskScore(task: SqlTask, answer: CheckpointAnswer, expectedSeconds: number): CheckpointTaskScore {
  const accuracyScore = answer.correct ? 70 : 0;
  const attemptScore = answer.correct ? Math.round(20 / Math.max(1, answer.attempts)) : 0;
  const speedRatio = expectedSeconds / Math.max(1, answer.elapsedSeconds || expectedSeconds);
  const speedScore = answer.correct
    ? Math.round(Math.min(1, Math.max(0.25, speedRatio)) * 10)
    : 0;

  return {
    taskId: task.id,
    title: task.title,
    module: task.module,
    correct: answer.correct,
    skipped: answer.skipped,
    attempts: answer.attempts,
    elapsedSeconds: answer.elapsedSeconds,
    score: clamp(accuracyScore + attemptScore + speedScore)
  };
}

export function buildCheckpointReport(
  session: CheckpointSession,
  status: Exclude<CheckpointStatus, 'active'>,
  previousReports = loadLocalCheckpointReports(session.userId)
): CheckpointReport {
  const checkpoint = checkpointById(session.checkpointId);
  if (!checkpoint) throw new Error(`Unknown checkpoint ${session.checkpointId}`);

  const completedAt = new Date().toISOString();
  const durationSeconds = Math.max(
    1,
    Math.round((new Date(completedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
  );
  const expectedSeconds = checkpointDurationMinutes(checkpoint.id) * 60 / Math.max(1, session.taskIds.length);
  const taskScores = session.taskIds.map(taskId => {
    const task = tasks.find(item => item.id === taskId);
    const answer = session.answers[taskId];
    if (!task || !answer) throw new Error(`Checkpoint task ${taskId} is missing`);
    return taskScore(task, answer, expectedSeconds);
  });

  const score = clamp(
    taskScores.reduce((sum, item) => sum + item.score, 0) / Math.max(1, taskScores.length)
  );
  const correct = taskScores.filter(item => item.correct).length;
  const accuracy = clamp(correct / Math.max(1, taskScores.length) * 100);
  const firstAttemptRate = clamp(
    taskScores.filter(item => item.correct && item.attempts === 1).length
      / Math.max(1, taskScores.length)
      * 100
  );
  const independence = clamp(
    taskScores.reduce((sum, item) => {
      if (!item.correct) return sum;
      return sum + Math.max(0, 100 - Math.max(0, item.attempts - 1) * 20);
    }, 0) / Math.max(1, taskScores.length)
  );

  const grouped = new Map<string, CheckpointTaskScore[]>();
  for (const item of taskScores) {
    grouped.set(item.module, [...(grouped.get(item.module) || []), item]);
  }
  const moduleScores = Array.from(grouped, ([module, items]) => ({
    module,
    title: moduleTitle(module),
    score: clamp(items.reduce((sum, item) => sum + item.score, 0) / items.length),
    correct: items.filter(item => item.correct).length,
    total: items.length
  })).sort((left, right) => left.score - right.score || left.title.localeCompare(right.title));

  const prior = previousReports.filter(report => report.checkpointId === checkpoint.id);
  const attemptNumber = prior.length + 1;
  const bestScore = Math.max(score, ...prior.map(report => report.bestScore || report.score), 0);

  return {
    version: 1,
    id: session.id,
    userId: session.userId,
    checkpointId: checkpoint.id,
    status,
    startedAt: session.startedAt,
    completedAt,
    durationSeconds,
    attemptNumber,
    score,
    bestScore,
    passingScore: checkpoint.passingScore,
    passed: status === 'completed' && score >= checkpoint.passingScore,
    accuracy,
    firstAttemptRate,
    independence,
    taskScores,
    moduleScores,
    remediationModules: moduleScores
      .filter(item => item.score < 70 && validModuleId(item.module))
      .map(item => item.module)
  };
}

export function loadLocalCheckpointReports(userId = loadAuthSession()?.userId): CheckpointReport[] {
  if (!userId || typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(reportsKey(userId)) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => validReport(item, userId))
      .sort(compareCheckpointAttempts)
      .slice(0, 50);
  } catch {
    return [];
  }
}

export function saveLocalCheckpointReport(report: CheckpointReport) {
  const previous = loadLocalCheckpointReports(report.userId);
  const existing = previous.find(item => item.id === report.id);
  if (existing) {
    if (!sameImmutableCheckpointReport(existing, report)) {
      throw new CheckpointReportConflictError(report.id, 'local-storage');
    }
    return previous;
  }
  const next = [report, ...previous]
    .sort(compareCheckpointAttempts)
    .slice(0, 50);
  localStorage.setItem(reportsKey(report.userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHECKPOINT_REPORTS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function finishCheckpointSession(
  session: CheckpointSession,
  status: Exclude<CheckpointStatus, 'active'>
) {
  const report = buildCheckpointReport(session, status);
  saveLocalCheckpointReport(report);
  clearCheckpointSession(session.userId);
  return report;
}

export function mergeCheckpointReports(local: CheckpointReport[], remote: CheckpointReport[]) {
  const byId = new Map<string, CheckpointReport>();
  for (const report of [...remote, ...local]) {
    if (!validReport(report)) continue;
    const existing = byId.get(report.id);
    if (!existing) {
      byId.set(report.id, report);
      continue;
    }
    if (!sameImmutableCheckpointReport(existing, report)) {
      throw new CheckpointReportConflictError(report.id, 'local-cloud-merge');
    }
  }
  return Array.from(byId.values())
    .sort(compareCheckpointAttempts)
    .slice(0, 50);
}
