import { onboardingModuleTitle } from '../data/onboarding-module-titles';
import type { AssessmentReport } from './assessment';
import { goalModuleRoute, safeDiagnosticBypass, SHARED_FOUNDATION_MODULE_IDS } from './goal-aware-route';

export type LearnerGoal = 'support' | 'analyst' | 'backend' | 'data-engineering' | 'interview' | 'full';
export type ExperienceLevel = 'none' | 'basics' | 'regular' | 'advanced';
export type ProgrammingExperience = 'none' | 'some' | 'professional';
export type PriorSqlExperience = 'none' | 'course' | 'work';
export type SqlDialectPreference = 'unknown' | 'sqlite' | 'postgresql' | 'mysql' | 'sqlserver';
export type LearningRoutePreference = 'full' | 'fast';
export type StudyPace = 'gentle' | 'steady' | 'intensive';
export type StudyDay = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
export type PlacementStatus = 'not-started' | 'pending' | 'completed' | 'deferred';
export type PlacementLevel = 'foundation' | 'developing' | 'working' | 'advanced';
export type RecommendedTrack = 'fundamentals' | 'analytics' | 'support' | 'performance' | 'data-engineering' | 'interview';

export type PlacementResult = {
  status: PlacementStatus;
  reportId: string | null;
  score: number | null;
  level: PlacementLevel | null;
  recommendedTrack: RecommendedTrack;
  strongModuleIds: string[];
  focusModuleIds: string[];
  confidenceLow: number | null;
  confidenceHigh: number | null;
  decisionReason: string | null;
  diagnosticTaskCount: number | null;
  completedAt: string | null;
};

export type WeekPlanItem = {
  id: string;
  day: StudyDay;
  minutes: 15 | 25 | 40;
  kind: 'orientation' | 'lesson' | 'practice' | 'review' | 'placement';
  title: string;
  detail: string;
  moduleId: string | null;
};

export type LearnerOnboardingProfile = {
  version: 1;
  goal: LearnerGoal | null;
  experience: ExperienceLevel | null;
  programmingExperience: ProgrammingExperience | null;
  priorSqlExperience: PriorSqlExperience | null;
  dialect: SqlDialectPreference;
  routePreference: LearningRoutePreference;
  dailyMinutes: 15 | 25 | 40;
  studyDays: StudyDay[];
  pace: StudyPace;
  placement: PlacementResult;
  firstWeekPlan: WeekPlanItem[];
  recoveryRule: string;
  completedAt: string | null;
  updatedAt: string;
};

export type CloudOnboardingProfile = {
  profile: LearnerOnboardingProfile | null;
  revision: number;
  updatedAt: string | null;
};

export const ONBOARDING_CHANGED_EVENT = 'sql-academy-onboarding-changed';
export const ONBOARDING_SYNCED_EVENT = 'sql-academy-onboarding-synced';
export const ONBOARDING_ASSESSMENT_INTENT_KEY = 'sql-academy-onboarding-assessment-intent-v1';

export const goalOptions: Array<{ id: LearnerGoal; title: string; description: string; track: RecommendedTrack }> = [
  { id: 'support', title: 'SQL для поддержки', description: 'Диагностика инцидентов, SLA, очереди, качество данных и расследования.', track: 'support' },
  { id: 'analyst', title: 'Аналитика', description: 'Метрики, агрегации, окна, временные ряды и объяснимые отчёты.', track: 'analytics' },
  { id: 'backend', title: 'SQL для бэкенда', description: 'Схемы, DML, транзакции, индексы, планы и безопасные изменения.', track: 'performance' },
  { id: 'data-engineering', title: 'Data engineering', description: 'Качество, моделирование, воспроизводимые SQL-конвейеры и контроль повторного запуска.', track: 'data-engineering' },
  { id: 'interview', title: 'Интервью', description: 'Задачи под временем, формулирование допущений и устойчивое объяснение решения.', track: 'interview' },
  { id: 'full', title: 'Полная академия', description: 'Последовательный путь от нуля до боевых задач и итоговых проектов.', track: 'fundamentals' }
];

export const studyDayLabels: Record<StudyDay, string> = {
  MO: 'Пн', TU: 'Вт', WE: 'Ср', TH: 'Чт', FR: 'Пт', SA: 'Сб', SU: 'Вс'
};

export const placementLevelLabels: Record<PlacementLevel, string> = {
  foundation: 'Базовый уровень',
  developing: 'Формирующийся уровень',
  working: 'Рабочий уровень',
  advanced: 'Продвинутый уровень'
};

export const recommendedTrackLabels: Record<RecommendedTrack, string> = {
  fundamentals: 'Основы SQL',
  analytics: 'Аналитический SQL',
  support: 'Поддержка и расследования',
  performance: 'Бэкенд и производительность',
  'data-engineering': 'Data engineering и качество',
  interview: 'Подготовка к интервью'
};

export const weekPlanKindLabels: Record<WeekPlanItem['kind'], string> = {
  orientation: 'Ориентация',
  lesson: 'Урок',
  practice: 'Практика',
  review: 'Повторение',
  placement: 'Диагностика'
};

const AUTH_SESSION_KEY = 'sql-academy-auth-session-v2';
const dayOrder: StudyDay[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const defaultPlacement: PlacementResult = {
  status: 'not-started',
  reportId: null,
  score: null,
  level: null,
  recommendedTrack: 'fundamentals',
  strongModuleIds: [],
  focusModuleIds: [],
  confidenceLow: null,
  confidenceHigh: null,
  decisionReason: null,
  diagnosticTaskCount: null,
  completedAt: null
};

const validGoals = new Set<LearnerGoal>(goalOptions.map(item => item.id));
const validExperience = new Set<ExperienceLevel>(['none', 'basics', 'regular', 'advanced']);
const validProgrammingExperience = new Set<ProgrammingExperience>(['none', 'some', 'professional']);
const validPriorSqlExperience = new Set<PriorSqlExperience>(['none', 'course', 'work']);
const validDialects = new Set<SqlDialectPreference>(['unknown', 'sqlite', 'postgresql', 'mysql', 'sqlserver']);
const validRoutePreferences = new Set<LearningRoutePreference>(['full', 'fast']);
const validPaces = new Set<StudyPace>(['gentle', 'steady', 'intensive']);
const validDays = new Set<StudyDay>(dayOrder);
const validPlacementStatuses = new Set<PlacementStatus>(['not-started', 'pending', 'completed', 'deferred']);
const validPlacementLevels = new Set<PlacementLevel>(['foundation', 'developing', 'working', 'advanced']);
const validTracks = new Set<RecommendedTrack>(['fundamentals', 'analytics', 'support', 'performance', 'data-engineering', 'interview']);
const validPlanKinds = new Set<WeekPlanItem['kind']>(['orientation', 'lesson', 'practice', 'review', 'placement']);

function now() {
  return new Date().toISOString();
}

function currentUserId() {
  if (typeof localStorage === 'undefined') return 'guest';
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null') as { userId?: unknown } | null;
    return typeof session?.userId === 'string' && session.userId ? session.userId : 'guest';
  } catch {
    return 'guest';
  }
}

export function emptyOnboardingProfile(): LearnerOnboardingProfile {
  return {
    version: 1,
    goal: null,
    experience: null,
    programmingExperience: null,
    priorSqlExperience: null,
    dialect: 'unknown',
    routePreference: 'full',
    dailyMinutes: 25,
    studyDays: ['MO', 'WE', 'FR'],
    pace: 'steady',
    placement: { ...defaultPlacement },
    firstWeekPlan: [],
    recoveryRule: 'Пропущенную сессию не удваивай: перенеси только один следующий шаг, а новую тему замени коротким повторением.',
    completedAt: null,
    updatedAt: now()
  };
}

function storageKey(userId = currentUserId()) {
  return `sql-academy-onboarding-v1:${userId}`;
}

function uniqueStudyDays(value: unknown): StudyDay[] {
  if (!Array.isArray(value)) return ['MO', 'WE', 'FR'];
  const selected = new Set(value.filter((item): item is StudyDay => typeof item === 'string' && validDays.has(item as StudyDay)));
  return dayOrder.filter(day => selected.has(day));
}

function sanitizePlan(value: unknown): WeekPlanItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const source = item as Partial<WeekPlanItem>;
    if (!source.day || !validDays.has(source.day)
      || (source.minutes !== 15 && source.minutes !== 25 && source.minutes !== 40)
      || !source.kind || !validPlanKinds.has(source.kind)
      || typeof source.title !== 'string'
      || typeof source.detail !== 'string') return [];
    return [{
      id: typeof source.id === 'string' ? source.id.slice(0, 100) : `week-${index + 1}`,
      day: source.day,
      minutes: source.minutes,
      kind: source.kind,
      title: source.title.slice(0, 160),
      detail: source.detail.slice(0, 600),
      moduleId: typeof source.moduleId === 'string' ? source.moduleId.slice(0, 100) : null
    } satisfies WeekPlanItem];
  }).slice(0, 7);
}

export function sanitizeOnboardingProfile(value: unknown): LearnerOnboardingProfile {
  const fallback = emptyOnboardingProfile();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const source = value as Partial<LearnerOnboardingProfile>;
  const placementSource = source.placement && typeof source.placement === 'object'
    ? source.placement as Partial<PlacementResult>
    : {};
  const goal = source.goal && validGoals.has(source.goal) ? source.goal : null;
  const experience = source.experience && validExperience.has(source.experience) ? source.experience : null;
  const programmingExperience = source.programmingExperience && validProgrammingExperience.has(source.programmingExperience)
    ? source.programmingExperience
    : 'none';
  const priorSqlExperience = source.priorSqlExperience && validPriorSqlExperience.has(source.priorSqlExperience)
    ? source.priorSqlExperience
    : experience === 'none' ? 'none' : experience === 'basics' ? 'course' : experience ? 'work' : null;
  const dialect = source.dialect && validDialects.has(source.dialect) ? source.dialect : 'unknown';
  const routePreference = source.routePreference && validRoutePreferences.has(source.routePreference) ? source.routePreference : 'full';
  const dailyMinutes = source.dailyMinutes === 15 || source.dailyMinutes === 40 ? source.dailyMinutes : 25;
  const selectedDays = uniqueStudyDays(source.studyDays);
  const studyDays = selectedDays.length >= 2 ? selectedDays : fallback.studyDays;
  const pace = source.pace && validPaces.has(source.pace)
    ? source.pace
    : dailyMinutes === 15 ? 'gentle' : dailyMinutes === 40 ? 'intensive' : 'steady';
  const placementStatus = placementSource.status && validPlacementStatuses.has(placementSource.status)
    ? placementSource.status
    : 'not-started';
  const level = placementSource.level && validPlacementLevels.has(placementSource.level) ? placementSource.level : null;
  const track = placementSource.recommendedTrack && validTracks.has(placementSource.recommendedTrack)
    ? placementSource.recommendedTrack
    : goalOptions.find(item => item.id === goal)?.track || 'fundamentals';

  return {
    version: 1,
    goal,
    experience,
    programmingExperience,
    priorSqlExperience,
    dialect,
    routePreference,
    dailyMinutes,
    studyDays,
    pace,
    placement: {
      status: placementStatus,
      reportId: typeof placementSource.reportId === 'string' ? placementSource.reportId.slice(0, 120) : null,
      score: typeof placementSource.score === 'number' ? Math.min(100, Math.max(0, Math.round(placementSource.score))) : null,
      level,
      recommendedTrack: track,
      strongModuleIds: Array.isArray(placementSource.strongModuleIds)
        ? Array.from(new Set(placementSource.strongModuleIds.filter((item): item is string => typeof item === 'string'))).slice(0, 32)
        : [],
      focusModuleIds: Array.isArray(placementSource.focusModuleIds)
        ? Array.from(new Set(placementSource.focusModuleIds.filter((item): item is string => typeof item === 'string'))).slice(0, 8)
        : [],
      confidenceLow: typeof placementSource.confidenceLow === 'number'
        ? Math.min(100, Math.max(0, Math.round(placementSource.confidenceLow)))
        : null,
      confidenceHigh: typeof placementSource.confidenceHigh === 'number'
        ? Math.min(100, Math.max(0, Math.round(placementSource.confidenceHigh)))
        : null,
      decisionReason: typeof placementSource.decisionReason === 'string' ? placementSource.decisionReason.slice(0, 600) : null,
      diagnosticTaskCount: typeof placementSource.diagnosticTaskCount === 'number'
        ? Math.min(7, Math.max(0, Math.round(placementSource.diagnosticTaskCount)))
        : null,
      completedAt: typeof placementSource.completedAt === 'string' ? placementSource.completedAt : null
    },
    firstWeekPlan: sanitizePlan(source.firstWeekPlan),
    recoveryRule: typeof source.recoveryRule === 'string' && source.recoveryRule.trim()
      ? source.recoveryRule.slice(0, 800)
      : fallback.recoveryRule,
    completedAt: typeof source.completedAt === 'string' ? source.completedAt : null,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now()
  };
}

export function storedOnboardingProfile(userId = currentUserId()): LearnerOnboardingProfile | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  try {
    return sanitizeOnboardingProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadOnboardingProfile(userId = currentUserId()) {
  return storedOnboardingProfile(userId) || emptyOnboardingProfile();
}

export function saveOnboardingProfile(profile: LearnerOnboardingProfile, userId = currentUserId()) {
  const next = sanitizeOnboardingProfile({ ...profile, updatedAt: now() });
  if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey(userId), JSON.stringify(next));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ONBOARDING_CHANGED_EVENT, { detail: next }));
  return next;
}

export function latestCompletedDiagnostic(reports: AssessmentReport[]) {
  return reports
    .filter(report => report.mode === 'diagnostic' && report.status === 'completed')
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0] || null;
}

export function placementLevel(score: number): PlacementLevel {
  if (score >= 82) return 'advanced';
  if (score >= 65) return 'working';
  if (score >= 42) return 'developing';
  return 'foundation';
}

function goalTrack(goal: LearnerGoal | null): RecommendedTrack {
  return goalOptions.find(item => item.id === goal)?.track || 'fundamentals';
}

export function calculatePlacement(profile: LearnerOnboardingProfile, report: AssessmentReport): PlacementResult {
  const scores = [...report.moduleScores].sort((left, right) => right.score - left.score || left.module.localeCompare(right.module));
  const strongModuleIds = scores.filter(item => item.score >= 80).map(item => item.module);
  const focusModuleIds = [...scores]
    .filter(item => item.score < 70)
    .sort((left, right) => left.score - right.score || left.module.localeCompare(right.module))
    .slice(0, 4)
    .map(item => item.module);
  const level = report.adaptiveDecision?.level || placementLevel(report.score);
  return {
    status: 'completed',
    reportId: report.id,
    score: report.score,
    level,
    recommendedTrack: report.score >= 65 ? goalTrack(profile.goal) : 'fundamentals',
    strongModuleIds,
    focusModuleIds,
    confidenceLow: report.adaptiveDecision?.scoreBand.low ?? report.measurement?.scoreBand.low ?? null,
    confidenceHigh: report.adaptiveDecision?.scoreBand.high ?? report.measurement?.scoreBand.high ?? null,
    decisionReason: report.adaptiveDecision?.explanation || null,
    diagnosticTaskCount: report.adaptiveDecision?.completedCount ?? report.taskScores.length,
    completedAt: report.completedAt
  };
}

export function deferredPlacement(_profile: LearnerOnboardingProfile): PlacementResult {
  return { ...defaultPlacement, status: 'deferred', recommendedTrack: 'fundamentals' };
}

export function profileForPlacementRetake(profile: LearnerOnboardingProfile, latestReportId: string | null = null) {
  if (profile.placement.status === 'completed') return profile;
  return sanitizeOnboardingProfile({
    ...profile,
    placement: {
      ...defaultPlacement,
      status: 'pending',
      reportId: latestReportId || profile.placement.reportId,
      recommendedTrack: profile.placement.recommendedTrack
    },
    completedAt: null,
    firstWeekPlan: []
  });
}

function planTemplate(kind: WeekPlanItem['kind'], moduleId: string | null) {
  if (kind === 'orientation') return {
    title: 'Контракт результата и рабочая среда',
    detail: 'Определи, что означает одна строка результата, и проверь одну короткую задачу без подсказки. Вводная сессия не заменяет отдельное повторение по памяти.'
  };
  if (kind === 'review') return {
    title: 'Повторение по памяти без перечитывания',
    detail: 'Сначала воспроизведи модель по памяти, затем проверь карточку и повтори одну ошибочную задачу.'
  };
  if (kind === 'placement') return {
    title: 'Исполняемая диагностика',
    detail: 'Пройди диагностическую проверку SQL. Самооценка не открывает продвинутые модули без подтверждённого результата.'
  };
  const title = moduleId ? onboardingModuleTitle(moduleId) : 'Основы SQL';
  return kind === 'lesson'
    ? { title: `Урок: ${title}`, detail: 'Разбери модель темы, пройди проверку понимания и сразу перейди к связанной практике.' }
    : { title: `Самостоятельная практика: ${title}`, detail: 'Реши задачу без подсказки и эталона. При ошибке разбери причину и следующий шаг, а не перебирай SQL наугад.' };
}

function weekKinds(profile: LearnerOnboardingProfile, count: number): WeekPlanItem['kind'][] {
  const pending = profile.placement.status === 'not-started' || profile.placement.status === 'pending';
  if (pending) {
    if (count === 2) return ['placement', 'practice'];
    if (count === 3) return ['placement', 'practice', 'review'];
    return Array.from({ length: count }, (_, index) => {
      if (index === 0) return 'placement';
      if (index === 1) return 'lesson';
      if (index === 2) return 'practice';
      if (index === 3) return 'review';
      return index % 2 === 0 ? 'practice' : 'review';
    });
  }
  if (count === 2) return ['practice', 'review'];
  if (count === 3) return profile.routePreference === 'fast'
    ? ['practice', 'review', 'practice']
    : ['orientation', 'practice', 'review'];
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return profile.routePreference === 'fast' ? 'practice' : 'orientation';
    if (index === 1) return 'lesson';
    if (index === 2) return 'practice';
    if (index === 3) return 'review';
    return index % 2 === 0 ? 'practice' : 'review';
  });
}

export function firstWeekRouteModuleIds(profile: LearnerOnboardingProfile) {
  const route = goalModuleRoute(profile.goal);
  const safeBypasses = profile.placement.status === 'completed'
    ? safeDiagnosticBypass(profile.goal, profile.placement.strongModuleIds)
    : [];
  const remaining = route.filter(moduleId => !safeBypasses.includes(moduleId));
  return (remaining.length ? remaining : route).slice(0, 5);
}

export function buildFirstWeekPlan(profile: LearnerOnboardingProfile): WeekPlanItem[] {
  const selectedDays = (profile.studyDays.length >= 2 ? profile.studyDays : ['MO', 'WE', 'FR'] as StudyDay[]).slice(0, 7);
  const focus = firstWeekRouteModuleIds(profile);
  const kinds = weekKinds(profile, selectedDays.length);
  const goalLabel = goalOptions.find(item => item.id === profile.goal)?.title || 'SQL';
  const sharedFoundation = new Set<string>(SHARED_FOUNDATION_MODULE_IDS);
  let focusIndex = 0;
  return selectedDays.map((day, index) => {
    const kind = kinds[index];
    const moduleId = kind === 'lesson' || kind === 'practice'
      ? focus[focusIndex++ % focus.length]
      : null;
    const template = planTemplate(kind, moduleId);
    const routeDetail = moduleId
      ? sharedFoundation.has(moduleId)
        ? ' Общая база обязательна для любой выбранной цели.'
        : ` Это ближайший доступный приоритет маршрута «${goalLabel}» с учётом уже пройденных основ.`
      : '';
    return {
      id: `week-${index + 1}-${day.toLowerCase()}`,
      day,
      minutes: profile.dailyMinutes,
      kind,
      title: index === 0 ? `${goalLabel} · ${template.title}` : template.title,
      detail: `${template.detail}${routeDetail}`,
      moduleId
    };
  });
}

export function completeOnboarding(
  profile: LearnerOnboardingProfile,
  placement: PlacementResult,
  completedAt = now()
) {
  const next = sanitizeOnboardingProfile({
    ...profile,
    placement,
    completedAt,
    updatedAt: completedAt
  });
  return { ...next, firstWeekPlan: buildFirstWeekPlan(next) };
}

export function onboardingReady(profile: LearnerOnboardingProfile) {
  return Boolean(profile.goal
    && profile.experience
    && profile.programmingExperience
    && profile.priorSqlExperience
    && profile.studyDays.length >= 2
    && (profile.placement.status === 'completed' || profile.placement.status === 'deferred')
    && profile.completedAt);
}

export function updateOnboardingPreferences(
  profile: LearnerOnboardingProfile,
  patch: Partial<Pick<LearnerOnboardingProfile, 'goal' | 'dailyMinutes' | 'studyDays' | 'pace' | 'programmingExperience' | 'priorSqlExperience' | 'experience' | 'dialect' | 'routePreference'>>
) {
  const next = sanitizeOnboardingProfile({ ...profile, ...patch, updatedAt: now() });
  return {
    ...next,
    placement: profile.placement,
    completedAt: profile.completedAt,
    firstWeekPlan: buildFirstWeekPlan(next)
  };
}

export function preferredOnboardingProfile(
  local: LearnerOnboardingProfile | null,
  cloud: LearnerOnboardingProfile | null
) {
  if (!local) return cloud;
  if (!cloud) return local;
  if (local.updatedAt !== cloud.updatedAt) return local.updatedAt > cloud.updatedAt ? local : cloud;
  const left = JSON.stringify(local);
  const right = JSON.stringify(cloud);
  return left.length >= right.length ? local : cloud;
}
