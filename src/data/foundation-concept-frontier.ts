import type { FoundationConcept, TaskEvaluationContract } from '../lib/task-evaluation-contract';
import { tasks } from './course-catalog';

export const foundationModuleOrder = ['sql-thinking', 'filtering', 'select'] as const;

export const foundationIntroducedConcepts: Readonly<Record<typeof foundationModuleOrder[number], readonly FoundationConcept[]>> = {
  'sql-thinking': ['result-grain', 'select-list', 'from-source'],
  filtering: ['where-filter', 'boolean-logic', 'null-predicate'],
  select: ['expression', 'alias']
};

export function foundationFrontierViolations(
  contracts: readonly TaskEvaluationContract[],
  order: readonly string[] = foundationModuleOrder,
  introduced: Readonly<Record<string, readonly FoundationConcept[]>> = foundationIntroducedConcepts
) {
  const available = new Set<FoundationConcept>();
  const violations: string[] = [];
  for (const moduleId of order) {
    for (const concept of introduced[moduleId] || []) available.add(concept);
    for (const task of tasks.filter(item => item.module === moduleId)) {
      const contract = contracts.find(item => item.taskId === task.id);
      if (!contract) continue;
      for (const concept of contract.requiredConcepts) {
        if (!available.has(concept)) violations.push(`${task.id}:${concept}`);
      }
    }
  }
  return violations;
}
