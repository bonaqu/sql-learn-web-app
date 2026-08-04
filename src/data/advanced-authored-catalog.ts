import type { SqlTask } from './course';
import { applyAdvancedConditionalAggregationTaskOverrides } from './advanced-authored-conditional-aggregation';
import { applyAdvancedAuthoredTaskOverrides } from './advanced-authored-content';
import { applyAdvancedJoinsTaskOverrides } from './advanced-authored-joins';
import { applyAdvancedNullLogicTaskOverrides } from './advanced-authored-null-logic';
import { applyAdvancedRecursiveCteTaskOverrides } from './advanced-authored-recursive-cte';
import { applyAdvancedSchemaEvolutionTaskOverrides } from './advanced-authored-schema-evolution';
import { applyAdvancedWindowFramesTaskOverrides } from './advanced-authored-window-frames';

export function applyAdvancedAuthoredCatalogOverrides(source: readonly SqlTask[]): SqlTask[] {
  return applyAdvancedWindowFramesTaskOverrides(
    applyAdvancedRecursiveCteTaskOverrides(
      applyAdvancedJoinsTaskOverrides(
        applyAdvancedConditionalAggregationTaskOverrides(
          applyAdvancedNullLogicTaskOverrides(
            applyAdvancedSchemaEvolutionTaskOverrides(
              applyAdvancedAuthoredTaskOverrides(source)
            )
          )
        )
      )
    )
  );
}
