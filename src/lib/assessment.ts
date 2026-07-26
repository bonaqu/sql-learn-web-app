import { modules, type SqlTask, tasks } from '../data/course-catalog';
import { sqlExams } from '../data/sql-exams';
import {
  ASSESSMENT_BLUEPRINT_VERSION,
  ASSESSMENT_THRESHOLD_VERSION,
  assessmentBlueprints,
  assessmentItem,
  type AssessmentErrorClass,
  type AssessmentReasoningSkill
} from '../data/assessment-blueprints';
import { loadAuthSession } from './auth';
import {
  abilityBand,
  buildAssessmentMeasurement,
  calibratedExpectedSeconds,
  loadAssessmentCalibration,
  type AssessmentAbilityBand,
  type AssessmentMeasurement
} from './assessment-calibration';
import { selectAssessmentForm, type AssessmentSelectionResult } from './assessment-selection';
import type { Progress } from './progress';

export type AssessmentMode = 'quick' | 'interview' | 'exam' | 'diagnostic' | 'production' | 'final';
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
  passingScore: number;
  requiredModuleIds?: string[];
  fixedTaskIds?: string[];
  blueprintVersion: string;
  thresholdVersion: string;
};

export type AssessmentAnswer = {
  taskId: string;
  sql: string;
  attempts: number;
  incorrect: number;
  technicalErrors: number;
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
  formId: string;
  blueprintVersion: string;
  thresholdVersion: string;
  selection: {
    excludedKnownSolutions: number;
    fallbackKnownSolutions: number;
    distinctModules: number;
    distinctSkills: number;
  };
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
  technicalErrors?: number;
  telemetryEligible?: boolean;
  telemetryExclusionReason?: 'status' | 'not-attempted' | 'skipped' | 'interviewer' | 'technical-error' | null;
  abilityBand?: AssessmentAbilityBand;
  itemVersion?: string;
  reasoningSkill?: AssessmentReasoningSkill;
  errorClass?: AssessmentErrorClass;
  expectedSeconds?: number;
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
  baselineReadiness?: number;
  formId?: string;
  blueprintVersion?: string;
  thresholdVersion?: string;
  measurement?: AssessmentMeasurement;
};

export const ASSESSMENT_CHANGED_EVENT = 'sql-academy-assessment-changed';
export const ASSESSMENT_REPORTS_CHANGED_EVENT = 'sql-academy-assessment-reports-changed';

export const ASSESSMENT_SCORING_POLICY = {
  version: ASSESSMENT_THRESHOLD_VERSION,
  weights: { accuracy: 65, firstAttempt: 15, time: 10, independence: 10 },
  gradeThresholds: { strong: 85, ready: 70, developing: 50 },
  migration: 'v2 сохраняет шкалу 0–100, но фиксирует blueprint/form, использует item expected time и показывает uncertainty band.'
} as const;

export const assessmentModes: Record<AssessmentMode, AssessmentModeConfig> = {
  quick: {
    mode: 'quick', title: 'Quick Check', shortTitle: 'Quick Check',
    description: 'Три задачи и быстрый снимок текущих слабых тем.',
    durationMinutes: 12, taskCount: 3, interviewer: false, minimumCompleted: 0, minimumModules: 0, passingScore: 50,
    blueprintVersion: ASSESSMENT_BLUEPRINT_VERSION, thresholdVersion: ASSESSMENT_THRESHOLD_VERSION
  },
  interview: {
    mode: 'interview', title: 'SQL Interview Simulation', shortTitle: 'Interview',
    description: 'Пять рабочих сценариев и ограниченные уточнения AI Interviewer.',
    durationMinutes: 35, taskCount: 5, interviewer: true, minimumCompleted: 6, minimumModules: 2, passingScore: 65,
    blueprintVersion: ASSESSMENT_BLUEPRINT_VERSION, thresholdVersion: ASSESSMENT_THRESHOLD_VERSION
  },
  exam: {
    mode: 'exam', title: 'Academy Exam', shortTitle: 'Exam',
    description: 'Полноценный экзамен без подсказок, решения и обычного Mentor.',
    durationMinutes: 55, taskCount: 8, interviewer: false, minimumCompleted: 12, minimumModules: 4, passingScore: 70,
    blueprintVersion: ASSESSMENT_BLUEPRINT_VERSION, thresholdVersion: ASSESSMENT_THRESHOLD_VERSION
  },
  diagnostic: {
    mode: 'diagnostic', title: sqlExams[0].title, shortTitle: 'Diagnostic', description: sqlExams[0].description,
    durationMinutes: sqlExams[0].durationMinutes, taskCount: sqlExams[0].taskIds.length, interviewer: false,
    minimumCompleted: 0, minimumModules: 0, passingScore: sqlExams[0].passingScore,
    requiredModuleIds: sqlExams[0].requiredModuleIds, fixedTaskIds: sqlExams[0].taskIds,
    blueprintVersion: ASSESSMENT_BLUEPRINT_VERSION, thresholdVersion: ASSESSMENT_THRESHOLD_VERSION
  },
  production: {
    mode: 'production', title: sqlExams[1].title, shortTitle: 'Production', description: sqlExams[1].description,
    durationMinutes: sqlExams[1].durationMinutes, taskCount: sqlExams[1].taskIds.length, interviewer: false,
    minimumCompleted: 96, minimumModules: 16, passingScore: sqlExams[1].passingScore,
    requiredModuleIds: sqlExams[1].requiredModuleIds,
    blueprintVersion: ASSESSMENT_BLUEPRINT_VERSION, thresholdVersion: ASSESSMENT_THRESHOLD_VERSION
  },
  final: {
    mode: 'final', title: sqlExams[2].title, shortTitle: 'Final', description: sqlExams[2].description,
    durationMinutes: sqlExams[2].durationMinutes, taskCount: sqlExams[2].taskIds.length, interviewer: false,
    minimumCompleted: 180, minimumModules: 26, passingScore: sqlExams[2].passingScore,
    requiredModuleIds: sqlExams[2].requiredModuleIds,
    blueprintVersion: ASSESSMENT_BLUEPRINT_VERSION, thresholdVersion: ASSESSMENT_THRESHOLD_VERSION
  }
};

function sessionKey(userId: string) { return `sql-academy-assessment-session-v1:${userId}`; }
function reportsKey(userId: string) { return `sql-academy-assessment-reports-v1:${userId}`; }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
function moduleTitle(moduleId: string) { return modules.find(([id]) => id === moduleId)?.[1] || moduleId; }

function moduleCoverage(progress: Progress, moduleId: string) {
  const moduleTasks = tasks.filter(task => task.module === moduleId);
  const completed = new Set(progress.completed);
  return moduleTasks.length ? moduleTasks.filter(task => completed.has(task.id)).length / moduleTasks.length : 0;
}

function completedModuleCount(progress: Progress) {
  return modules.filter(([id]) => moduleCoverage(progress, id) >= 0.45).length;
}

export function assessmentEligibility(mode: AssessmentMode, progress: Progress) {
  const config = assessmentModes[mode];
  const modulesCompleted = completedModuleCount(progress);
  const missingCompleted = Math.max(0, config.minimumCompleted - progress.completed.length);
  const missingModules = Math.max(0, config.minimumModules - modulesCompleted);
  const missingRequiredModules = (config.requiredModuleIds || []).filter(moduleId => moduleCoverage(progress, moduleId) < 0.45);
  return { eligible: missingCompleted === 0 && missingModules === 0 && missingRequiredModules.length === 0, completed: progress.completed.length, modulesCompleted, missingCompleted, missingModules, missingRequiredModules };
}

export function selectAssessmentTasks(mode: AssessmentMode, progress: Progress) {
  const auth = loadAuthSession();
  const selection = selectAssessmentForm({
    mode,
    progress,
    userId: auth?.userId || 'anonymous',
    reports: loadLocalAssessmentReports(auth?.userId),
    calibration: loadAssessmentCalibration()
  });
  return selection.tasks;
}

function createSelection(mode: AssessmentMode, progress: Progress, userId: string): AssessmentSelectionResult {
  return selectAssessmentForm({
    mode,
    progress,
    userId,
    reports: loadLocalAssessmentReports(userId),
    calibration: loadAssessmentCalibration()
  });
}

export function createAssessmentSession(mode: AssessmentMode, progress: Progress, baselineReadiness = 0): AssessmentSession {
  const auth = loadAuthSession();
  if (!auth) throw new Error('Необходим вход в аккаунт');
  const eligibility = assessmentEligibility(mode, progress);
  if (!eligibility.eligible) throw new Error('Сначала выполни prerequisites этого режима');
  const selection = createSelection(mode, progress, auth.userId);
  if (selection.tasks.length !== assessmentModes[mode].taskCount) throw new Error('Недостаточно задач для assessment blueprint');
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
    taskIds: selection.tasks.map(task => task.id),
    currentIndex: 0,
    answers: Object.fromEntries(selection.tasks.map(task => [task.id, {
      taskId: task.id,
      sql: task.starter,
      attempts: 0,
      incorrect: 0,
      technicalErrors: 0,
      correct: false,
      skipped: false,
      elapsedSeconds: 0,
      interviewerUses: 0,
      startedAt: now.toISOString()
    }])),
    baselineReadiness,
    formId: selection.formId,
    blueprintVersion: selection.blueprintVersion,
    thresholdVersion: ASSESSMENT_THRESHOLD_VERSION,
    selection: {
      excludedKnownSolutions: selection.excludedKnownSolutions,
      fallbackKnownSolutions: selection.fallbackKnownSolutions,
      distinctModules: selection.distinctModules,
      distinctSkills: selection.distinctSkills
    }
  };
  saveAssessmentSession(session);
  return session;
}

function normalizeAnswer(taskId: string, raw: Partial<AssessmentAnswer> | undefined, fallbackStartedAt: string): AssessmentAnswer {
  return {
    taskId,
    sql: typeof raw?.sql === 'string' ? raw.sql : tasks.find(task => task.id === taskId)?.starter || '',
    attempts: Math.max(0, Number(raw?.attempts) || 0),
    incorrect: Math.max(0, Number(raw?.incorrect) || 0),
    technicalErrors: Math.max(0, Number(raw?.technicalErrors) || 0),
    correct: raw?.correct === true,
    skipped: raw?.skipped === true,
    elapsedSeconds: Math.max(0, Number(raw?.elapsedSeconds) || 0),
    interviewerUses: Math.max(0, Number(raw?.interviewerUses) || 0),
    startedAt: typeof raw?.startedAt === 'string' ? raw.startedAt : fallbackStartedAt,
    completedAt: typeof raw?.completedAt === 'string' ? raw.completedAt : undefined
  };
}

export function loadAssessmentSession(userId = loadAuthSession()?.userId): AssessmentSession | null {
  if (!userId) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionKey(userId)) || 'null') as Partial<AssessmentSession> | null;
    if (!parsed || parsed.version !== 1 || parsed.userId !== userId || !parsed.mode || !assessmentModes[parsed.mode]) return null;
    const taskIds = Array.isArray(parsed.taskIds) ? parsed.taskIds.filter(taskId => tasks.some(task => task.id === taskId)) : [];
    if (!taskIds.length) return null;
    const startedAt = typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString();
    return {
      version: 1,
      id: typeof parsed.id === 'string' ? parsed.id : crypto.randomUUID(),
      userId,
      mode: parsed.mode,
      status: parsed.status || 'active',
      startedAt,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : startedAt,
      deadlineAt: typeof parsed.deadlineAt === 'string' ? parsed.deadlineAt : new Date(Date.now() + assessmentModes[parsed.mode].durationMinutes * 60_000).toISOString(),
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : undefined,
      taskIds,
      currentIndex: clamp(Number(parsed.currentIndex) || 0, 0, taskIds.length - 1),
      answers: Object.fromEntries(taskIds.map(taskId => [taskId, normalizeAnswer(taskId, parsed.answers?.[taskId], startedAt)])),
      baselineReadiness: clamp(Number(parsed.baselineReadiness) || 0, 0, 100),
      formId: typeof parsed.formId === 'string' ? parsed.formId : `LEGACY-${parsed.mode.toUpperCase()}-V1`,
      blueprintVersion: typeof parsed.blueprintVersion === 'string' ? parsed.blueprintVersion : 'assessment-blueprint-v1',
      thresholdVersion: typeof parsed.thresholdVersion === 'string' ? parsed.thresholdVersion : 'assessment-thresholds-v1',
      selection: parsed.selection && typeof parsed.selection === 'object' ? {
        excludedKnownSolutions: Math.max(0, Number(parsed.selection.excludedKnownSolutions) || 0),
        fallbackKnownSolutions: Math.max(0, Number(parsed.selection.fallbackKnownSolutions) || 0),
        distinctModules: Math.max(0, Number(parsed.selection.distinctModules) || new Set(taskIds.map(id => tasks.find(task => task.id === id)?.module)).size),
        distinctSkills: Math.max(0, Number(parsed.selection.distinctSkills) || new Set(taskIds.map(id => assessmentItem(id)?.reasoningSkill)).size)
      } : {
        excludedKnownSolutions: 0,
        fallbackKnownSolutions: 0,
        distinctModules: new Set(taskIds.map(id => tasks.find(task => task.id === id)?.module)).size,
        distinctSkills: new Set(taskIds.map(id => assessmentItem(id)?.reasoningSkill)).size
      }
    };
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
    && patch.technicalErrors === undefined
    && patch.correct === undefined
    && patch.skipped === undefined
    && patch.interviewerUses === undefined;
  const requestedElapsed = patch.elapsedSeconds ?? previous.elapsedSeconds;
  return {
    ...previous,
    ...patch,
    attempts: Math.max(previous.attempts, patch.attempts ?? previous.attempts),
    incorrect: Math.max(previous.incorrect, patch.incorrect ?? previous.incorrect),
    technicalErrors: Math.max(previous.technicalErrors, patch.technicalErrors ?? previous.technicalErrors),
    interviewerUses: Math.max(previous.interviewerUses, patch.interviewerUses ?? previous.interviewerUses),
    elapsedSeconds: timerOnlyPatch ? Math.max(previous.elapsedSeconds + 5, requestedElapsed) : Math.max(previous.elapsedSeconds, requestedElapsed),
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
  return saveAssessmentSession({ ...base, answers: { ...base.answers, [taskId]: mergeAssessmentAnswer(previous, patch) } });
}

export function advanceAssessment(session: AssessmentSession) {
  return saveAssessmentSession({ ...session, currentIndex: Math.min(session.taskIds.length - 1, session.currentIndex + 1) });
}

export function goToAssessmentTask(session: AssessmentSession, index: number) {
  return saveAssessmentSession({ ...session, currentIndex: clamp(index, 0, session.taskIds.length - 1) });
}

function telemetryExclusion(status: Exclude<AssessmentStatus, 'active'>, answer: AssessmentAnswer): AssessmentTaskScore['telemetryExclusionReason'] {
  if (status !== 'completed') return 'status';
  if (answer.attempts <= 0) return 'not-attempted';
  if (answer.skipped) return 'skipped';
  if (answer.interviewerUses > 0) return 'interviewer';
  if (answer.technicalErrors > 0) return 'technical-error';
  return null;
}

function taskScore(task: SqlTask, answer: AssessmentAnswer, expectedSeconds: number, status: Exclude<AssessmentStatus, 'active'>, baselineReadiness: number): AssessmentTaskScore {
  const accuracy = answer.correct ? ASSESSMENT_SCORING_POLICY.weights.accuracy : 0;
  const attemptScore = answer.correct ? Math.round(ASSESSMENT_SCORING_POLICY.weights.firstAttempt / Math.max(1, answer.attempts)) : 0;
  const speedRatio = expectedSeconds / Math.max(1, answer.elapsedSeconds || expectedSeconds);
  const speedScore = answer.correct ? Math.round(clamp(speedRatio, 0.25, 1) * ASSESSMENT_SCORING_POLICY.weights.time) : 0;
  const independenceScore = answer.correct ? Math.max(0, ASSESSMENT_SCORING_POLICY.weights.independence - answer.interviewerUses * 3) : 0;
  const item = assessmentItem(task.id);
  const exclusion = telemetryExclusion(status, answer);
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
    technicalErrors: answer.technicalErrors,
    telemetryEligible: exclusion === null,
    telemetryExclusionReason: exclusion,
    abilityBand: abilityBand(baselineReadiness),
    itemVersion: ASSESSMENT_BLUEPRINT_VERSION,
    reasoningSkill: item?.reasoningSkill,
    errorClass: item?.errorClass,
    expectedSeconds,
    score: clamp(accuracy + attemptScore + speedScore + independenceScore, 0, 100)
  };
}

function reportGrade(score: number): AssessmentReport['grade'] {
  if (score >= ASSESSMENT_SCORING_POLICY.gradeThresholds.strong) return 'strong';
  if (score >= ASSESSMENT_SCORING_POLICY.gradeThresholds.ready) return 'ready';
  if (score >= ASSESSMENT_SCORING_POLICY.gradeThresholds.developing) return 'developing';
  return 'foundation';
}

function localDebrief(report: { score: number; accuracy: number; strengths: string[]; weaknesses: string[]; measurement: AssessmentMeasurement }) {
  const level = report.score >= 85
    ? 'Результат уверенный: ты сохраняешь точность и самостоятельность под ограничением времени.'
    : report.score >= 70
      ? 'Рабочая готовность уже есть, но отдельные темы требуют закрепления.'
      : report.score >= 50
        ? 'База сформирована, однако интервью и экзамен пока выявляют нестабильность.'
        : 'Сейчас полезнее вернуться к целевому повторению, чем наращивать сложность.';
  return `${level}\nНаблюдаемый score: ${report.score}/100; измерительный диапазон ${report.measurement.scoreBand.low}–${report.measurement.scoreBand.high}.\nТочность: ${report.accuracy}% (90% interval ${report.measurement.accuracyInterval.low}–${report.measurement.accuracyInterval.high}%).\nСильные стороны: ${report.strengths.join(', ') || 'пока недостаточно данных'}.\nФокус следующей сессии: ${report.weaknesses.join(', ') || 'повторить текущий набор без подсказок'}.`;
}

export function buildAssessmentReport(session: AssessmentSession, status: Exclude<AssessmentStatus, 'active'>): AssessmentReport {
  const completedAt = new Date().toISOString();
  const durationSeconds = Math.max(1, Math.round((new Date(completedAt).getTime() - new Date(session.startedAt).getTime()) / 1000));
  const calibration = loadAssessmentCalibration();
  const taskScores = session.taskIds.map(taskId => {
    const task = tasks.find(item => item.id === taskId);
    const answer = session.answers[taskId];
    if (!task || !answer) throw new Error(`Assessment task ${taskId} is missing`);
    return taskScore(task, answer, calibratedExpectedSeconds(taskId, calibration), status, session.baselineReadiness);
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
  const eligibleItems = taskScores.filter(item => item.telemetryEligible).length;
  const measurement = buildAssessmentMeasurement({
    score,
    correct: taskScores.filter(item => item.telemetryEligible && item.correct).length,
    eligibleItems,
    excludedItems: taskScores.length - eligibleItems,
    taskIds: taskScores.map(item => item.taskId),
    formId: session.formId,
    snapshot: calibration
  });
  const report: AssessmentReport = {
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
    localDebrief: '',
    baselineReadiness: session.baselineReadiness,
    formId: session.formId,
    blueprintVersion: session.blueprintVersion,
    thresholdVersion: session.thresholdVersion,
    measurement
  };
  report.localDebrief = localDebrief({ score, accuracy, strengths, weaknesses, measurement });
  return report;
}

function normalizeReport(report: AssessmentReport): AssessmentReport {
  const blueprintVersion = report.blueprintVersion || 'assessment-blueprint-v1';
  const thresholdVersion = report.thresholdVersion || 'assessment-thresholds-v1';
  return {
    ...report,
    baselineReadiness: Number.isFinite(report.baselineReadiness) ? clamp(Number(report.baselineReadiness), 0, 100) : undefined,
    formId: report.formId || `LEGACY-${report.mode.toUpperCase()}-V1`,
    blueprintVersion,
    thresholdVersion,
    taskScores: report.taskScores.map(item => ({ ...item, technicalErrors: Math.max(0, Number(item.technicalErrors) || 0) }))
  };
}

export function saveLocalAssessmentReport(report: AssessmentReport) {
  const normalized = normalizeReport(report);
  const previous = loadLocalAssessmentReports(normalized.userId).filter(item => item.id !== normalized.id);
  const next = [normalized, ...previous].slice(0, 20);
  localStorage.setItem(reportsKey(normalized.userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(ASSESSMENT_REPORTS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function loadLocalAssessmentReports(userId = loadAuthSession()?.userId): AssessmentReport[] {
  if (!userId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(reportsKey(userId)) || '[]') as AssessmentReport[];
    return Array.isArray(parsed)
      ? parsed.filter(report => report.version === 1 && report.userId === userId).map(normalizeReport)
      : [];
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

export function assessmentBlueprint(mode: AssessmentMode) {
  return assessmentBlueprints[mode];
}
