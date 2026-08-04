import type { SqlTask } from './course';
import { applyAdvancedAuthoredTaskOverrides } from './advanced-authored-content';
import { applyAdvancedSchemaEvolutionTaskOverrides } from './advanced-authored-schema-evolution';

export function applyAdvancedAuthoredCatalogOverrides(source: readonly SqlTask[]): SqlTask[] {
  return applyAdvancedSchemaEvolutionTaskOverrides(
    applyAdvancedAuthoredTaskOverrides(source)
  );
}
