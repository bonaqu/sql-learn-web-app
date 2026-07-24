import { curriculumCheckpoints, lessonForModule } from '../data/curriculum';
import { modules, SqlTask, tasks } from '../data/course';
import { loadAuthSession } from './auth';
import { CurriculumProgressV1 } from './curriculum-progress';
import { Progress } from './progress';

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
  status: 'active';
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
  topic: string;
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
  score: number;
  passingScore: number;
  passed: boolean;
  accuracy: number;
  firstAttemptRate: number;
  independence: number;
  taskScores: CheckpointTaskScore[];
  moduleScores: CheckpointModuleScore[];
  strengths: string[];
  weaknesses: string[];
  remediationLessonIds: string[];
};

export const CHECKPOINT_SESSION_CHANGED_EVENT = 'sql-academy-checkpoint-session-changed';
export const CHECKPOINT_REPORTS_CHANGED_EVENT = 'sql-academy-checkpoint-reports-changed';

const REPORT_LIMIT = 40;

function sessionKey(userId: string) {
  return `sql-academy-checkpoint-session-v1:${userId}`;
}

function reportsKey(userId: string) {
  return `sql-academy-checkpoint-reports-v1:${userId}`;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function moduleTitle(moduleId: string) {
  return modules.find(([id]) => id === moduleId)?.[1] || moduleId;
}

export function checkpointDurationMinutes(checkpointId: string) {
  const index = curriculumCheckpoints.findIndex(item => item.id === checkpointId);
  return index < 0 ? 20 : 18 + index * 4;
}

export function checkpointDefinition(checkpointId: string) {
  return curriculumCheckpoints.find(item => item.id === checkpointId) || null;
}

export function checkpointEligibility(
  checkpointId: string,
  taskProgress: Progress,
  curriculumProgress: CurriculumProgressV1,
  reports: CheckpointReport[]
) {
  const index = curriculumCheckpoints.findIndex(item => item.id === checkpointId);
  const checkpoint = curriculumCheckpoints[index];
  if (!checkpoint) return { eligible: false, blockers: ['Контрольная точка не найдена'], lessonEvidence: 0, practiceEvidence: 0 };

  const bestByCheckpoint = new Map<string, CheckpointReport>();
  for (const report of reports) {
    const current = bestByCheckpoint.get(report.checkpointId);
    if (!current || report.score > current.score || (report.score === current.score && report.completedAt > current.completedAt)) {
      bestByCheckpoint.set(report.checkpointId, report);
    }
  }

  const prior = index > 0 ? curriculumCheckpoints[index - 1] : null;
  const priorPassed = !prior || Boolean(bestByCheckpoint.get(prior.id)?.passed);
  const lessonIds = checkpoint.moduleIds.map(moduleId => lessonForModule(moduleId)?.id).filter((id): id is string => Boolean(id));
  const lessonCompleted = lessonIds.filter(id => curriculumProgress.completedLessons.includes(id)).length;
  const lessonEvidence = Math.round(lessonCompleted / Math.max(1, lessonIds.length) * 100);
  const relevantTasks = tasks.filter(task => checkpoint.moduleIds.includes(task.module as never));
  const solved = relevantTasks.filter(task => taskProgress.completed.includes(task.id)).length;
  const practiceEvidence = Math.round(solved / Math.max(1, relevantTasks.length) * 100);
  const hasFoundation = index === 0 || lessonEvidence >= 35 || practiceEvidence >= 32;
  const blockers: string[] = [];
  if (!priorPassed && prior) blockers.push(`Сначала пройди «${prior.title}»`);
  if (!hasFoundation) blockers.push('Заверши минимум треть уроков или практики этого этапа');

  return {
    eligible: blockers.length === 0,
    blockers,
    lessonEvidence,
    practiceEvidence,
    priorPassed
  };
}

export function createCheckpointSession(checkpointId: string): CheckpointSession {
  const auth = loadAuthSession();
  if (!auth) throw new Error('Необходим вход в аккаунт');
  const checkpoint = checkpointDefinition(checkpointId);
  if (!checkpoint) throw new Error('Контрольная точка не найдена');
  const selected = checkpoint.taskIds.map(taskId => tasks.find(task => task.id === taskId)).filter((task): task is SqlTask => Boolean(task));
  if (selected.length !== checkpoint.taskIds.length) throw new Error('Часть задач checkpoint отсутствует');
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
  if (!userId) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionKey(userId)) || 'null') as CheckpointSession | null;
    if (!parsed || parsed.version !== 1 || parsed.userId !== userId || parsed.status !== 'active') return null;
    const checkpoint = checkpointDefinition(parsed.checkpointId);
    if (!checkpoint || parsed.taskIds.some(taskId => !checkpoint.taskIds.includes(taskId))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCheckpointSession(session: CheckpointSession) {
  const next = { ...session, updatedAt: new Date().toISOString() };
  localStorage.setItem(sessionKey(next.userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHECKPOINT_SESSION_CHANGED_EVENT, { detail: next }));
  return next;
}

export function clearCheckpointSession(userId = loadAuthSession()?.userId) {
  if (!userId) return;
  localStorage.removeItem(sessionKey(userId));
  window.dispatchEvent(new CustomEvent(CHECKPOINT_SESSION_CHANGED_EVENT, { detail: null }));
}

export function checkpointRemainingSeconds(session: CheckpointSession, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(session.deadlineAt).getTime() - now) / 1000));
}

export function currentCheckpointTask(session: CheckpointSession) {
  return tasks.find(task => task.id === session.taskIds[session.currentIndex]) || null;
}

export function updateCheckpointAnswer(session: CheckpointSession, taskId: string, patch: Partial<CheckpointAnswer>) {
  const stored = loadCheckpointSession(session.userId);
  const base = stored?.id === session.id ? stored : session;
  const previous = base.answers[taskId];
  if (!previous) return base;
  const requestedElapsed = patch.elapsedSeconds ?? previous.elapsedSeconds;
  const timerOnlyPatch = patch.elapsedSeconds !== undefined
    && patch.attempts === undefined
    && patch.incorrect === undefined
    && patch.correct === undefined
    && patch.skipped === undefined;
  const nextAnswer: CheckpointAnswer = {
    ...previous,
    ...patch,
    attempts: Math.max(previous.attempts, patch.attempts ?? previous.attempts),
    incorrect: Math.max(previous.incorrect, patch.incorrect ?? previous.incorrect),
    elapsedSeconds: timerOnlyPatch
      ? Math.max(previous.elapsedSeconds + 5, requestedElapsed)
      : Math.max(previous.elapsedSeconds, requestedElapsed),
    correct: previous.correct || patch.correct === true,
    skipped: patch.skipped ?? previous.skipped,
    completedAt: patch.completedAt || previous.completedAt
  };
  return saveCheckpointSession({ ...base, answers: { ...base.answers, [taskId]: nextAnswer } });
}

export function goToCheckpointTask(session: CheckpointSession, index: number) {
  return saveCheckpointSession({ ...session, currentIndex: clamp(index, 0, session.taskIds.length - 1) });
}

export function advanceCheckpoint(session: CheckpointSession) {
  return goToCheckpointTask(session, Math.min(session.taskIds.length - 1, session.currentIndex + 1));
}

function scoreTask(task: SqlTask, answer: CheckpointAnswer, expectedSeconds: number): CheckpointTaskScore {
  const correctness = answer.correct ? 65 : 0;
  const attempts = answer.correct ? Math.round(20 / Math.max(1, answer.attempts)) : 0;
  const speedRatio = expectedSeconds / Math.max(1, answer.elapsedSeconds || expectedSeconds);
  const speed = answer.correct ? Math.round(clamp(speedRatio, 0.25, 1) * 10) : 0;
  const independence = answer.correct ? Math.max(0, 5 - Math.max(0, answer.attempts - 1)) : 0;
  return {
    taskId: task.id,
    title: task.title,
    module: task.module,
    topic: task.topic,
    correct: answer.correct,
    skipped: answer.skipped,
    attempts: answer.attempts,
    elapsedSeconds: answer.elapsedSeconds,
    score: clamp(correctness + attempts + speed + independence)
  };
}

export function buildCheckpointReport(session: CheckpointSession, status: Exclude<CheckpointStatus, 'active'>): CheckpointReport {
  const checkpoint = checkpointDefinition(session.checkpointId);
  if (!checkpoint) throw new Error('Checkpoint definition is missing');
  const completedAt = new Date().toISOString();
  const durationSeconds = Math.max(1, Math.round((new Date(completedAt).getTime() - new Date(session.startedAt).getTime()) / 1000));
  const expectedSeconds = checkpointDurationMinutes(checkpoint.id) * 60 / Math.max(1, session.taskIds.length);
  const taskScores = session.taskIds.map(taskId => {
    const task = tasks.find(item => item.id === taskId);
    const answer = session.answers[taskId];
    if (!task || !answer) throw new Error(`Checkpoint task ${taskId} is missing`);
    return scoreTask(task, answer, expectedSeconds);
  });
  const score = Math.round(taskScores.reduce((sum, item) => sum + item.score, 0) / Math.max(1, taskScores.length));
  const correct = taskScores.filter(item => item.correct).length;
  const accuracy = Math.round(correct / Math.max(1, taskScores.length) * 100);
  const firstAttemptRate = Math.round(taskScores.filter(item => item.correct && item.attempts === 1).length / Math.max(1, correct) * 100);
  const independence = Math.round(taskScores.reduce((sum, item) => sum + (item.correct ? Math.max(45, 100 - Math.max(0, item.attempts - 1) * 18) : 0), 0) / Math.max(1, taskScores.length));
  const grouped = new Map<string, CheckpointTaskScore[]>();
  for (const taskScore of taskScores) grouped.set(taskScore.module, [...(grouped.get(taskScore.module) || []), taskScore]);
  const moduleScores = Array.from(grouped, ([module, items]) => ({
    module,
    title: moduleTitle(module),
    score: Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length),
    correct: items.filter(item => item.correct).length,
    total: items.length
  })).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
  const strengths = moduleScores.filter(item => item.score >= 72).slice(0, 3).map(item => item.title);
  const weaknesses = [...moduleScores].sort((left, right) => left.score - right.score || left.title.localeCompare(right.title)).slice(0, 3).map(item => item.title);
  const remediationLessonIds = [...moduleScores]
    .sort((left, right) => left.score - right.score)
    .slice(0, 3)
    .map(item => lessonForModule(item.module)?.id)
    .filter((id): id is string => Boolean(id));
  const passed = status === 'completed' && score >= checkpoint.passingScore && accuracy >= 60;
  return {
    version: 1,
    id: session.id,
    userId: session.userId,
    checkpointId: checkpoint.id,
    status,
    startedAt: session.startedAt,
    completedAt,
    durationSeconds,
    score,
    passingScore: checkpoint.passingScore,
    passed,
    accuracy,
    firstAttemptRate,
    independence,
    taskScores,
    moduleScores,
    strengths,
    weaknesses,
    remediationLessonIds
  };
}

export function loadLocalCheckpointReports(userId = loadAuthSession()?.userId): CheckpointReport[] {
  if (!userId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(reportsKey(userId)) || '[]') as CheckpointReport[];
    return Array.isArray(parsed)
      ? parsed.filter(report => report.version === 1 && report.userId === userId && Boolean(checkpointDefinition(report.checkpointId))).slice(0, REPORT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function saveLocalCheckpointReport(report: CheckpointReport) {
  const previous = loadLocalCheckpointReports(report.userId).filter(item => item.id !== report.id);
  const next = [report, ...previous]
    .sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime())
    .slice(0, REPORT_LIMIT);
  localStorage.setItem(reportsKey(report.userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHECKPOINT_REPORTS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function mergeCheckpointReports(local: CheckpointReport[], remote: CheckpointReport[]) {
  const map = new Map<string, CheckpointReport>();
  for (const report of [...remote, ...local]) {
    const current = map.get(report.id);
    if (!current || report.completedAt >= current.completedAt) map.set(report.id, report);
  }
  return Array.from(map.values())
    .sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime())
    .slice(0, REPORT_LIMIT);
}

export function bestCheckpointReports(reports: CheckpointReport[]) {
  const map = new Map<string, CheckpointReport>();
  for (const report of reports) {
    const current = map.get(report.checkpointId);
    if (!current || report.score > current.score || (report.score === current.score && report.completedAt > current.completedAt)) {
      map.set(report.checkpointId, report);
    }
  }
  return map;
}

export function finishCheckpointSession(session: CheckpointSession, status: Exclude<CheckpointStatus, 'active'>) {
  const report = buildCheckpointReport(session, status);
  saveLocalCheckpointReport(report);
  clearCheckpointSession(session.userId);
  return report;
}
