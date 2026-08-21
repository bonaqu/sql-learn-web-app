export type PerformanceMetric = 'lcpMs' | 'cls' | 'tbtMs' | 'transferKiB' | 'decodedKiB' | 'actionMs';
export type PerformanceBudget = Partial<Record<PerformanceMetric, number>>;

export const performanceBudgets = {
  firstVisit: { lcpMs: 2_000, cls: 0.1, tbtMs: 200, transferKiB: 180, decodedKiB: 600 },
  authenticatedHome: { lcpMs: 2_500, cls: 0.1, tbtMs: 400, transferKiB: 1_200, decodedKiB: 4_000 },
  routeOpen: { actionMs: 2_000, tbtMs: 300, transferKiB: 500, decodedKiB: 1_600 },
  practiceEditor: { actionMs: 6_000, tbtMs: 1_000, transferKiB: 3_500, decodedKiB: 7_000 },
  firstQuery: { actionMs: 1_500, tbtMs: 300 }
} as const satisfies Record<string, PerformanceBudget>;

export function assertPerformanceBudget(
  journey: keyof typeof performanceBudgets,
  measured: Partial<Record<PerformanceMetric, number>>
) {
  const budget = performanceBudgets[journey];
  for (const [metric, maximum] of Object.entries(budget) as Array<[PerformanceMetric, number]>) {
    const actual = measured[metric];
    if (!Number.isFinite(actual)) throw new Error(`${journey}.${metric} was not measured`);
    if ((actual as number) > maximum) throw new Error(`${journey}.${metric} ${actual} exceeds budget ${maximum}`);
  }
}
