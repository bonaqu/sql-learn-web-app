import { modules, SqlTask, tasks } from '../data/course';
import { loadAuthSession } from './auth';
import { Progress } from './progress';

export type AssessmentMode = 'quick' | 'interview' | 'exam';
export type AssessmentStatus = 'active' | 'completed' | 'expired' | 'abandoned';

export type AssessmentModeConfig = {
  mode: AssessmentMode;
  title: string;
  shortTitle: string;
  description: string;
  durationMinutes: number;
  taskCount: number;
  interviewer: boolean;
  minimumCompleted: number;
  minimumModules: number;
};

export type AssessmentAnswer = {
  taskId: string;
  sql: string;
  attempts: number;
  incorrect: number;
  correct: boolean;
  skipped: boolean;
  elapsedSeconds: number;
  interviewerUses: number;
  startedAt: string;
  completedAt?: string;
};

export type AssessmentSession = {
  version: 1;
  id: string;
  userId: string;
  mode: AssessmentMode;
  status: AssessmentStatus;
  startedAt: string;
  updatedAt: string;
  deadlineAt: string;
  completedAt?: string;
  taskIds: string[];
  currentIndex: number;
  answers: Record<string, AssessmentAnswer>;
  baselineReadiness: number;
};

export type AssessmentTaskScore = {
  taskId: string;
  title: string;
  module: string;
  topic: string;
  correct: boolean;
  skipped: boolean;
  attempts: number;
  elapsedSeconds: number;
  interviewerUses: number;
  score: number;
};

export type AssessmentModuleScore = {
  module: string;
  title: string;
  score: number;
  correct: number;
  total: number;
};

export type AssessmentReport = {
  version: 1;
  id: string;
  userId: string;
  mode: AssessmentMode;
  status: Exclude<AssessmentStatus, 'active'>;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  score: number;
  grade: 'strong' | 'ready' | 'developing' | 'foundation';
  accuracy: number;
  firstAttemptRate: number;
  independence: number;
  readinessDelta: number;
  taskScores: AssessmentTaskScore[];
  moduleScores: AssessmentModuleScore[];
  strengths: string[];
  weaknesses: string[];
  localDebrief: string;
  aiDebrief?: string;
};

export const ASSESSMENT_CHANGED_EVENT = 'sql-academy-assessment-changed';
export const ASSESSMENT_REPORTS_CHANGED_EVENT = 'sql-academy-assessment-reports-changed';

export const assessmentModes: Record<AssessmentMode, AssessmentModeConfig> = {
  quick: {
    mode: 'quick',
    title: 'Quick Check',
    shortTitle: 'Quick Check',
    description: 'Три задачи и быстрый снимок текущих слабых тем.',
    durationMinutes: 12,
    taskCount: 3,
    interviewer: false,
    minimumCompleted: 0,
    minimumModules: 0
  },
  interview: {
    mode: 'interview',
    title: 'SQL Interview Simulation',
    shortTitle: 'Interview',
    description: 'Пять рабочих сценариев и ограниченные уточнения AI Interviewer.',
    durationMinutes: 35,
    taskCount: 5,
    interviewer: true,
    minimumCompleted: 6,
    minimumModules: 2
  },
  exam: {
    mode: 'exam',
    title: 'Academy Exam',
    shortTitle: 'Exam',
    description: 'Полноценный экзамен без подсказок, решения и обычного Mentor.',
    durationMinutes: 55,
    taskCount: 8,
    interviewer: false,
    minimumCompleted: 12,
    minimumModules: 4
  }
};

const PHASE_MODULES = [
  new Set(['sql-thinking', 'select', 'filtering', 'sorting', 'aggregates', 'grouping']),
  new Set(['joins', 'subqueries', 'cte', 'windows', 'dates', 'text']),
  new Set(['set-ops', 'data-quality', 'indexes', 'explain', 'transactions', 'schema']),
  new Set(['support', 'final'])
];

function sessionKey(userId: string) {
  return `sql-academy-assessment-session-v1:${userId}`;
}

function reportsKey(userId: string) {
  return `sql-academy-assessment-reports-v1:${userId}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function moduleTitle(moduleId: string) {
  return modules.find(([id]) => id === moduleId)?.[1] || moduleId;
}

function completedModuleCount(progress: Progress) {
  const completed = new Set(progress.completed);
  return modules.filter(([id]) => tasks.some(task => task.module === id && completed.has(task.id))).length;
}

export function assessmentEligibility(mode: AssessmentMode, progress: Progress) {
  const config = assessmentModes[mode];
  const modulesCompleted = completedModuleCount(progress);
  const missingCompleted = Math.max(0, config.minimumCompleted - progress.completed.length);
  const missingModules = Math.max(0, config.minimumModules - modulesCompleted);
  return {
    eligible: missingCompleted === 0 && missingModules === 0,
    completed: progress.completed.length,
    modulesCompleted,
    missingCompleted,
    missingModules
  };
}

function taskPriority(task: SqlTask, progress: Progress, mode: AssessmentMode) {
  const stats = progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  const completed = progress.completed.includes(task.id);
  const weakness = stats.incorrect * 9 + stats.hintsUsed * 4 + Math.min(stats.attempts, 5);
  const novelty = completed ? 0 : 7;
  const modeFit = mode === 'interview'
    ? task.mode === 'interview' ? 10 : task.mode === 'practice' ? 3 : 0
    : mode === 'exam'
      ? task.mode === 'interview' ? 8 : task.difficulty === 'Экспертный' ? 6 : task.difficulty === 'Продвинутый' ? 4 : 1
      : task.mode === 'practice' || task.mode === 'lesson' ? 4 : 1;
  return weakness + novelty + modeFit;
}

function eligiblePool(mode: AssessmentMode) {
  if (mode === 'quick') return tasks.filter(task => task.mode !== 'puzzle');
  if (mode === 'interview') return tasks.filter(task => task.mode === 'interview' || task.mode === 'practice');
  return tasks.filter(task => task.mode !== 'lesson' && task.mode !== 'puzzle' && task.difficulty !== 'База');
}

function chooseDiverse(candidates: SqlTask[], count: number, mode: AssessmentMode) {
  const selected: SqlTask[] = [];
  const usedModules = new Set<string>();
  const usedPhases = new Set<number>();

  for (const task of candidates) {
    if (selected.length >= count) break;
    const phase = PHASE_MODULES.findIndex(group => group.has(task.module));
    const phaseNeeded = mode !== 'quick' && phase >= 0 && !usedPhases.has(phase);
    if (!usedModules.has(task.module) || phaseNeeded) {
      selected.push(task);
      usedModules.add(task.module);
      if (phase >= 0) usedPhases.add(phase);
    }
  }

  for (const task of candidates) {
    if (selected.length >= count) break;
    if (!selected.some(item => item.id === task.id)) selected.push(task);
  }
  return selected.slice(0, count);
}

export function selectAssessmentTasks(mode: AssessmentMode, progress: Progress) {
  const config = assessmentModes[mode];
  const ranked = eligiblePool(mode)
    .map(task => ({ task, priority: taskPriority(task, progress, mode) }))
    .sort((left, right) => right.priority - left.priority || left.task.id.localeCompare(right.task.id))
    .map(item => item.task);
  return chooseDiverse(ranked, config.taskCount, mode);
}

export function createAssessmentSession(mode: AssessmentMode, progress: Progress, baselineReadiness = 0): AssessmentSession {
  const auth = loadAuthSession();
  if (!auth) throw new Error('Необходим вход в аккаунт');
  const eligibility = assessmentEligibility(mode, progress);
  if (!eligibility.eligible) throw new Error('Сначала выполни prerequisites этого режима');
  const selected = selectAssessmentTasks(mode, progress);
  if (selected.length !== assessmentModes[mode].taskCount) throw new Error('Недостаточно задач для assessment');
  const now = new Date();
  const session: AssessmentSession = {
    version: 1,
    id: crypto.randomUUID(),
    userId: auth.userId,
    mode,
    status: 'active',
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + assessmentModes[mode].durationMinutes * 60_000).toISOString(),
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
      interviewerUses: 0,
      startedAt: now.toISOString()
    }])),
    baselineReadiness
  };
  saveAssessmentSession(session);
  return session;
}

export function loadAssessmentSession(userId = loadAuthSession()?.userId): AssessmentSession | null {
  if (!userId) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionKey(userId)) || 'null') as AssessmentSession | null;
    if (!parsed || parsed.version !== 1 || parsed.userId !== userId || !assessmentModes[parsed.mode]) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAssessmentSession(session: AssessmentSession) {
  const next = { ...session, updatedAt: new Date().toISOString() };
  localStorage.setItem(sessionKey(next.userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(ASSESSMENT_CHANGED_EVENT, { detail: next }));
  return next;
}

export function clearAssessmentSession(userId = loadAuthSession()?.userId) {
  if (!userId) return;
  localStorage.removeItem(sessionKey(userId));
  window.dispatchEvent(new CustomEvent(ASSESSMENT_CHANGED_EVENT, { detail: null }));
}

export function remainingSeconds(session: AssessmentSession, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(session.deadlineAt).getTime() - now) / 1000));
}

export function currentAssessmentTask(session: AssessmentSession) {
  return tasks.find(task => task.id === session.taskIds[session.currentIndex]) || null;
}

export function mergeAssessmentAnswer(previous: AssessmentAnswer, patch: Partial<AssessmentAnswer>) {
  const timerOnlyPatch = patch.elapsedSeconds !== undefined
    && patch.attempts === undefined
    && patch.incorrect === undefined
    && patch.correct === undefined
    && patch.skipped === undefined
    && patch.interviewerUses === undefined;
  const requestedElapsed = patch.elapsedSeconds ?? previous.elapsedSeconds;
  return {
    ...previous,
    ...patch,
    attempts: Math.max(previous.attempts, patch.attempts ?? previous.attempts),
    incorrect: Math.max(previous.incorrect, patch.incorrect ?? previous.incorrect),
    interviewerUses: Math.max(previous.interviewerUses, patch.interviewerUses ?? previous.interviewerUses),
    elapsedSeconds: timerOnlyPatch
      ? Math.max(previous.elapsedSeconds + 5, requestedElapsed)
      : Math.max(previous.elapsedSeconds, requestedElapsed),
    correct: previous.correct || patch.correct === true,
    skipped: patch.skipped ?? previous.skipped,
    completedAt: patch.completedAt || previous.completedAt
  } satisfies AssessmentAnswer;
}

export function updateAssessmentAnswer(session: AssessmentSession, taskId: string, patch: Partial<AssessmentAnswer>) {
  const stored = loadAssessmentSession(session.userId);
  const base = stored?.id === session.id ? stored : session;
  const previous = base.answers[taskId];
  if (!previous) return base;
  return saveAssessmentSession({
    ...base,
    answers: { ...base.answers, [taskId]: mergeAssessmentAnswer(previous, patch) }
  });
}

export function advanceAssessment(session: AssessmentSession) {
  return saveAssessmentSession({
    ...session,
    currentIndex: Math.min(session.taskIds.length - 1, session.currentIndex + 1)
  });
}

export function goToAssessmentTask(session: AssessmentSession, index: number) {
  return saveAssessmentSession({
    ...session,
    currentIndex: clamp(index, 0, session.taskIds.length - 1)
  });
}

function taskScore(task: SqlTask, answer: AssessmentAnswer, expectedSeconds: number): AssessmentTaskScore {
  const accuracy = answer.correct ? 65 : 0;
  const attemptScore = answer.correct ? Math.round(15 / Math.max(1, answer.attempts)) : 0;
  const speedRatio = expectedSeconds / Math.max(1, answer.elapsedSeconds || expectedSeconds);
  const speedScore = answer.correct ? Math.round(clamp(speedRatio, 0.25, 1) * 10) : 0;
  const independenceScore = answer.correct ? Math.max(0, 10 - answer.interviewerUses * 3) : 0;
  return {
    taskId: task.id,
    title: task.title,
    module: task.module,
    topic: task.topic,
    correct: answer.correct,
    skipped: answer.skipped,
    attempts: answer.attempts,
    elapsedSeconds: answer.elapsedSeconds,
    interviewerUses: answer.interviewerUses,
    score: clamp(accuracy + attemptScore + speedScore + independenceScore, 0, 100)
  };
}

function reportGrade(score: number): AssessmentReport['grade'] {
  if (score >= 85) return 'strong';
  if (score >= 70) return 'ready';
  if (score >= 50) return 'developing';
  return 'foundation';
}

function localDebrief(score: number, accuracy: number, strengths: string[], weaknesses: string[]) {
  const level = score >= 85
    ? 'Результат уверенный: ты сохраняешь точность и самостоятельность под ограничением времени.'
    : score >= 70
      ? 'Рабочая готовность уже есть, но отдельные темы требуют закрепления.'
      : score >= 50
        ? 'База сформирована, однако интервью и экзамен пока выявляют нестабильность.'
        : 'Сейчас полезнее вернуться к целевому повторению, чем наращивать сложность.';
  return `${level}\nТочность: ${accuracy}%.\nСильные стороны: ${strengths.join(', ') || 'пока недостаточно данных'}.\nФокус следующей сессии: ${weaknesses.join(', ') || 'повторить текущий набор без подсказок'}.`;
}

export function buildAssessmentReport(session: AssessmentSession, status: Exclude<AssessmentStatus, 'active'>): AssessmentReport {
  const completedAt = new Date().toISOString();
  const durationSeconds = Math.max(1, Math.round((new Date(completedAt).getTime() - new Date(session.startedAt).getTime()) / 1000));
  const expectedSeconds = assessmentModes[session.mode].durationMinutes * 60 / session.taskIds.length;
  const taskScores = session.taskIds.map(taskId => {
    const task = tasks.find(item => item.id === taskId);
    const answer = session.answers[taskId];
    if (!task || !answer) throw new Error(`Assessment task ${taskId} is missing`);
    return taskScore(task, answer, expectedSeconds);
  });
  const score = Math.round(taskScores.reduce((sum, task) => sum + task.score, 0) / Math.max(1, taskScores.length));
  const correct = taskScores.filter(task => task.correct).length;
  const accuracy = Math.round(correct / Math.max(1, taskScores.length) * 100);
  const firstAttemptRate = Math.round(taskScores.filter(task => task.correct && task.attempts === 1).length / Math.max(1, correct) * 100);
  const independence = Math.round(taskScores.reduce((sum, task) => sum + Math.max(0, 100 - task.interviewerUses * 30), 0) / Math.max(1, taskScores.length));
  const grouped = new Map<string, AssessmentTaskScore[]>();
  for (const task of taskScores) grouped.set(task.module, [...(grouped.get(task.module) || []), task]);
  const moduleScores = Array.from(grouped, ([module, items]) => ({
    module,
    title: moduleTitle(module),
    score: Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length),
    correct: items.filter(item => item.correct).length,
    total: items.length
  })).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
  const strengths = moduleScores.filter(item => item.score >= 70).slice(0, 3).map(item => item.title);
  const weaknesses = [...moduleScores].sort((left, right) => left.score - right.score || left.title.localeCompare(right.title)).slice(0, 3).map(item => item.title);
  const readinessDelta = clamp(Math.round((score - 60) / 8), -5, 10);
  return {
    version: 1,
    id: session.id,
    userId: session.userId,
    mode: session.mode,
    status,
    startedAt: session.startedAt,
    completedAt,
    durationSeconds,
    score,
    grade: reportGrade(score),
    accuracy,
    firstAttemptRate,
    independence,
    readinessDelta,
    taskScores,
    moduleScores,
    strengths,
    weaknesses,
    localDebrief: localDebrief(score, accuracy, strengths, weaknesses)
  };
}

export function saveLocalAssessmentReport(report: AssessmentReport) {
  const previous = loadLocalAssessmentReports(report.userId).filter(item => item.id !== report.id);
  const next = [report, ...previous].slice(0, 20);
  localStorage.setItem(reportsKey(report.userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(ASSESSMENT_REPORTS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function loadLocalAssessmentReports(userId = loadAuthSession()?.userId): AssessmentReport[] {
  if (!userId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(reportsKey(userId)) || '[]') as AssessmentReport[];
    return Array.isArray(parsed) ? parsed.filter(report => report.version === 1 && report.userId === userId) : [];
  } catch {
    return [];
  }
}

export function finishAssessmentSession(session: AssessmentSession, status: Exclude<AssessmentStatus, 'active'>) {
  const report = buildAssessmentReport(session, status);
  saveLocalAssessmentReport(report);
  clearAssessmentSession(session.userId);
  return report;
}
