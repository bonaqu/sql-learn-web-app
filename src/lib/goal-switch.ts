import type { CurriculumProgressV1 } from './curriculum-progress';
import {
  buildJourneyFrontier,
  type JourneyAction,
  type JourneyFrontier
} from './learning-journey';
import {
  buildFirstWeekPlan,
  goalOptions,
  sanitizeOnboardingProfile,
  type LearnerGoal,
  type LearnerOnboardingProfile
} from './learner-onboarding';
import type { Progress } from './progress';

export type GoalSwitchEvidence = {
  curriculum: CurriculumProgressV1;
  passedCheckpointIds?: readonly string[];
  assessmentComplete?: boolean;
  includeReview?: boolean;
};

export type GoalSwitchPreview = {
  currentGoal: LearnerGoal;
  proposedGoal: LearnerGoal;
  currentGoalTitle: string;
  proposedGoalTitle: string;
  changed: boolean;
  currentFrontier: JourneyFrontier;
  proposedFrontier: JourneyFrontier;
  immediateActionChanged: boolean;
  currentActionKey: string;
  proposedActionKey: string;
  completedModuleIds: string[];
  currentFutureModuleIds: string[];
  proposedFutureModuleIds: string[];
  unchangedFuturePrefixModuleIds: string[];
  firstDivergenceIndex: number | null;
  currentDivergenceModuleId: string | null;
  proposedDivergenceModuleId: string | null;
  movedEarlierModuleIds: string[];
  deferredModuleIds: string[];
  proposedProfile: LearnerOnboardingProfile;
};

function normalizedGoal(goal: LearnerGoal | null | undefined): LearnerGoal {
  return goal || 'full';
}

function goalTitle(goal: LearnerGoal) {
  return goalOptions.find(option => option.id === goal)?.title || goal;
}

function actionKey(action: JourneyAction) {
  return [
    action.kind,
    action.stage,
    action.task?.id || '',
    action.lessonId || '',
    action.checkpointId || '',
    action.projectId || '',
    action.moduleId || ''
  ].join(':');
}

function firstDifference(left: readonly string[], right: readonly string[]) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? null : length;
}

function frontierForGoal(
  profile: LearnerOnboardingProfile,
  goal: LearnerGoal,
  progress: Progress,
  evidence: GoalSwitchEvidence
) {
  return buildJourneyFrontier(progress, evidence.curriculum, {
    includeReview: evidence.includeReview,
    passedCheckpointIds: evidence.passedCheckpointIds,
    assessmentComplete: evidence.assessmentComplete,
    bypassedModuleIds: profile.placement.status === 'completed'
      ? profile.placement.strongModuleIds
      : [],
    goal
  });
}

export function profileAfterGoalChange(
  profile: LearnerOnboardingProfile,
  proposedGoal: LearnerGoal,
  updatedAt = new Date().toISOString()
) {
  const next = sanitizeOnboardingProfile({
    ...profile,
    goal: proposedGoal,
    updatedAt
  });
  return {
    ...next,
    firstWeekPlan: buildFirstWeekPlan(next)
  };
}

export function previewGoalChange(
  profile: LearnerOnboardingProfile,
  proposedGoal: LearnerGoal,
  progress: Progress,
  evidence: GoalSwitchEvidence
): GoalSwitchPreview {
  const currentGoal = normalizedGoal(profile.goal);
  const currentFrontier = frontierForGoal(profile, currentGoal, progress, evidence);
  const proposedFrontier = frontierForGoal(profile, proposedGoal, progress, evidence);
  const completed = new Set([
    ...currentFrontier.completedModuleIds,
    ...proposedFrontier.completedModuleIds
  ]);
  const currentFutureModuleIds = currentFrontier.routeModuleIds.filter(moduleId => !completed.has(moduleId));
  const proposedFutureModuleIds = proposedFrontier.routeModuleIds.filter(moduleId => !completed.has(moduleId));
  const firstDivergenceIndex = firstDifference(currentFutureModuleIds, proposedFutureModuleIds);
  const unchangedFuturePrefixModuleIds = firstDivergenceIndex === null
    ? [...currentFutureModuleIds]
    : currentFutureModuleIds.slice(0, firstDivergenceIndex);
  const currentPositions = new Map(currentFutureModuleIds.map((moduleId, index) => [moduleId, index]));
  const proposedPositions = new Map(proposedFutureModuleIds.map((moduleId, index) => [moduleId, index]));
  const movedEarlierModuleIds = proposedFutureModuleIds.filter((moduleId, index) =>
    index < (currentPositions.get(moduleId) ?? Number.MAX_SAFE_INTEGER)
  );
  const deferredModuleIds = currentFutureModuleIds.filter((moduleId, index) =>
    index < (proposedPositions.get(moduleId) ?? Number.MAX_SAFE_INTEGER)
  );
  const currentActionKey = actionKey(currentFrontier.action);
  const proposedActionKey = actionKey(proposedFrontier.action);

  return {
    currentGoal,
    proposedGoal,
    currentGoalTitle: goalTitle(currentGoal),
    proposedGoalTitle: goalTitle(proposedGoal),
    changed: currentGoal !== proposedGoal,
    currentFrontier,
    proposedFrontier,
    immediateActionChanged: currentActionKey !== proposedActionKey,
    currentActionKey,
    proposedActionKey,
    completedModuleIds: [...completed],
    currentFutureModuleIds,
    proposedFutureModuleIds,
    unchangedFuturePrefixModuleIds,
    firstDivergenceIndex,
    currentDivergenceModuleId: firstDivergenceIndex === null
      ? null
      : currentFutureModuleIds[firstDivergenceIndex] || null,
    proposedDivergenceModuleId: firstDivergenceIndex === null
      ? null
      : proposedFutureModuleIds[firstDivergenceIndex] || null,
    movedEarlierModuleIds,
    deferredModuleIds,
    proposedProfile: profileAfterGoalChange(profile, proposedGoal)
  };
}