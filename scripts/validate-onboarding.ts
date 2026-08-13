import { readFileSync } from 'node:fs';
import type { AssessmentReport } from '../src/lib/assessment.ts';
import {
  ADAPTIVE_DIAGNOSTIC_TASK_IDS,
  adaptiveDiagnosticCoverage,
  adaptiveDiagnosticDecision
} from '../src/lib/adaptive-placement.ts';
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
  placementLevelLabels,
  preferredOnboardingProfile,
  profileForPlacementRetake,
  recommendedTrackLabels,
  sanitizeOnboardingProfile,
  updateOnboardingPreferences,
  weekPlanKindLabels,
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
assert(Object.keys(placementLevelLabels).length === 4, 'Every persisted placement level needs a learner-facing label');
assert(Object.keys(recommendedTrackLabels).length === 5, 'Every persisted recommended track needs a learner-facing label');
assert(Object.keys(weekPlanKindLabels).length === 5, 'Every persisted week-plan kind needs a learner-facing label');
assert(new Set(Object.values(placementLevelLabels)).size === 4, 'Placement labels must remain distinct');
assert(new Set(Object.values(recommendedTrackLabels)).size === 5, 'Track labels must remain distinct');
assert(new Set(Object.values(weekPlanKindLabels)).size === 5, 'Week-plan labels must remain distinct');
assert(empty.dialect === 'unknown', 'Unknown dialect must be a first-class safe onboarding choice');
assert(empty.routePreference === 'full', 'A new learner must default to the full explanatory route');

function adaptiveAnswers(correct: readonly boolean[]) {
  return correct.map((value, index) => ({
    taskId: ADAPTIVE_DIAGNOSTIC_TASK_IDS[index],
    correct: value,
    skipped: !value
  }));
}

const zeroDecision = adaptiveDiagnosticDecision([]);
assert(zeroDecision.plannedCount === 3 && !zeroDecision.shouldStop,
  'Adaptive placement must begin with exactly three foundation probes.');
const beginnerDecision = adaptiveDiagnosticDecision(adaptiveAnswers([false, false, false]));
assert(beginnerDecision.shouldStop && beginnerDecision.completedCount === 3 && beginnerDecision.level === 'foundation',
  'A zero-level learner must stop after three probes instead of taking a long diagnostic.');
const bridgeDecision = adaptiveDiagnosticDecision(adaptiveAnswers([true, true, true]));
assert(!bridgeDecision.shouldStop && bridgeDecision.plannedCount === 5,
  'Three confident foundation results must increase difficulty to the working bridge.');
const workingDecision = adaptiveDiagnosticDecision(adaptiveAnswers([true, true, false, false, false]));
assert(workingDecision.shouldStop && workingDecision.completedCount === 5,
  'Uncertain bridge evidence must stop at five tasks instead of escalating.');
const challengeDecision = adaptiveDiagnosticDecision(adaptiveAnswers([true, true, true, true, true]));
assert(!challengeDecision.shouldStop && challengeDecision.plannedCount === 7,
  'Five confident results must open exactly two challenge probes.');
const advancedDecision = adaptiveDiagnosticDecision(adaptiveAnswers([true, true, true, true, true, true, false]));
assert(advancedDecision.shouldStop && advancedDecision.completedCount === 7 && advancedDecision.level === 'advanced',
  'Seven-probe ceiling must produce an explicit advanced boundary and stop.');
for (const decision of [beginnerDecision, workingDecision, advancedDecision]) {
  assert(decision.scoreBand.low >= 0 && decision.scoreBand.high <= 100 && decision.scoreBand.low <= decision.scoreBand.high,
    'Every adaptive exit must expose a bounded uncertainty interval.');
  assert(decision.explanation.length > 40, 'Every adaptive exit must explain why the diagnostic stopped.');
}
assert(adaptiveDiagnosticCoverage(ADAPTIVE_DIAGNOSTIC_TASK_IDS).valid,
  'The complete adaptive ladder must satisfy its authored skill blueprint.');
const negativeCoverage = adaptiveDiagnosticCoverage([
  ...ADAPTIVE_DIAGNOSTIC_TASK_IDS.slice(0, -1),
  ADAPTIVE_DIAGNOSTIC_TASK_IDS[0]
]);
assert(!negativeCoverage.valid && negativeCoverage.missingSkills.includes('performance'),
  'Negative coverage fixture must fail when the required performance probe is absent.');

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

const evidenceHash = JSON.stringify({ placement: completed.placement, completedAt: completed.completedAt });
const retakeProfile = profileForPlacementRetake(completed, 'new-report-not-completed');
assert(JSON.stringify({ placement: retakeProfile.placement, completedAt: retakeProfile.completedAt }) === evidenceHash,
  'Starting a retake must preserve the last valid placement until a new completed report exists.');
const changedPreferences = updateOnboardingPreferences(completed, {
  goal: 'analyst',
  dialect: 'postgresql',
  routePreference: 'fast'
});
assert(JSON.stringify({ placement: changedPreferences.placement, completedAt: changedPreferences.completedAt }) === evidenceHash,
  'Goal/dialect/route changes must preserve valid placement evidence and completion provenance byte-for-byte.');
assert(changedPreferences.goal === 'analyst' && changedPreferences.dialect === 'postgresql' && changedPreferences.routePreference === 'fast',
  'Preference changes must recompute future emphasis without reverting the requested choices.');
assert(changedPreferences.firstWeekPlan.some(item => item.moduleId),
  'Preference changes must deterministically rebuild the future week.');

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

const onboardingPortalSource = readFileSync(new URL('../src/components/OnboardingPortal.tsx', import.meta.url), 'utf8');
for (const forbidden of [
  "title: 'Placement'",
  "short: 'Evidence'",
  'Self-report ≠ evidence',
  'Diagnostic SQL Check',
  'executable placement',
  'Начать с foundation',
  'Support SQL',
  'Backend SQL',
  'визуал',
  'аудиал',
  'кинестетик',
  'Стартовый контракт',
  '{profile.placement.level}',
  '{profile.placement.recommendedTrack}',
  '{item.kind}'
]) {
  assert(!onboardingPortalSource.includes(forbidden), `Onboarding UI must not expose internal copy: ${forbidden}`);
}
for (const required of [
  'placementLevelLabels[profile.placement.level]',
  'recommendedTrackLabels[profile.placement.recommendedTrack]',
  'weekPlanKindLabels[item.kind]',
  'Самооценка ≠ подтверждённый навык',
  'Начать с базового уровня без диагностики',
  'SQL Academy · Стартовый план',
  'Принять стартовый план',
  'role="radiogroup"',
  'Опыт программирования',
  'Предыдущий опыт SQL',
  'Диалект для примеров',
  'Глубина первого маршрута',
  '3–7 задач'
]) {
  assert(onboardingPortalSource.includes(required), `Onboarding UI is missing localized contract: ${required}`);
}

if (failures.length) {
  console.error(`Onboarding validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

process.stdout.write(`Onboarding validated: 3→5→7 adaptive placement with uncertainty and negative coverage, localized goal/dialect/experience contract, safe placement prefix, dynamic analyst/backend divergence at ${analystBackendDivergence}, prerequisite-aware ${completed.firstWeekPlan.length}-session plan, preference evidence preservation, defer path and conflict resolution.\n`);
