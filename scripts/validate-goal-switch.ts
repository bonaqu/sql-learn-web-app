import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { curriculumCheckpoints } from '../src/data/complete-curriculum';
import { tasks } from '../src/data/course-catalog';
import { phaseDefinitions } from '../src/data/learning-structure';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress';
import { goalModuleRoute, SHARED_FOUNDATION_MODULE_IDS } from '../src/lib/goal-aware-route';
import {
  previewGoalChange,
  profileAfterGoalChange
} from '../src/lib/goal-switch';
import {
  emptyOnboardingProfile,
  type LearnerGoal,
  type LearnerOnboardingProfile
} from '../src/lib/learner-onboarding';
import type { Progress } from '../src/lib/progress';

const goals: LearnerGoal[] = ['support', 'analyst', 'backend', 'interview', 'full'];
const timestamp = '2026-08-03T19:30:00.000Z';
const history = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }));

function emptyProgress(): Progress {
  return {
    version: 4,
    completed: [],
    taskStats: {},
    xp: 0,
    streak: 0,
    history
  };
}

function profile(goal: LearnerGoal, strongModuleIds: string[] = []): LearnerOnboardingProfile {
  return {
    ...emptyOnboardingProfile(),
    goal,
    experience: strongModuleIds.length ? 'advanced' : 'none',
    placement: {
      status: strongModuleIds.length ? 'completed' : 'deferred',
      reportId: strongModuleIds.length ? `diagnostic-${goal}` : null,
      score: strongModuleIds.length ? 95 : null,
      level: strongModuleIds.length ? 'advanced' : null,
      recommendedTrack: 'fundamentals',
      strongModuleIds: [...strongModuleIds],
      focusModuleIds: ['filtering'],
      completedAt: strongModuleIds.length ? timestamp : null
    },
    completedAt: timestamp,
    updatedAt: timestamp
  };
}

function firstDifference(left: readonly string[], right: readonly string[]) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : length;
}

function checkpointIdsForPrefix(prefix: readonly string[]) {
  return phaseDefinitions.flatMap(phase => {
    if (!phase.moduleIds.every(moduleId => prefix.includes(moduleId))) return [];
    const checkpoint = curriculumCheckpoints.find(item =>
      item.moduleIds.some(moduleId => phase.moduleIds.includes(moduleId))
    );
    return checkpoint ? [checkpoint.id] : [];
  });
}

let switches = 0;
for (const currentGoal of goals) {
  for (const proposedGoal of goals) {
    if (currentGoal === proposedGoal) continue;
    switches += 1;
    const currentRoute = goalModuleRoute(currentGoal);
    const proposedRoute = goalModuleRoute(proposedGoal);
    const divergence = firstDifference(currentRoute, proposedRoute);
    assert.ok(divergence >= SHARED_FOUNDATION_MODULE_IDS.length,
      `${currentGoal}->${proposedGoal}: routes must preserve the shared beginner foundation.`);

    const zeroProfile = profile(currentGoal);
    const placementBefore = JSON.stringify(zeroProfile.placement);
    const zero = previewGoalChange(zeroProfile, proposedGoal, emptyProgress(), {
      curriculum: emptyCurriculumProgress(),
      includeReview: false
    });
    assert.equal(zero.currentFrontier.action.routeReasonCode, 'shared-foundation');
    assert.equal(zero.proposedFrontier.action.routeReasonCode, 'shared-foundation');
    assert.equal(zero.immediateActionChanged, false,
      `${currentGoal}->${proposedGoal}: a zero-evidence goal switch must not skip the common first action.`);
    assert.equal(JSON.stringify(zero.proposedProfile.placement), placementBefore,
      `${currentGoal}->${proposedGoal}: preview must preserve placement evidence byte-for-byte.`);
    assert.equal(zero.proposedProfile.goal, proposedGoal);
    assert.equal(zero.proposedFrontier.routeModuleIds.length, currentRoute.length,
      `${currentGoal}->${proposedGoal}: proposed route must retain every expert module.`);

    const checkpointProfile = profile(currentGoal, [...SHARED_FOUNDATION_MODULE_IDS]);
    const checkpoint = previewGoalChange(checkpointProfile, proposedGoal, emptyProgress(), {
      curriculum: emptyCurriculumProgress(),
      includeReview: false
    });
    assert.equal(checkpoint.currentFrontier.action.stage, 'checkpoint');
    assert.equal(checkpoint.proposedFrontier.action.stage, 'checkpoint');
    assert.equal(checkpoint.immediateActionChanged, false,
      `${currentGoal}->${proposedGoal}: a ready checkpoint must outrank specialization.`);

    const commonPrefix = currentRoute.slice(0, divergence);
    assert.deepEqual(commonPrefix, proposedRoute.slice(0, divergence));
    const divergenceProfile = profile(currentGoal, commonPrefix);
    const branch = previewGoalChange(divergenceProfile, proposedGoal, emptyProgress(), {
      curriculum: emptyCurriculumProgress(),
      passedCheckpointIds: checkpointIdsForPrefix(commonPrefix),
      includeReview: false
    });
    assert.equal(branch.firstDivergenceIndex, 0,
      `${currentGoal}->${proposedGoal}: after the completed common prefix, future routes must diverge immediately.`);
    assert.equal(branch.currentDivergenceModuleId, currentRoute[divergence]);
    assert.equal(branch.proposedDivergenceModuleId, proposedRoute[divergence]);
    assert.equal(branch.currentFrontier.action.moduleId, currentRoute[divergence]);
    assert.equal(branch.proposedFrontier.action.moduleId, proposedRoute[divergence]);
    assert.equal(branch.immediateActionChanged, true,
      `${currentGoal}->${proposedGoal}: the real eligible branch must change the immediate goal-priority action.`);
    assert.ok(branch.movedEarlierModuleIds.includes(proposedRoute[divergence]));
    assert.ok(branch.deferredModuleIds.includes(currentRoute[divergence]));
    assert.deepEqual(new Set(branch.currentFrontier.completedModuleIds), new Set(branch.proposedFrontier.completedModuleIds),
      `${currentGoal}->${proposedGoal}: goal changes must not alter completed evidence.`);

    const attempted = tasks[0];
    const reviewProgress: Progress = {
      ...emptyProgress(),
      taskStats: {
        [attempted.id]: {
          attempts: 1,
          incorrect: 1,
          hintsUsed: 0,
          lastAttemptAt: timestamp
        }
      }
    };
    const review = previewGoalChange(zeroProfile, proposedGoal, reviewProgress, {
      curriculum: emptyCurriculumProgress(),
      includeReview: true
    });
    assert.equal(review.currentFrontier.action.stage, 'review');
    assert.equal(review.proposedFrontier.action.stage, 'review');
    assert.equal(review.immediateActionChanged, false,
      `${currentGoal}->${proposedGoal}: unresolved remediation must outrank the proposed goal.`);

    const applied = profileAfterGoalChange(divergenceProfile, proposedGoal, timestamp);
    assert.equal(applied.goal, proposedGoal);
    assert.equal(JSON.stringify(applied.placement), JSON.stringify(divergenceProfile.placement),
      `${currentGoal}->${proposedGoal}: apply must preserve placement evidence.`);
    assert.equal(applied.completedAt, divergenceProfile.completedAt,
      `${currentGoal}->${proposedGoal}: apply must preserve onboarding completion provenance.`);
    assert.ok(applied.firstWeekPlan.some(item => item.moduleId === proposedRoute[divergence]),
      `${currentGoal}->${proposedGoal}: rebuilt week must include the proposed frontier branch.`);
  }
}

assert.equal(switches, 20, 'The validator must cover every ordered switch between five goals.');

const switchDomainSource = readFileSync(new URL('../src/lib/goal-switch.ts', import.meta.url), 'utf8');
for (const marker of [
  'buildJourneyFrontier',
  'currentFrontier',
  'proposedFrontier',
  'unchangedFuturePrefixModuleIds',
  'movedEarlierModuleIds',
  'deferredModuleIds',
  'profileAfterGoalChange'
]) assert.ok(switchDomainSource.includes(marker), `Goal switch domain is missing ${marker}.`);

const switchPanelSource = readFileSync(new URL('../src/components/GoalSwitchPanel.tsx', import.meta.url), 'utf8');
for (const marker of [
  'previewGoalChange',
  'saveOnboardingProfile',
  'syncOnboardingProfile',
  'goal-switch-panel',
  'goal-switch-cancel',
  'goal-switch-apply'
]) assert.ok(switchPanelSource.includes(marker), `Goal switch UI is missing ${marker}.`);
assert.ok(!switchPanelSource.includes('goalModuleRoute'),
  'Goal switch UI must not calculate a second route outside the canonical preview domain.');

const learningPathSource = readFileSync(new URL('../src/components/LearningPathPortal.tsx', import.meta.url), 'utf8');
for (const marker of [
  'GoalSwitchPanel',
  'goal: profile.goal',
  'moduleMastery(progress, sessionEvidence)',
  'learningPhases(progress, mastery, sessionEvidence)',
  'goal-switch-trigger',
  'goal-route-legend',
  'data-route-state'
]) assert.ok(learningPathSource.includes(marker), `Learning Path goal integration is missing ${marker}.`);
assert.ok(!learningPathSource.includes('goalModuleRoute'),
  'Learning Path must render canonical frontier state instead of calculating its own goal route.');

console.log(`Goal switching validated: ${switches} ordered switches preserve evidence, checkpoints/remediation outrank preference, real DAG divergences update only future route choices, and UI consumes one canonical preview domain.`);