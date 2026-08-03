import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalModuleIds } from '../src/data/learning-structure';
import {
  goalModuleFrontier,
  goalModuleRoute,
  modulePrerequisiteIds,
  safeDiagnosticBypass,
  SHARED_FOUNDATION_MODULE_IDS
} from '../src/lib/goal-aware-route';
import type { LearnerGoal } from '../src/lib/learner-onboarding';

const goals: LearnerGoal[] = ['support', 'analyst', 'backend', 'interview', 'full'];
const routes = new Map(goals.map(goal => [goal, goalModuleRoute(goal)]));
const canonicalSet = new Set(canonicalModuleIds);

for (const goal of goals) {
  const route = routes.get(goal) || [];
  assert.equal(route.length, canonicalModuleIds.length, `${goal}: route must contain every module.`);
  assert.equal(new Set(route).size, canonicalModuleIds.length, `${goal}: route must not contain duplicates.`);
  assert.deepEqual(new Set(route), canonicalSet, `${goal}: route coverage differs from the academy catalog.`);
  assert.deepEqual(route.slice(0, SHARED_FOUNDATION_MODULE_IDS.length), SHARED_FOUNDATION_MODULE_IDS,
    `${goal}: every zero-evidence learner must share the same mandatory foundation.`);

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

const sharedLength = SHARED_FOUNDATION_MODULE_IDS.length;
const postFoundationSignatures = new Set(goals.map(goal =>
  (routes.get(goal) || []).slice(sharedLength, sharedLength + 8).join('>')
));
assert.ok(postFoundationSignatures.size >= 4,
  'Onboarding goals must produce meaningfully different prerequisite-safe post-foundation routes.');
assert.notDeepEqual(routes.get('analyst'), routes.get('backend'),
  'Analyst and backend routes must not be cosmetic aliases.');
assert.notDeepEqual(routes.get('support'), routes.get('interview'),
  'Support and interview routes must not be cosmetic aliases.');

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
  'goalModuleFrontier'
]) assert.ok(routeSource.includes(marker), `Goal-aware route safety contract is missing ${marker}.`);

console.log(`Goal-aware routes validated: ${goals.length} deterministic prerequisite-safe routes, shared ${sharedLength}-module foundation, ${postFoundationSignatures.size} distinct post-foundation signatures, prerequisite-closed evidence and contiguous diagnostic bypass.`);
for (const goal of goals) {
  console.log(`${goal}: ${(routes.get(goal) || []).slice(0, 14).join(' -> ')}`);
}
