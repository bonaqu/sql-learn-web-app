import type { AssessmentReport } from '../src/lib/assessment.ts';
import { goalModuleRoute, SHARED_FOUNDATION_MODULE_IDS } from '../src/lib/goal-aware-route.ts';
import {
  buildFirstWeekPlan,
  calculatePlacement,
  completeOnboarding,
  deferredPlacement,
  emptyOnboardingProfile,
  firstWeekRouteModuleIds,
  latestCompletedDiagnostic,
  onboardingReady,
  placementLevel,
  preferredOnboardingProfile,
  sanitizeOnboardingProfile,
  type LearnerGoal,
  type LearnerOnboardingProfile
} from '../src/lib/learner-onboarding.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
const now = '2026-07-25T18:00:00.000Z';

function firstRouteDifference(left: readonly string[], right: readonly string[]) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : length;
}

function diagnosticReport(
  id: string,
  score: number,
  completedAt: string,
  moduleScores: Array<{ module: string; score: number }>,
  status: AssessmentReport['status'] = 'completed'
): AssessmentReport {
  return {
    version: 1,
    id,
    userId: 'onboarding-validator',
    mode: 'diagnostic',
    status,
    startedAt: completedAt,
    completedAt,
    durationSeconds: 900,
    score,
    grade: score >= 85 ? 'strong' : score >= 70 ? 'ready' : score >= 50 ? 'developing' : 'foundation',
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
    localDebrief: 'Onboarding validator fixture.'
  };
}

const empty = emptyOnboardingProfile();
assert(!onboardingReady(empty), 'Empty profile must not complete onboarding');
assert(empty.studyDays.length >= 2, 'Default study contract needs at least two days');

const sanitized = sanitizeOnboardingProfile({
  version: 1,
  goal: 'made-up',
  experience: 'expert-plus',
  dailyMinutes: 999,
  studyDays: ['MO'],
  pace: 'impossible',
  placement: { status: 'completed', score: 500, recommendedTrack: 'secret' },
  firstWeekPlan: [{ day: 'XX', minutes: 80, kind: 'magic' }]
});
assert(sanitized.goal === null, 'Unknown goal must be removed');
assert(sanitized.experience === null, 'Unknown experience must be removed');
assert(sanitized.dailyMinutes === 25, 'Invalid minutes must fall back to 25');
assert(sanitized.studyDays.length >= 2, 'Invalid one-day plan must migrate to safe default');
assert(sanitized.placement.status === 'completed', 'Known placement status should remain');
assert(sanitized.placement.score === 100, 'Placement score must be clamped');
assert(sanitized.placement.recommendedTrack === 'fundamentals', 'Unknown track must fall back safely');
assert(sanitized.firstWeekPlan.length === 0, 'Invalid week plan items must be removed');

assert(placementLevel(0) === 'foundation', '0 must map to foundation');
assert(placementLevel(41) === 'foundation', '41 must remain foundation');
assert(placementLevel(42) === 'developing', '42 must enter developing');
assert(placementLevel(64) === 'developing', '64 must remain developing');
assert(placementLevel(65) === 'working', '65 must enter working');
assert(placementLevel(81) === 'working', '81 must remain working');
assert(placementLevel(82) === 'advanced', '82 must enter advanced');

const supportProfile: LearnerOnboardingProfile = {
  ...empty,
  goal: 'support',
  experience: 'regular',
  dailyMinutes: 25,
  studyDays: ['MO', 'WE', 'FR'],
  pace: 'steady',
  updatedAt: now
};
const weakReport = diagnosticReport('weak', 52, '2026-07-25T17:00:00.000Z', [
  { module: 'select', score: 78 },
  { module: 'filtering', score: 45 },
  { module: 'joins', score: 25 }
]);
const weakPlacement = calculatePlacement(supportProfile, weakReport);
assert(weakPlacement.level === 'developing', '52 score must produce developing placement');
assert(weakPlacement.recommendedTrack === 'fundamentals', 'Weak placement must not skip foundation for a support self-report');
assert(weakPlacement.strongModuleIds.length === 0, 'Score below 80 must not become strong module evidence');
assert(weakPlacement.focusModuleIds[0] === 'joins', 'Lowest module must lead the remediation focus list');

const strongReport = diagnosticReport('strong', 86, '2026-07-25T18:00:00.000Z', [
  { module: 'select', score: 95 },
  { module: 'filtering', score: 84 },
  { module: 'joins', score: 68 },
  { module: 'windows', score: 55 }
]);
const strongPlacement = calculatePlacement(supportProfile, strongReport);
assert(strongPlacement.level === 'advanced', '86 score must produce advanced placement');
assert(strongPlacement.recommendedTrack === 'support', 'Strong executable evidence may recommend the requested support track');
assert(strongPlacement.strongModuleIds.includes('select') && strongPlacement.strongModuleIds.includes('filtering'), 'Strong module evidence must be explicit');
assert(strongPlacement.focusModuleIds[0] === 'windows', 'Focus modules must be ordered weakest first');

const olderHigh = diagnosticReport('older-high', 95, '2026-07-24T18:00:00.000Z', []);
const latestLower = diagnosticReport('latest-lower', 62, '2026-07-25T18:00:00.000Z', []);
const abandoned = diagnosticReport('abandoned', 100, '2026-07-26T18:00:00.000Z', [], 'abandoned');
assert(latestCompletedDiagnostic([olderHigh, latestLower, abandoned])?.id === 'latest-lower', 'Placement must use the latest completed diagnostic, not the best or abandoned attempt');

const completed = completeOnboarding(supportProfile, strongPlacement, now);
assert(onboardingReady(completed), 'Complete profile with executable placement must be ready');
assert(completed.firstWeekPlan.length === supportProfile.studyDays.length, 'First-week plan must use selected study days only');
assert(completed.firstWeekPlan.every(item => item.minutes === 25), 'Week plan must respect daily minutes');
assert(completed.firstWeekPlan.map(item => item.day).join(',') === 'MO,WE,FR', 'Week plan must preserve selected day order');
assert(completed.firstWeekPlan.some(item => item.kind === 'review'), 'A sustainable week needs retrieval review');
assert(completed.firstWeekPlan.some(item => item.kind === 'practice'), 'A sustainable week needs independent practice');
assert(firstWeekRouteModuleIds(completed)[0] === 'sql-thinking',
  'Non-contiguous strong modules must not skip the missing first shared prerequisite.');
assert(completed.firstWeekPlan.filter(item => item.moduleId).every(item =>
  firstWeekRouteModuleIds(completed).includes(item.moduleId || '')
), 'Every lesson/practice session must come from the same safe goal route.');

const pending = { ...supportProfile, placement: { ...supportProfile.placement, status: 'pending' as const } };
const pendingPlan = buildFirstWeekPlan(pending);
assert(pendingPlan[0]?.kind === 'placement', 'Pending onboarding must put executable placement first');
assert(firstWeekRouteModuleIds(pending).slice(0, SHARED_FOUNDATION_MODULE_IDS.length)
  .every((moduleId, index) => moduleId === SHARED_FOUNDATION_MODULE_IDS[index]),
  'Pending placement must preview the shared beginner foundation, not an advanced self-report route.');

const deferred = completeOnboarding(supportProfile, deferredPlacement(supportProfile), now);
assert(onboardingReady(deferred), 'Learner may explicitly defer placement and start from foundation');
assert(deferred.placement.recommendedTrack === 'fundamentals', 'Deferred placement must never infer an advanced track');
assert(firstWeekRouteModuleIds(deferred)[0] === 'sql-thinking', 'Deferred placement must start from zero.');

function advancedProfile(goal: LearnerGoal, prefixLength: number) {
  const route = goalModuleRoute(goal);
  const safePrefixLength = Math.max(SHARED_FOUNDATION_MODULE_IDS.length, Math.min(prefixLength, route.length - 1));
  const placement = {
    ...supportProfile.placement,
    status: 'completed' as const,
    score: 95,
    level: 'advanced' as const,
    recommendedTrack: goal === 'analyst' ? 'analytics' as const : goal === 'backend' ? 'performance' as const : 'fundamentals' as const,
    strongModuleIds: route.slice(0, safePrefixLength),
    focusModuleIds: [],
    completedAt: now
  };
  return completeOnboarding({
    ...supportProfile,
    goal,
    placement
  }, placement, now);
}

const analystRoute = goalModuleRoute('analyst');
const backendRoute = goalModuleRoute('backend');
const analystBackendDivergence = firstRouteDifference(analystRoute, backendRoute);
assert(analystBackendDivergence >= SHARED_FOUNDATION_MODULE_IDS.length,
  'Analyst/backend advanced fixture must branch only after the shared beginner foundation.');
assert(analystBackendDivergence >= 0 && analystBackendDivergence < analystRoute.length - 1,
  'Analyst/backend routes need a usable prerequisite-safe divergence point.');

const analystAdvanced = advancedProfile('analyst', analystBackendDivergence);
const backendAdvanced = advancedProfile('backend', analystBackendDivergence);
assert(firstWeekRouteModuleIds(analystAdvanced)[0] === analystRoute[analystBackendDivergence],
  'Analyst week must resume at its first real goal-specific branch.');
assert(firstWeekRouteModuleIds(backendAdvanced)[0] === backendRoute[analystBackendDivergence],
  'Backend week must resume at its first real goal-specific branch.');
assert(analystRoute[analystBackendDivergence] !== backendRoute[analystBackendDivergence],
  'Analyst and backend must select different eligible modules at their first branch.');
assert(firstWeekRouteModuleIds(analystAdvanced).join(',') !== firstWeekRouteModuleIds(backendAdvanced).join(','),
  'Advanced analyst and backend first-week routes must differ meaningfully after the shared prefix.');

const local = { ...completed, updatedAt: '2026-07-25T18:00:00.000Z' };
const cloud = { ...completed, goal: 'analyst' as const, updatedAt: '2026-07-25T17:00:00.000Z' };
assert(preferredOnboardingProfile(local, cloud)?.goal === 'support', 'Newer local onboarding profile must win conflict resolution');
assert(preferredOnboardingProfile(cloud, local)?.goal === 'support', 'Newer cloud onboarding profile must win conflict resolution');

const sameTimeSparse = { ...completed, firstWeekPlan: [], updatedAt: now };
const sameTimeRich = { ...completed, updatedAt: now };
assert(preferredOnboardingProfile(sameTimeSparse, sameTimeRich)?.firstWeekPlan.length === completed.firstWeekPlan.length, 'Richer same-time profile must win deterministically');

if (failures.length) {
  console.error(`Onboarding validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Onboarding validated: goal contract, safe placement prefix, dynamic analyst/backend divergence at ${analystBackendDivergence}, prerequisite-aware ${completed.firstWeekPlan.length}-session plan, defer path and conflict resolution.`);
