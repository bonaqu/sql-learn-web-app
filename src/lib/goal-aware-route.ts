import { curriculumLessons } from '../data/complete-curriculum';
import {
  canonicalModuleIds,
  moduleOrderIndex,
  phaseDefinitions
} from '../data/learning-structure';
import type { LearnerGoal } from './learner-onboarding';

type ModuleId = typeof canonicalModuleIds[number];

export type GoalRouteReasonCode =
  | 'shared-foundation'
  | 'goal-priority'
  | 'balanced-route'
  | 'prerequisite-recovery';

export type GoalModuleFrontier = {
  goal: LearnerGoal;
  routeModuleIds: string[];
  completedModuleIds: string[];
  eligibleModuleIds: string[];
  nextModuleId: string | null;
  nextReasonCode: GoalRouteReasonCode | null;
  nextReason: string | null;
};

export const SHARED_FOUNDATION_MODULE_IDS: readonly string[] = [...phaseDefinitions[0].moduleIds];

const goalPriority: Record<LearnerGoal, readonly string[]> = {
  support: [
    'support',
    'final',
    'incident-investigation',
    'conditional-aggregation',
    'window-frames',
    'null-logic-advanced',
    'advanced-joins',
    'recursive-cte',
    'pagination-patterns',
    'data-quality',
    'indexes',
    'explain',
    'transactions',
    'schema',
    'dml',
    'concurrency',
    'schema-evolution',
    'sql-security',
    'json-sql',
    'set-ops'
  ],
  analyst: [
    'joins',
    'subqueries',
    'cte',
    'windows',
    'dates',
    'text',
    'null-logic-advanced',
    'conditional-aggregation',
    'window-frames',
    'set-ops',
    'data-quality',
    'json-sql',
    'advanced-joins',
    'recursive-cte',
    'support',
    'final',
    'incident-investigation',
    'indexes',
    'explain',
    'pagination-patterns',
    'transactions',
    'schema',
    'dml',
    'schema-evolution',
    'sql-security',
    'concurrency'
  ],
  backend: [
    'joins',
    'subqueries',
    'cte',
    'windows',
    'dates',
    'text',
    'set-ops',
    'data-quality',
    'indexes',
    'explain',
    'transactions',
    'schema',
    'dml',
    'schema-evolution',
    'sql-security',
    'concurrency',
    'pagination-patterns',
    'json-sql',
    'null-logic-advanced',
    'conditional-aggregation',
    'advanced-joins',
    'recursive-cte',
    'window-frames',
    'support',
    'final',
    'incident-investigation'
  ],
  interview: [
    'joins',
    'subqueries',
    'advanced-joins',
    'cte',
    'recursive-cte',
    'windows',
    'dates',
    'window-frames',
    'text',
    'null-logic-advanced',
    'conditional-aggregation',
    'set-ops',
    'data-quality',
    'indexes',
    'explain',
    'transactions',
    'schema',
    'dml',
    'concurrency',
    'pagination-patterns',
    'schema-evolution',
    'sql-security',
    'json-sql',
    'support',
    'final',
    'incident-investigation'
  ],
  full: canonicalModuleIds
};

const knownModuleIds = new Set<ModuleId>(canonicalModuleIds);
const sharedFoundation = new Set<ModuleId>(phaseDefinitions[0].moduleIds);

function isModuleId(value: string): value is ModuleId {
  return knownModuleIds.has(value as ModuleId);
}

const prerequisitesByModule = new Map<ModuleId, ModuleId[]>(canonicalModuleIds.map(moduleId => {
  const prerequisites = new Set<ModuleId>();
  for (const lesson of curriculumLessons.filter(item => item.module === moduleId)) {
    for (const prerequisite of lesson.prerequisites) {
      if (prerequisite !== moduleId && isModuleId(prerequisite)) prerequisites.add(prerequisite);
    }
  }
  return [moduleId, [...prerequisites].sort((left, right) => moduleOrderIndex(left) - moduleOrderIndex(right))];
}));

function normalizedGoal(goal: LearnerGoal | null | undefined): LearnerGoal {
  return goal || 'full';
}

export function modulePrerequisiteIds(moduleId: string): string[] {
  return isModuleId(moduleId) ? [...(prerequisitesByModule.get(moduleId) || [])] : [];
}

function priorityIndex(goal: LearnerGoal, moduleId: ModuleId) {
  const foundationIndex = SHARED_FOUNDATION_MODULE_IDS.indexOf(moduleId);
  if (foundationIndex >= 0) return foundationIndex - 10_000;
  const preferred = goalPriority[goal].indexOf(moduleId);
  return preferred >= 0 ? preferred : goalPriority[goal].length + moduleOrderIndex(moduleId);
}

export function goalModuleRoute(goalInput: LearnerGoal | null | undefined): string[] {
  const goal = normalizedGoal(goalInput);
  const completed = new Set<ModuleId>();
  const remaining = new Set<ModuleId>(canonicalModuleIds);
  const route: ModuleId[] = [];

  while (remaining.size) {
    const eligible = [...remaining]
      .filter(moduleId => (prerequisitesByModule.get(moduleId) || []).every(prerequisite => completed.has(prerequisite)))
      .sort((left, right) =>
        priorityIndex(goal, left) - priorityIndex(goal, right)
        || moduleOrderIndex(left) - moduleOrderIndex(right)
        || left.localeCompare(right)
      );
    const next = eligible[0];
    if (!next) {
      const blocked = [...remaining].sort((left, right) => moduleOrderIndex(left) - moduleOrderIndex(right));
      throw new Error(`GOAL_ROUTE_PREREQUISITE_DEADLOCK:${goal}:${blocked.join(',')}`);
    }
    route.push(next);
    completed.add(next);
    remaining.delete(next);
  }

  return route;
}

export function safeDiagnosticBypass(
  goalInput: LearnerGoal | null | undefined,
  strongModuleIds: readonly string[] = []
) {
  const requested = new Set<ModuleId>(strongModuleIds.filter(isModuleId));
  const safe: ModuleId[] = [];
  for (const candidate of goalModuleRoute(goalInput)) {
    if (!isModuleId(candidate) || !requested.has(candidate)) break;
    if (!(prerequisitesByModule.get(candidate) || []).every(prerequisite => safe.includes(prerequisite))) break;
    safe.push(candidate);
  }
  return safe;
}

function routeReason(goal: LearnerGoal, moduleId: ModuleId): Pick<GoalModuleFrontier, 'nextReasonCode' | 'nextReason'> {
  if (sharedFoundation.has(moduleId)) {
    return {
      nextReasonCode: 'shared-foundation',
      nextReason: 'Общая база обязательна для любой цели: следующий модуль продолжает безопасный путь с нулевых знаний.'
    };
  }
  if (goal === 'full') {
    return {
      nextReasonCode: 'balanced-route',
      nextReason: 'Полная академия сохраняет сбалансированный порядок query, data change и production-навыков.'
    };
  }
  const preferred = goalPriority[goal].includes(moduleId);
  return preferred
    ? {
        nextReasonCode: 'goal-priority',
        nextReason: `Модуль уже открыт prerequisites и имеет повышенный приоритет для цели «${goal}».`
      }
    : {
        nextReasonCode: 'prerequisite-recovery',
        nextReason: 'Этот модуль нужен как prerequisite, прежде чем выбранная специализация сможет двигаться дальше.'
      };
}

export function goalModuleFrontier(
  goalInput: LearnerGoal | null | undefined,
  completedModuleIds: readonly string[]
): GoalModuleFrontier {
  const goal = normalizedGoal(goalInput);
  const routeModuleIds = goalModuleRoute(goal).filter(isModuleId);
  const completed = new Set<ModuleId>(completedModuleIds.filter(isModuleId));
  const eligibleModuleIds = routeModuleIds.filter(moduleId =>
    !completed.has(moduleId)
    && (prerequisitesByModule.get(moduleId) || []).every(prerequisite => completed.has(prerequisite))
  );
  const nextModuleId = eligibleModuleIds[0] || null;
  const reason = nextModuleId ? routeReason(goal, nextModuleId) : {
    nextReasonCode: null,
    nextReason: null
  };
  return {
    goal,
    routeModuleIds,
    completedModuleIds: routeModuleIds.filter(moduleId => completed.has(moduleId)),
    eligibleModuleIds,
    nextModuleId,
    ...reason
  };
}

export function goalRoutePriority(goalInput: LearnerGoal | null | undefined) {
  return [...goalPriority[normalizedGoal(goalInput)]];
}
