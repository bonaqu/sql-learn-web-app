import type { SqlTask } from './course';
import { applyAdvancedConcurrencyTaskOverrides } from './advanced-authored-concurrency';
import { applyAdvancedConditionalAggregationTaskOverrides } from './advanced-authored-conditional-aggregation';
import { applyAdvancedAuthoredTaskOverrides } from './advanced-authored-content';
import { applyAdvancedJoinsTaskOverrides } from './advanced-authored-joins';
import { applyAdvancedJsonSqlTaskOverrides } from './advanced-authored-json-sql';
import { applyAdvancedNullLogicTaskOverrides } from './advanced-authored-null-logic';
import { applyAdvancedRecursiveCteTaskOverrides } from './advanced-authored-recursive-cte';
import { applyAdvancedSchemaEvolutionTaskOverrides } from './advanced-authored-schema-evolution';
import { applyAdvancedSqlSecurityTaskOverrides } from './advanced-authored-sql-security';
import { applyAdvancedWindowFramesTaskOverrides } from './advanced-authored-window-frames';

export function applyAdvancedAuthoredCatalogOverrides(source: readonly SqlTask[]): SqlTask[] {
  return applyAdvancedConcurrencyTaskOverrides(
    applyAdvancedSqlSecurityTaskOverrides(
      applyAdvancedJsonSqlTaskOverrides(
        applyAdvancedWindowFramesTaskOverrides(
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
        )
      )
    )
  );
}
