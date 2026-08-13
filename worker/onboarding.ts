type LearnerGoal = 'support' | 'analyst' | 'backend' | 'data-engineering' | 'interview' | 'full';
type ExperienceLevel = 'none' | 'basics' | 'regular' | 'advanced';
type ProgrammingExperience = 'none' | 'some' | 'professional';
type PriorSqlExperience = 'none' | 'course' | 'work';
type SqlDialectPreference = 'unknown' | 'sqlite' | 'postgresql' | 'mysql' | 'sqlserver';
type LearningRoutePreference = 'full' | 'fast';
type StudyPace = 'gentle' | 'steady' | 'intensive';
type StudyDay = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
type PlacementStatus = 'not-started' | 'pending' | 'completed' | 'deferred';
type PlacementLevel = 'foundation' | 'developing' | 'working' | 'advanced';
type RecommendedTrack = 'fundamentals' | 'analytics' | 'support' | 'performance' | 'data-engineering' | 'interview';

type WeekPlanItem = {
  id: string;
  day: StudyDay;
  minutes: 15 | 25 | 40;
  kind: 'orientation' | 'lesson' | 'practice' | 'review' | 'placement';
  title: string;
  detail: string;
  moduleId: string | null;
};

type LearnerOnboardingProfile = {
  version: 1;
  goal: LearnerGoal | null;
  experience: ExperienceLevel | null;
  programmingExperience?: ProgrammingExperience | null;
  priorSqlExperience?: PriorSqlExperience | null;
  dialect?: SqlDialectPreference;
  routePreference?: LearningRoutePreference;
  dailyMinutes: 15 | 25 | 40;
  studyDays: StudyDay[];
  pace: StudyPace;
  placement: {
    status: PlacementStatus;
    reportId: string | null;
    score: number | null;
    level: PlacementLevel | null;
    recommendedTrack: RecommendedTrack;
    strongModuleIds: string[];
    focusModuleIds: string[];
    confidenceLow?: number | null;
    confidenceHigh?: number | null;
    decisionReason?: string | null;
    diagnosticTaskCount?: number | null;
    completedAt: string | null;
  };
  firstWeekPlan: WeekPlanItem[];
  recoveryRule: string;
  completedAt: string | null;
  updatedAt: string;
};

const MAX_BYTES = 40_000;
const goals = new Set<LearnerGoal>(['support', 'analyst', 'backend', 'data-engineering', 'interview', 'full']);
const experience = new Set<ExperienceLevel>(['none', 'basics', 'regular', 'advanced']);
const programmingExperience = new Set<ProgrammingExperience>(['none', 'some', 'professional']);
const priorSqlExperience = new Set<PriorSqlExperience>(['none', 'course', 'work']);
const dialects = new Set<SqlDialectPreference>(['unknown', 'sqlite', 'postgresql', 'mysql', 'sqlserver']);
const routePreferences = new Set<LearningRoutePreference>(['full', 'fast']);
const paces = new Set<StudyPace>(['gentle', 'steady', 'intensive']);
const days = new Set<StudyDay>(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
const placementStatuses = new Set<PlacementStatus>(['not-started', 'pending', 'completed', 'deferred']);
const placementLevels = new Set<PlacementLevel>(['foundation', 'developing', 'working', 'advanced']);
const tracks = new Set<RecommendedTrack>(['fundamentals', 'analytics', 'support', 'performance', 'data-engineering', 'interview']);
const planKinds = new Set<WeekPlanItem['kind']>(['orientation', 'lesson', 'practice', 'review', 'placement']);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-onboarding-contract': 'onboarding-v1',
    ...headers
  }
});

function boundedString(value: unknown, max: number) {
  return typeof value === 'string' && value.length <= max;
}

function nullableString(value: unknown, max: number) {
  return value === null || boundedString(value, max);
}

function validStringArray(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every(item => boundedString(item, maxLength));
}

function validPlanItem(value: unknown): value is WeekPlanItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<WeekPlanItem>;
  return boundedString(item.id, 100)
    && days.has(item.day as StudyDay)
    && (item.minutes === 15 || item.minutes === 25 || item.minutes === 40)
    && planKinds.has(item.kind as WeekPlanItem['kind'])
    && boundedString(item.title, 160)
    && boundedString(item.detail, 600)
    && nullableString(item.moduleId, 100);
}

function validProfile(value: unknown): value is LearnerOnboardingProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Partial<LearnerOnboardingProfile>;
  const placement = profile.placement;
  if (profile.version !== 1
    || !(profile.goal === null || goals.has(profile.goal as LearnerGoal))
    || !(profile.experience === null || experience.has(profile.experience as ExperienceLevel))
    || !(profile.programmingExperience === undefined || profile.programmingExperience === null || programmingExperience.has(profile.programmingExperience as ProgrammingExperience))
    || !(profile.priorSqlExperience === undefined || profile.priorSqlExperience === null || priorSqlExperience.has(profile.priorSqlExperience as PriorSqlExperience))
    || !(profile.dialect === undefined || dialects.has(profile.dialect as SqlDialectPreference))
    || !(profile.routePreference === undefined || routePreferences.has(profile.routePreference as LearningRoutePreference))
    || !(profile.dailyMinutes === 15 || profile.dailyMinutes === 25 || profile.dailyMinutes === 40)
    || !Array.isArray(profile.studyDays)
    || profile.studyDays.length < 2
    || profile.studyDays.length > 7
    || new Set(profile.studyDays).size !== profile.studyDays.length
    || !profile.studyDays.every(day => days.has(day))
    || !paces.has(profile.pace as StudyPace)
    || !placement
    || typeof placement !== 'object'
    || !placementStatuses.has(placement.status as PlacementStatus)
    || !nullableString(placement.reportId, 120)
    || !(placement.score === null || (typeof placement.score === 'number' && Number.isInteger(placement.score) && placement.score >= 0 && placement.score <= 100))
    || !(placement.level === null || placementLevels.has(placement.level as PlacementLevel))
    || !tracks.has(placement.recommendedTrack as RecommendedTrack)
    || !validStringArray(placement.strongModuleIds, 32, 100)
    || !validStringArray(placement.focusModuleIds, 8, 100)
    || !(placement.confidenceLow === undefined || placement.confidenceLow === null || (typeof placement.confidenceLow === 'number' && Number.isInteger(placement.confidenceLow) && placement.confidenceLow >= 0 && placement.confidenceLow <= 100))
    || !(placement.confidenceHigh === undefined || placement.confidenceHigh === null || (typeof placement.confidenceHigh === 'number' && Number.isInteger(placement.confidenceHigh) && placement.confidenceHigh >= 0 && placement.confidenceHigh <= 100))
    || !(placement.decisionReason === undefined || nullableString(placement.decisionReason, 600))
    || !(placement.diagnosticTaskCount === undefined || placement.diagnosticTaskCount === null || (typeof placement.diagnosticTaskCount === 'number' && Number.isInteger(placement.diagnosticTaskCount) && placement.diagnosticTaskCount >= 0 && placement.diagnosticTaskCount <= 7))
    || !nullableString(placement.completedAt, 80)
    || !Array.isArray(profile.firstWeekPlan)
    || profile.firstWeekPlan.length > 7
    || !profile.firstWeekPlan.every(validPlanItem)
    || !boundedString(profile.recoveryRule, 800)
    || !nullableString(profile.completedAt, 80)
    || !boundedString(profile.updatedAt, 80)) return false;
  return true;
}

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function readJson(request: Request) {
  try { return await request.json<unknown>(); } catch { return null; }
}

export async function handleOnboardingRequest(request: Request, env: Cloudflare.Env, userId: string) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/onboarding/profile') return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (request.method === 'GET') {
    const row = await env.DB.prepare(`SELECT payload, revision, updated_at
      FROM learner_onboarding_profiles WHERE user_id = ?`)
      .bind(userId)
      .first<{ payload: string; revision: number; updated_at: string }>();
    if (!row) return json({ profile: null, revision: 0, updatedAt: null });
    try {
      const profile = JSON.parse(row.payload) as unknown;
      if (!validProfile(profile)) return json({ error: 'Stored onboarding profile is invalid' }, 500);
      return json({ profile, revision: row.revision, updatedAt: row.updated_at });
    } catch {
      return json({ error: 'Stored onboarding profile is corrupted' }, 500);
    }
  }

  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PUT' });
  const body = await readJson(request) as { profile?: unknown; baseRevision?: unknown } | null;
  if (!body
    || !validProfile(body.profile)
    || typeof body.baseRevision !== 'number'
    || !Number.isInteger(body.baseRevision)
    || body.baseRevision < 0
    || body.baseRevision > 1_000_000) {
    return json({ error: 'Invalid onboarding sync payload' }, 400);
  }
  const serialized = JSON.stringify(body.profile);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) {
    return json({ error: 'Onboarding payload is too large' }, 413);
  }
  const updatedAt = sqliteTime();

  if (body.baseRevision === 0) {
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO learner_onboarding_profiles(user_id, payload, revision, updated_at)
      VALUES(?, ?, 1, ?)`).bind(userId, serialized, updatedAt).run();
    if ((inserted.meta.changes || 0) !== 1) {
      const current = await env.DB.prepare(`SELECT revision, updated_at FROM learner_onboarding_profiles WHERE user_id = ?`)
        .bind(userId).first<{ revision: number; updated_at: string }>();
      return json({ error: 'Onboarding profile conflict', revision: current?.revision || 0, updatedAt: current?.updated_at || null }, 409);
    }
  } else {
    const updated = await env.DB.prepare(`UPDATE learner_onboarding_profiles
      SET payload = ?, revision = revision + 1, updated_at = ?
      WHERE user_id = ? AND revision = ?`)
      .bind(serialized, updatedAt, userId, body.baseRevision).run();
    if ((updated.meta.changes || 0) !== 1) {
      const current = await env.DB.prepare(`SELECT revision, updated_at FROM learner_onboarding_profiles WHERE user_id = ?`)
        .bind(userId).first<{ revision: number; updated_at: string }>();
      return json({ error: 'Onboarding profile conflict', revision: current?.revision || 0, updatedAt: current?.updated_at || null }, 409);
    }
  }

  const current = await env.DB.prepare(`SELECT revision, updated_at FROM learner_onboarding_profiles WHERE user_id = ?`)
    .bind(userId).first<{ revision: number; updated_at: string }>();
  return json({ ok: true, revision: current?.revision || 0, updatedAt: current?.updated_at || null });
}
