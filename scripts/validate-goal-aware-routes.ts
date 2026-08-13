import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalModuleIds } from '../src/data/learning-structure';
import {
  goalModuleFrontier,
  goalModuleRoute,
  learnerGoalTitle,
  modulePrerequisiteIds,
  safeDiagnosticBypass,
  SHARED_FOUNDATION_MODULE_IDS
} from '../src/lib/goal-aware-route';
import type { LearnerGoal } from '../src/lib/learner-onboarding';

const goals: LearnerGoal[] = ['support', 'analyst', 'backend', 'data-engineering', 'interview', 'full'];
const routes = new Map(goals.map(goal => [goal, goalModuleRoute(goal)]));
const canonicalSet = new Set(canonicalModuleIds);
const rawGoalCodes = /«(?:support|analyst|backend|data-engineering|interview|full)»/;

function firstDifference(left: readonly string[], right: readonly string[]) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : length;
}

for (const goal of goals) {
  const route = routes.get(goal) || [];
  assert.equal(route.length, canonicalModuleIds.length, `${goal}: route must contain every module.`);
  assert.equal(new Set(route).size, canonicalModuleIds.length, `${goal}: route must not contain duplicates.`);
  assert.deepEqual(new Set(route), canonicalSet, `${goal}: route coverage differs from the academy catalog.`);
  assert.deepEqual(route.slice(0, SHARED_FOUNDATION_MODULE_IDS.length), SHARED_FOUNDATION_MODULE_IDS,
    `${goal}: every zero-evidence learner must share the same mandatory foundation.`);
  assert.ok(learnerGoalTitle(goal).length >= 12, `${goal}: learner-facing goal title is missing.`);

  const positions = new Map(route.map((moduleId, index) => [moduleId, index]));
  for (const moduleId of route) {
    for (const prerequisite of modulePrerequisiteIds(moduleId)) {
      assert.ok((positions.get(prerequisite) ?? Number.MAX_SAFE_INTEGER) < (positions.get(moduleId) ?? -1),
        `${goal}: prerequisite ${prerequisite} must precede ${moduleId}.`);
    }
  }

  const completed: string[] = [];
  for (const expected of route) {
    const frontier = goalModuleFrontier(goal, completed);
    assert.equal(frontier.nextModuleId, expected,
      `${goal}: deterministic frontier diverged after ${completed.join(',') || 'zero evidence'}.`);
    assert.ok(frontier.eligibleModuleIds.includes(expected), `${goal}: next module must be eligible.`);
    assert.ok(modulePrerequisiteIds(expected).every(prerequisite => completed.includes(prerequisite)),
      `${goal}: frontier selected ${expected} before its prerequisites.`);
    assert.ok(!rawGoalCodes.test(frontier.nextReason || ''),
      `${goal}: learner-facing route reason exposed a raw goal code.`);
    if (frontier.nextReasonCode === 'goal-priority') {
      assert.ok(frontier.nextReason?.includes(`«${learnerGoalTitle(goal)}»`),
        `${goal}: priority reason must use the localized goal title.`);
    }
    completed.push(expected);
  }
  assert.equal(goalModuleFrontier(goal, completed).nextModuleId, null,
    `${goal}: completed route must not invent another module.`);

  const dependent = route.find(moduleId => modulePrerequisiteIds(moduleId).length > 0);
  assert.ok(dependent, `${goal}: route needs at least one dependent module.`);
  if (dependent) {
    const scattered = goalModuleFrontier(goal, [dependent]);
    assert.ok(!scattered.completedModuleIds.includes(dependent),
      `${goal}: out-of-order evidence for ${dependent} must not count before its prerequisites.`);
    assert.equal(scattered.nextModuleId, route[0],
      `${goal}: scattered late evidence must recover from the first missing prerequisite.`);
  }
}

const personaTraces = [
  { id: 'beginner', goal: 'full' as const, completed: [] as string[] },
  { id: 'select-aware', goal: 'full' as const, completed: goalModuleRoute('full').slice(0, 3) },
  { id: 'analyst', goal: 'analyst' as const, completed: goalModuleRoute('analyst').slice(0, SHARED_FOUNDATION_MODULE_IDS.length) },
  { id: 'support', goal: 'support' as const, completed: goalModuleRoute('support').slice(0, SHARED_FOUNDATION_MODULE_IDS.length) },
  { id: 'backend', goal: 'backend' as const, completed: goalModuleRoute('backend').slice(0, SHARED_FOUNDATION_MODULE_IDS.length) },
  { id: 'data-engineering', goal: 'data-engineering' as const, completed: goalModuleRoute('data-engineering').slice(0, SHARED_FOUNDATION_MODULE_IDS.length) },
  { id: 'interview', goal: 'interview' as const, completed: goalModuleRoute('interview').slice(0, SHARED_FOUNDATION_MODULE_IDS.length) },
  { id: 'returning-with-debt', goal: 'analyst' as const, completed: goalModuleRoute('analyst').slice(0, 2) }
];

for (const persona of personaTraces) {
  const first = goalModuleFrontier(persona.goal, persona.completed);
  const second = goalModuleFrontier(persona.goal, persona.completed);
  assert.deepEqual(second, first, `${persona.id}: identical evidence must yield an identical route trace.`);
  assert.ok(first.nextModuleId, `${persona.id}: fixture must retain a future prerequisite-safe module.`);
  assert.ok(first.nextModuleId && modulePrerequisiteIds(first.nextModuleId).every(prerequisite => first.completedModuleIds.includes(prerequisite)),
    `${persona.id}: next module must remain prerequisite-safe.`);
}

const sharedLength = SHARED_FOUNDATION_MODULE_IDS.length;
const fullRouteSignatures = new Set(goals.map(goal => (routes.get(goal) || []).join('>')));
assert.ok(fullRouteSignatures.size >= 4,
  'At least four learner goals must produce distinct complete prerequisite-safe routes.');
assert.notDeepEqual(routes.get('analyst'), routes.get('backend'),
  'Analyst and backend routes must not be cosmetic aliases.');
assert.notDeepEqual(routes.get('support'), routes.get('interview'),
  'Support and interview routes must not be cosmetic aliases.');

const fullRoute = routes.get('full') || [];
for (const goal of goals.filter(item => item !== 'full')) {
  const route = routes.get(goal) || [];
  const divergence = firstDifference(route, fullRoute);
  assert.ok(divergence >= sharedLength,
    `${goal}: specialization must preserve the declared shared foundation.`);
  assert.ok(divergence >= 0 && divergence < canonicalModuleIds.length - 4,
    `${goal}: specialization must change a meaningful route choice before the final four modules.`);
}

const analystRoute = routes.get('analyst') || [];
const backendRoute = routes.get('backend') || [];
const analystBackendDivergence = firstDifference(analystRoute, backendRoute);
assert.ok(analystBackendDivergence >= sharedLength,
  'Analyst and backend routes must share the beginner foundation before diverging.');
assert.ok(analystBackendDivergence >= 0 && analystBackendDivergence < canonicalModuleIds.length - 4,
  'Analyst and backend routes must diverge at a meaningful prerequisite-safe branch.');
assert.notEqual(analystRoute[analystBackendDivergence], backendRoute[analystBackendDivergence],
  'The first analyst/backend branch must select different eligible modules.');

for (const goal of goals) {
  const route = routes.get(goal) || [];
  const requestedPrefix = route.slice(0, 4);
  assert.deepEqual(safeDiagnosticBypass(goal, requestedPrefix), requestedPrefix,
    `${goal}: contiguous strong diagnostic prefix should remain bypassable.`);
  assert.deepEqual(safeDiagnosticBypass(goal, route.slice(1, 5)), [],
    `${goal}: diagnostic evidence must never bypass a missing route prefix.`);
  assert.deepEqual(safeDiagnosticBypass(goal, [route[0], route[2]]), [route[0]],
    `${goal}: a gap must stop diagnostic bypass at the last contiguous safe module.`);
}

const routeSource = readFileSync(new URL('../src/lib/goal-aware-route.ts', import.meta.url), 'utf8');
for (const marker of [
  'GOAL_ROUTE_PREREQUISITE_DEADLOCK',
  'requestedCompleted',
  'prerequisitesByModule.get(moduleId)',
  'SHARED_FOUNDATION_MODULE_IDS',
  'safeDiagnosticBypass',
  'goalModuleFrontier',
  'learnerGoalTitle'
]) assert.ok(routeSource.includes(marker), `Goal-aware route safety contract is missing ${marker}.`);
for (const forbiddenCopy of [
  'Модуль уже открыт prerequisites',
  'прежде чем выбранная специализация',
  'порядок query'
]) assert.ok(!routeSource.includes(forbiddenCopy), `Goal-aware route retained mixed learner copy: ${forbiddenCopy}`);

console.log(`Goal-aware routes validated: ${goals.length} deterministic prerequisite-safe routes, shared ${sharedLength}-module beginner foundation, ${fullRouteSignatures.size} distinct complete routes, analyst/backend divergence at index ${analystBackendDivergence}, prerequisite-closed evidence, localized route reasons and contiguous diagnostic bypass.`);
console.log(`Persona traces validated: ${personaTraces.map(persona => `${persona.id}:${goalModuleFrontier(persona.goal, persona.completed).nextModuleId}`).join(', ')}.`);
for (const goal of goals) {
  const route = routes.get(goal) || [];
  const divergence = goal === 'full' ? -1 : firstDifference(route, fullRoute);
  console.log(`${goal} (first difference vs full: ${divergence}): ${route.slice(0, 24).join(' -> ')}`);
}
