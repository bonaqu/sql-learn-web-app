export type EvidenceStrength = 'low-sample' | 'directional' | 'stable';

export type RateInterval = {
  rate: number;
  low: number;
  high: number;
};

export type CourseHealthItemAggregate = {
  periodStart: string;
  taskId: string;
  lessonId: string;
  contributors: number;
  attempted: number;
  independent: number;
  hinted: number;
  solutionViewed: number;
  misconceptions: number;
  remediations: number;
  remediationSuccesses: number;
  retained: number;
  placementChecks: number;
  placementMatches: number;
};

export type CourseHealthItemView = CourseHealthItemAggregate & {
  evidenceStrength: EvidenceStrength;
  independentInterval: RateInterval;
  retentionInterval: RateInterval;
  placementInterval: RateInterval;
};

export type CourseHealthSignalKind =
  | 'lesson-success-task-failure'
  | 'mass-misconception'
  | 'hint-escalation'
  | 'placement-mismatch'
  | 'retention-collapse'
  | 'lesson-explanation-risk';

export type CourseHealthSignal = {
  id: string;
  kind: CourseHealthSignalKind;
  priority: 'P0' | 'P1' | 'P2';
  taskId?: string;
  lessonId: string;
  sampleSize: number;
  evidenceStrength: EvidenceStrength;
  interpretation: string;
  alternative: string;
  action: string;
  acceptance: string[];
};

function rounded(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

export function wilsonInterval(successes: number, total: number, z = 1.645): RateInterval {
  if (!Number.isFinite(total) || total <= 0) return { rate: 0, low: 0, high: 1 };
  const n = Math.max(1, Math.floor(total));
  const success = Math.min(n, Math.max(0, Math.floor(successes)));
  const rate = success / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (rate + z2 / (2 * n)) / denominator;
  const margin = z * Math.sqrt((rate * (1 - rate) + z2 / (4 * n)) / n) / denominator;
  return {
    rate: rounded(rate),
    low: rounded(Math.max(0, center - margin)),
    high: rounded(Math.min(1, center + margin))
  };
}

export function evidenceStrength(contributors: number): EvidenceStrength {
  if (contributors < 20) return 'low-sample';
  if (contributors < 50) return 'directional';
  return 'stable';
}

export function courseHealthItemView(item: CourseHealthItemAggregate): CourseHealthItemView {
  return {
    ...item,
    evidenceStrength: evidenceStrength(item.contributors),
    independentInterval: wilsonInterval(item.independent, item.attempted),
    retentionInterval: wilsonInterval(item.retained, item.independent),
    placementInterval: wilsonInterval(item.placementMatches, item.placementChecks)
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function signal(
  item: CourseHealthItemView,
  kind: CourseHealthSignalKind,
  interpretation: string,
  alternative: string,
  action: string,
  acceptance: string[]
): CourseHealthSignal {
  return {
    id: `${item.periodStart}:${item.taskId}:${kind}`,
    kind,
    priority: kind === 'lesson-explanation-risk' || kind === 'retention-collapse' ? 'P1' : 'P2',
    taskId: item.taskId,
    lessonId: item.lessonId,
    sampleSize: item.contributors,
    evidenceStrength: item.evidenceStrength,
    interpretation,
    alternative,
    action,
    acceptance
  };
}

export function courseHealthSignals(source: CourseHealthItemAggregate[]): CourseHealthSignal[] {
  const items = source.map(courseHealthItemView);
  const lessons = new Map<string, { attempted: number; independent: number; misconceptions: number; remediations: number; remediationSuccesses: number }>();
  for (const item of items) {
    const current = lessons.get(item.lessonId) || { attempted: 0, independent: 0, misconceptions: 0, remediations: 0, remediationSuccesses: 0 };
    current.attempted += item.attempted;
    current.independent += item.independent;
    current.misconceptions += item.misconceptions;
    current.remediations += item.remediations;
    current.remediationSuccesses += item.remediationSuccesses;
    lessons.set(item.lessonId, current);
  }

  const results: CourseHealthSignal[] = [];
  for (const item of items) {
    const lesson = lessons.get(item.lessonId)!;
    const independentRate = ratio(item.independent, item.attempted);
    const lessonIndependentRate = ratio(lesson.independent, lesson.attempted);
    const misconceptionRate = ratio(item.misconceptions, item.contributors);
    const hintRate = ratio(item.hinted, item.contributors);
    const solutionRate = ratio(item.solutionViewed, item.contributors);
    const placementRate = ratio(item.placementMatches, item.placementChecks);
    const retentionRate = ratio(item.retained, item.independent);

    if (item.attempted >= 5 && independentRate <= 0.35 && lessonIndependentRate >= 0.6) {
      results.push(signal(item, 'lesson-success-task-failure',
        'Остальной lesson выглядит освоенным, а этот task заметно слабее: возможен скачок сложности или дефект task contract.',
        'Когорта могла попасть на редкий контекст; сначала проверь интервал и воспроизведи задачу на скрытых fixtures.',
        'Проверить prerequisite frontier, формулировку и hidden fixtures конкретной задачи.',
        ['Новая формулировка не раскрывает решение', 'Independent rate не ниже соседних задач в следующем допустимом cohort', 'Все semantic fixtures остаются зелёными']));
    }
    if (item.contributors >= 5 && misconceptionRate >= 0.6) {
      results.push(signal(item, 'mass-misconception',
        'Одна и та же diagnostic family повторяется у значимой доли cohort.',
        'Причиной может быть неоднозначный seed/expected shape, а не объяснение.',
        'Добавить counterexample к lesson и проверить expected result shape.',
        ['Misconception rate снижается без роста solution dependence', 'Counterexample проходит keyboard/mobile QA']));
    }
    if (item.contributors >= 5 && (hintRate >= 0.5 || solutionRate >= 0.25)) {
      results.push(signal(item, 'hint-escalation',
        'Задача часто требует hint/solution до самостоятельного результата.',
        'Высокая помощь допустима для первого worked example; проверь позицию задачи в lesson.',
        'Сверить fading sequence и оставить независимую transfer-задачу без подсказки.',
        ['Solution dependence не растёт', 'Independent transfer подтверждается на отдельной задаче']));
    }
    if (item.placementChecks >= 5 && placementRate < 0.6) {
      results.push(signal(item, 'placement-mismatch',
        'Рекомендованный уровень не подтверждается последующей работой на этом task contract.',
        'Малый cohort или смена цели после placement могут исказить сигнал.',
        'Проверить placement threshold и prerequisite-safe маршрут для этого lesson.',
        ['Повторный seeded persona route остаётся deterministic', 'Placement match достигает порога без обхода prerequisites']));
    }
    if (item.independent >= 5 && retentionRate < 0.5) {
      results.push(signal(item, 'retention-collapse',
        'Первичная самостоятельность не переносится в delayed retrieval.',
        'Review мог быть просрочен или выполнен на несопоставимом related task.',
        'Добавить отложенную related-but-non-identical retrieval-задачу через 3–7 дней.',
        ['Delayed retention interval улучшается', 'Review не использует исходное решение или тот же fixture']));
    }
  }

  for (const [lessonId, lesson] of lessons) {
    if (lesson.attempted < 10 || ratio(lesson.independent, lesson.attempted) >= 0.35) continue;
    const representative = items.find(item => item.lessonId === lessonId)!;
    results.push({
      ...signal(representative, 'lesson-explanation-risk',
        'Низкая independent success распределена по нескольким задачам lesson: вероятнее проблема объяснения/prerequisite, чем один сложный item.',
        'Когорта могла быть неверно размещена; сравни placement mismatch и соседний lesson.',
        'Перепроверить prediction → explanation → fading sequence и входные prerequisites.',
        ['Не менее двух task contracts улучшают lower confidence bound', 'Remediation success не ухудшается']),
      id: `${representative.periodStart}:${lessonId}:lesson-explanation-risk`,
      taskId: undefined
    });
  }

  return results.sort((left, right) => left.priority.localeCompare(right.priority) || right.sampleSize - left.sampleSize || left.id.localeCompare(right.id));
}

export function uncertaintyLabel(item: CourseHealthItemView) {
  const interval = item.independentInterval;
  const range = `${Math.round(interval.low * 100)}–${Math.round(interval.high * 100)}%`;
  if (item.evidenceStrength === 'low-sample') return `Мало данных: n=${item.contributors}, 90% interval ${range}. Не менять курс по одному сигналу.`;
  if (item.evidenceStrength === 'directional') return `Направляющий сигнал: n=${item.contributors}, 90% interval ${range}. Нужна проверка соседних cohorts.`;
  return `Устойчивый aggregate: n=${item.contributors}, 90% interval ${range}; причинность всё равно не доказана.`;
}
