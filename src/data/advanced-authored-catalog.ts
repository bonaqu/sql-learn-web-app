import type { SqlTask } from './course';
import { applyAdvancedAuthoredTaskOverrides } from './advanced-authored-content';
import { applyAdvancedNullLogicTaskOverrides } from './advanced-authored-null-logic';
import { applyAdvancedSchemaEvolutionTaskOverrides } from './advanced-authored-schema-evolution';

export function applyAdvancedAuthoredCatalogOverrides(source: readonly SqlTask[]): SqlTask[] {
  return applyAdvancedNullLogicTaskOverrides(
    applyAdvancedSchemaEvolutionTaskOverrides(
      applyAdvancedAuthoredTaskOverrides(source)
    )
  );
}
