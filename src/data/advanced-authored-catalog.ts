import type { SqlTask } from './course';
import { applyAdvancedConditionalAggregationTaskOverrides } from './advanced-authored-conditional-aggregation';
import { applyAdvancedAuthoredTaskOverrides } from './advanced-authored-content';
import { applyAdvancedNullLogicTaskOverrides } from './advanced-authored-null-logic';
import { applyAdvancedSchemaEvolutionTaskOverrides } from './advanced-authored-schema-evolution';

export function applyAdvancedAuthoredCatalogOverrides(source: readonly SqlTask[]): SqlTask[] {
  return applyAdvancedConditionalAggregationTaskOverrides(
    applyAdvancedNullLogicTaskOverrides(
      applyAdvancedSchemaEvolutionTaskOverrides(
        applyAdvancedAuthoredTaskOverrides(source)
      )
    )
  );
}
