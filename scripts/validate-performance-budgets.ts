import assert from 'node:assert/strict';
import { assertPerformanceBudget, performanceBudgets, type PerformanceMetric } from './performance-budgets';

for (const [journey, budget] of Object.entries(performanceBudgets)) {
  assert.ok(Object.keys(budget).length >= 2, `${journey} must define at least two measured limits`);
  const passing = Object.fromEntries(Object.entries(budget).map(([metric, maximum]) => [metric, maximum])) as Partial<Record<PerformanceMetric, number>>;
  assert.doesNotThrow(() => assertPerformanceBudget(journey as keyof typeof performanceBudgets, passing));
  const [metric, maximum] = Object.entries(budget)[0] as [PerformanceMetric, number];
  assert.throws(
    () => assertPerformanceBudget(journey as keyof typeof performanceBudgets, { ...passing, [metric]: maximum + 1 }),
    new RegExp(`${journey}\\.${metric} .* exceeds budget ${maximum}`),
    `${journey} did not reject an injected over-budget ${metric}`
  );
}

process.stdout.write(`Performance budget enforcement passed for ${Object.keys(performanceBudgets).length} browser journeys, including injected failures.\n`);
