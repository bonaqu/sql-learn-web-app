import type {
  LearnerGoal,
  LearnerOnboardingProfile,
  RecommendedTrack,
  StudyPace
} from './learner-onboarding';

export type RouteStage =
  | 'lesson'
  | 'guided'
  | 'practice'
  | 'review'
  | 'checkpoint'
  | 'interview'
  | 'puzzle'
  | 'assessment'
  | 'project'
  | 'complete';

export type LearningRoutePolicy = {
  goal: LearnerGoal;
  title: string;
  promise: string;
  recommendedTrack: RecommendedTrack;
  pace: StudyPace;
  dailyMinutes: 15 | 25 | 40;
  reviewModuleIds: readonly string[];
  preferredTransferMode: 'interview' | 'puzzle';
  preferredProjectIds: readonly string[];
  stageFocus: Readonly<Record<RouteStage, string>>;
};

type RouteBlueprint = Omit<LearningRoutePolicy, 'pace' | 'dailyMinutes'>;

const commonComplete = 'Держи expert-уровень через retrieval review, повторные production checks и dialect labs.';

const blueprints: Record<LearnerGoal, RouteBlueprint> = {
  support: {
    goal: 'support',
    title: 'Support SQL',
    promise: 'От нулевого SQL-мышления к диагностике инцидентов, SLA, очередей и качества данных.',
    recommendedTrack: 'support',
    reviewModuleIds: [
      'filtering', 'joins', 'dates', 'data-quality', 'support', 'transactions',
      'concurrency', 'incident-investigation'
    ],
    preferredTransferMode: 'puzzle',
    preferredProjectIds: [
      'project-incident-command', 'project-executive-mart', 'project-data-trust'
    ],
    stageFocus: {
      lesson: 'Связывай mental model с тем, как инженер локализует инцидент и не теряет SLA-контекст.',
      guided: 'Проговори, какую диагностическую гипотезу проверяет каждый предикат и JOIN.',
      practice: 'Верни проверяемый срез для тикета, очереди или сервиса без подсказки и ручной сверки.',
      review: 'Сначала восстанови запрос по памяти, затем назови failure mode, который он исключает.',
      checkpoint: 'Соедини отдельные конструкции в воспроизводимое расследование с контрольными срезами.',
      interview: 'Объясни решение как на разборе эскалации: grain, допущения, риск ложного вывода.',
      puzzle: 'Перенеси навык на неполные, запаздывающие или противоречивые операционные данные.',
      assessment: 'Проверь, можешь ли ты независимо диагностировать SQL-задачу, а не только повторить знакомый шаблон.',
      project: 'Собери операционный артефакт, по которому смена сможет принять решение без ручного Excel.',
      complete: commonComplete
    }
  },
  analyst: {
    goal: 'analyst',
    title: 'SQL для аналитики',
    promise: 'От одной строки результата к объяснимым метрикам, временным рядам, окнам и витринам.',
    recommendedTrack: 'analytics',
    reviewModuleIds: [
      'aggregates', 'grouping', 'dates', 'cte', 'windows', 'conditional-aggregation',
      'window-frames', 'final'
    ],
    preferredTransferMode: 'puzzle',
    preferredProjectIds: [
      'project-executive-mart', 'project-incident-command', 'project-data-trust'
    ],
    stageFocus: {
      lesson: 'Фиксируй grain, период, denominator и бизнес-определение до написания метрики.',
      guided: 'Проверь, что пример сохраняет нужную гранулярность и не создаёт скрытое смещение.',
      practice: 'Собери метрику независимо и добавь стабильную сортировку или контрольную сверку.',
      review: 'Восстанови формулу по памяти и объясни, какие строки входят в числитель и знаменатель.',
      checkpoint: 'Соедини фильтры, группировки, даты и окна в одну объяснимую аналитическую модель.',
      interview: 'Защити определение метрики, допущения и способ проверки перед заказчиком.',
      puzzle: 'Перенеси модель на неоднозначный период, NULL, дубли или изменение гранулярности.',
      assessment: 'Проверь перенос аналитических моделей между несвязанными наборами данных.',
      project: 'Собери повторяемую витрину с определениями, validation queries и понятным планом выполнения.',
      complete: commonComplete
    }
  },
  backend: {
    goal: 'backend',
    title: 'Backend SQL',
    promise: 'От базового чтения данных к DML, схемам, транзакциям, индексам и безопасной эксплуатации.',
    recommendedTrack: 'performance',
    reviewModuleIds: [
      'schema', 'transactions', 'indexes', 'explain', 'dml', 'schema-evolution',
      'sql-security', 'concurrency'
    ],
    preferredTransferMode: 'interview',
    preferredProjectIds: [
      'project-data-trust', 'project-executive-mart', 'project-incident-command'
    ],
    stageFocus: {
      lesson: 'Отмечай инварианты, границы транзакции и последствия запроса для production-состояния.',
      guided: 'Проговори путь данных, возможную блокировку и способ безопасного отката.',
      practice: 'Напиши SQL независимо и докажи идемпотентность, целостность или план доступа.',
      review: 'Восстанови решение по памяти и назови production-риск неправильной реализации.',
      checkpoint: 'Соедини чтение, изменение, схему и транзакционный контроль в один безопасный контракт.',
      interview: 'Объясни trade-offs, индекс, isolation assumption и rollback как на backend design review.',
      puzzle: 'Перенеси решение на конкурентное изменение, частичный сбой или несовместимую схему.',
      assessment: 'Проверь, можешь ли ты принимать безопасные SQL-решения вне знакомого CRUD-шаблона.',
      project: 'Собери production-изменение с инвариантами, миграцией, validation и rollback evidence.',
      complete: commonComplete
    }
  },
  interview: {
    goal: 'interview',
    title: 'SQL-интервью',
    promise: 'От нулевого фундамента к самостоятельным задачам под временем и ясному объяснению решений.',
    recommendedTrack: 'interview',
    reviewModuleIds: [
      'filtering', 'grouping', 'joins', 'subqueries', 'cte', 'windows',
      'advanced-joins', 'recursive-cte'
    ],
    preferredTransferMode: 'interview',
    preferredProjectIds: [
      'project-executive-mart', 'project-data-trust', 'project-incident-command'
    ],
    stageFocus: {
      lesson: 'После mental model сформулируй вслух grain, ограничения и ожидаемую сложность решения.',
      guided: 'Используй scaffold, но объясни каждую конструкцию без ссылок на готовый шаблон.',
      practice: 'Реши без подсказки, затем коротко перескажи ход мысли и проверь edge case.',
      review: 'Воспроизведи решение по памяти в ограниченное время и исправь его без эталона.',
      checkpoint: 'Переключайся между темами без подсказки, сохраняя ясное объяснение и контроль результата.',
      interview: 'Сначала уточни контракт, затем напиши SQL и защити альтернативы, сложность и edge cases.',
      puzzle: 'Распознай знакомую модель под непривычной формулировкой и не перебирай синтаксис наугад.',
      assessment: 'Проверь устойчивость под смешанным набором, ограничением времени и отсутствием scaffold.',
      project: 'Защити длинное решение как system-style SQL case: требования, запрос, проверки и trade-offs.',
      complete: commonComplete
    }
  },
  full: {
    goal: 'full',
    title: 'Полная SQL Academy',
    promise: 'Последовательный путь от нулевых знаний до expert SQL, production operations и трёх capstone.',
    recommendedTrack: 'fundamentals',
    reviewModuleIds: [
      'sql-thinking', 'filtering', 'joins', 'cte', 'windows', 'transactions',
      'data-quality', 'explain', 'concurrency', 'incident-investigation'
    ],
    preferredTransferMode: 'interview',
    preferredProjectIds: [
      'project-incident-command', 'project-data-trust', 'project-executive-mart'
    ],
    stageFocus: {
      lesson: 'Связывай новую модель с предыдущей и отмечай, какой класс задач она теперь открывает.',
      guided: 'Закрепи последовательность рассуждения до самостоятельной практики.',
      practice: 'Подтверди навык без подсказок, эталона и скрытого обхода prerequisites.',
      review: 'Восстанови модель по памяти и сравни её с соседними конструкциями курса.',
      checkpoint: 'Соедини знания фазы в один рабочий навык перед следующим уровнем сложности.',
      interview: 'Объясни допущения и trade-offs так, чтобы решение можно было проверить и поддерживать.',
      puzzle: 'Перенеси навык на непривычный контракт, сохраняя инварианты и стабильный результат.',
      assessment: 'Проверь удержание и перенос навыков по всей академии.',
      project: 'Объедини модели нескольких фаз в законченный production-артефакт.',
      complete: commonComplete
    }
  }
};

export function learningRouteForGoal(
  goal: LearnerGoal | null | undefined,
  pace: StudyPace = 'steady',
  dailyMinutes: 15 | 25 | 40 = 25
): LearningRoutePolicy {
  const selected = goal && blueprints[goal] ? blueprints[goal] : blueprints.full;
  return { ...selected, pace, dailyMinutes };
}

export function learningRouteForProfile(profile: Pick<
  LearnerOnboardingProfile,
  'goal' | 'pace' | 'dailyMinutes'
>) {
  return learningRouteForGoal(profile.goal, profile.pace, profile.dailyMinutes);
}

export function routePriority(moduleId: string | null, policy: LearningRoutePolicy) {
  if (!moduleId) return Number.MAX_SAFE_INTEGER;
  const index = policy.reviewModuleIds.indexOf(moduleId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

export function prioritizeRouteReviews<T extends { module: string }>(
  queue: readonly T[],
  policy: LearningRoutePolicy | undefined,
  limit = 2,
  priorityWindow = 5
) {
  if (!policy) return queue.slice(0, limit);
  const shortlist = queue.slice(0, Math.max(limit, priorityWindow));
  return [...shortlist]
    .sort((left, right) =>
      routePriority(left.module, policy) - routePriority(right.module, policy)
      || shortlist.indexOf(left) - shortlist.indexOf(right)
    )
    .slice(0, limit);
}

export function routeFocus(stage: RouteStage, policy: LearningRoutePolicy) {
  return policy.stageFocus[stage];
}
