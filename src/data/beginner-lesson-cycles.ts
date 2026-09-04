import type { SqlTask } from './course';

export type BeginnerCycleModule = 'sql-thinking' | 'filtering' | 'select';

export interface BeginnerVisualization {
  id: string;
  title: string;
  caption: string;
  columns: string[];
  rows: Array<{ values: string[]; state: 'keep' | 'drop' | 'notice'; stateLabel: string }>;
  note: string;
}

export interface BeginnerLessonCycle {
  module: string;
  objective: string;
  successCriterion: string;
  prediction: {
    prompt: string;
    options: string[];
    correctIndex: number;
    correctFeedback: string;
    incorrectFeedback: string;
  };
  workedExample: {
    title: string;
    context: string;
    sql: string;
    observation: string;
  };
  fadedPractice: {
    title: string;
    prompt: string;
    starterSql: string;
    evaluationTaskId: string;
    successFeedback: string;
    retryFeedback: string;
  };
  visualizations: BeginnerVisualization[];
  supportedTaskId: string;
  independentTaskId: string;
  independentContext: string;
  misconception: {
    title: string;
    mismatch: string;
    counterexample: string;
    revisitSectionId: string;
  };
  delayedReview: string;
  coveredTaskIds: string[];
}

export const beginnerLessonCycles: Record<BeginnerCycleModule, BeginnerLessonCycle> = {
  'sql-thinking': {
    module: 'sql-thinking',
    objective: 'До запуска назвать, что означает одна строка результата, и выбрать только нужные столбцы.',
    successCriterion: 'Запрос возвращает ticket_id и service: одна строка — одно обращение, без случайного удаления повторяющихся сервисов.',
    prediction: {
      prompt: 'В tickets есть 14 обращений. Сколько строк вернёт SELECT service FROM tickets без WHERE и DISTINCT?',
      options: ['5 — по одной строке на сервис', '14 — по одной строке на обращение', 'Зависит от порядка строк'],
      correctIndex: 1,
      correctFeedback: 'Верно: SELECT выбирает столбцы, но сам по себе не объединяет одинаковые значения.',
      incorrectFeedback: 'Проверь единицу строки: источник tickets содержит обращения, поэтому повторяющиеся названия сервисов сохраняются.'
    },
    workedExample: {
      title: 'Собираем контракт результата',
      context: 'Диспетчеру нужны номер обращения и сервис. Запрос можно изменить перед запуском.',
      sql: 'SELECT ticket_id, service\nFROM tickets\nORDER BY ticket_id;',
      observation: 'В результате 14 строк и два явно названных столбца. ORDER BY делает показ стабильным, но не меняет набор строк.'
    },
    fadedPractice: {
      title: 'Дополни запрос с меньшей подсказкой',
      prompt: 'Покажи номер и время решения каждого обращения. Не подменяй неизвестное время и не теряй строки.',
      starterSql: 'SELECT ticket_id, ___\nFROM tickets\nORDER BY ticket_id;',
      evaluationTaskId: 'task-004',
      successFeedback: 'Готово: результат сохранил все обращения, а неизвестное время осталось NULL.',
      retryFeedback: 'Верни ticket_id и resolution_minutes для каждого обращения; NULL должен остаться NULL.'
    },
    visualizations: [
      {
        id: 'thinking-duplicates', title: 'Повторы — не обязательно дубли',
        caption: 'Три обращения и значения service', columns: ['ticket_id', 'service'],
        rows: [
          { values: ['1001', 'VPN'], state: 'keep', stateLabel: 'Оставить: отдельное обращение' },
          { values: ['1003', 'VPN'], state: 'keep', stateLabel: 'Оставить: тот же сервис, другое обращение' },
          { values: ['1004', 'VDI'], state: 'keep', stateLabel: 'Оставить: отдельное обращение' }
        ],
        note: 'Одинаковый service не делает строки одинаковыми: ticket_id различается.'
      },
      {
        id: 'thinking-order', title: 'Набор строк и порядок — разные решения',
        caption: 'Те же строки после явной сортировки', columns: ['позиция', 'ticket_id'],
        rows: [
          { values: ['1', '1001'], state: 'notice', stateLabel: 'Первый по ORDER BY ticket_id' },
          { values: ['2', '1003'], state: 'notice', stateLabel: 'Второй по ORDER BY ticket_id' }
        ],
        note: 'Без ORDER BY база не обещает тот же порядок при следующем запуске.'
      }
    ],
    supportedTaskId: 'task-001', independentTaskId: 'task-006',
    independentContext: 'В новой задаче нужно объяснить гранулярность отчёта по приоритетам. Решение и обязательные подсказки не показываются.',
    misconception: {
      title: '«Одинаковый сервис означает дубликат»',
      mismatch: 'Это не совпадает с данными: обращения 1001 и 1003 относятся к VPN, но являются разными событиями.',
      counterexample: 'Сравни SELECT service и SELECT ticket_id, service. Во втором запросе видно, почему строки нельзя схлопывать.',
      revisitSectionId: 'sql-thinking-concept'
    },
    delayedReview: 'Позже, без подсказки, сформулируй одной фразой: что означает строка результата и почему ORDER BY не удаляет строки.',
    coveredTaskIds: ['task-001', 'task-002', 'task-003', 'task-004', 'task-005', 'task-006']
  },
  filtering: {
    module: 'filtering',
    objective: 'До запуска определить, какие строки пройдут WHERE, включая NULL и сочетание AND/OR.',
    successCriterion: 'Запрос оставляет только нужные обращения; NULL проверяется через IS NULL или IS NOT NULL, а смешанные условия сгруппированы скобками.',
    prediction: {
      prompt: "Пройдёт ли открытое обращение с resolution_minutes = NULL через WHERE resolution_minutes <> 0?",
      options: ['Да, NULL не равен нулю', 'Нет: сравнение даёт неизвестный результат', 'Только если status = Open'],
      correctIndex: 1,
      correctFeedback: 'Верно: WHERE оставляет только TRUE. Сравнение с NULL даёт неизвестный результат, поэтому строка отбрасывается.',
      incorrectFeedback: 'NULL — не число и не пустая строка. Для него нужна отдельная проверка IS NULL или IS NOT NULL.'
    },
    workedExample: {
      title: 'Отбираем строки по двум условиям',
      context: 'Нужны только закрытые Critical-обращения. Измени условие и сравни результат.',
      sql: "SELECT ticket_id, status, priority\nFROM tickets\nWHERE status = 'Closed' AND priority = 'Critical'\nORDER BY ticket_id;",
      observation: 'Сначала каждое условие даёт TRUE, FALSE или неизвестный результат. AND оставляет строку только когда оба условия истинны.'
    },
    fadedPractice: {
      title: 'Дополни проверку NULL',
      prompt: 'Покажи обращения, у которых время решения ещё не заполнено.',
      starterSql: 'SELECT ticket_id, resolution_minutes\nFROM tickets\nWHERE ___\nORDER BY ticket_id;',
      evaluationTaskId: 'task-016',
      successFeedback: 'Готово: IS NULL явно выбирает строки без значения; обычное сравнение с NULL этого не сделает.',
      retryFeedback: 'Заполни пропуск условием resolution_minutes IS NULL и не добавляй лишний фильтр.'
    },
    visualizations: [
      {
        id: 'filter-row-selection', title: 'WHERE проверяет строки по одной',
        caption: 'Отбор Closed AND Critical', columns: ['ticket_id', 'status', 'priority'],
        rows: [
          { values: ['1004', 'Closed', 'Critical'], state: 'keep', stateLabel: 'Оставить: оба условия истинны' },
          { values: ['1006', 'Closed', 'Critical'], state: 'keep', stateLabel: 'Оставить: оба условия истинны' },
          { values: ['1010', 'Open', 'Critical'], state: 'drop', stateLabel: 'Исключить: status не Closed' }
        ],
        note: 'Цвет не единственный сигнал: решение для каждой строки подписано текстом.'
      },
      {
        id: 'filter-null', title: 'NULL создаёт третий результат',
        caption: 'Проверка resolution_minutes <> 0', columns: ['значение', 'результат условия', 'действие WHERE'],
        rows: [
          { values: ['85', 'TRUE', 'оставить'], state: 'keep', stateLabel: 'Условие истинно' },
          { values: ['0', 'FALSE', 'исключить'], state: 'drop', stateLabel: 'Условие ложно' },
          { values: ['NULL', 'UNKNOWN', 'исключить'], state: 'notice', stateLabel: 'Неизвестный результат' }
        ],
        note: 'WHERE пропускает только TRUE. Для NULL используй IS NULL или IS NOT NULL.'
      }
    ],
    supportedTaskId: 'task-013', independentTaskId: 'task-018',
    independentContext: 'В самостоятельной задаче нужно самостоятельно сгруппировать AND и OR для новой пары сервисов; готового выражения рядом нет.',
    misconception: {
      title: '«NULL можно сравнить через = или <>»',
      mismatch: 'Проверка NULL = NULL не возвращает TRUE. Поэтому строка не проходит WHERE.',
      counterexample: 'Запусти SELECT NULL = NULL, NULL IS NULL: первая колонка даст NULL, вторая — 1.',
      revisitSectionId: 'filtering-pitfalls'
    },
    delayedReview: 'Позже объясни по памяти, почему WHERE оставляет TRUE, но отбрасывает FALSE и неизвестный результат.',
    coveredTaskIds: ['task-013', 'task-014', 'task-015', 'task-016', 'task-017', 'task-018']
  },
  select: {
    module: 'select',
    objective: 'Собрать выходные столбцы, вычисление и понятный псевдоним без SELECT *.',
    successCriterion: 'Результат содержит только нужные поля, вычисление delta_minutes и не теряет строки из-за необоснованного DISTINCT.',
    prediction: {
      prompt: 'Что изменится, если добавить resolution_minutes - sla_minutes AS delta_minutes в SELECT?',
      options: ['Появится вычисляемый столбец, число строк не изменится', 'Строки автоматически отсортируются', 'Останутся только нарушения SLA'],
      correctIndex: 0,
      correctFeedback: 'Верно: выражение меняет столбцы результата, а не набор или порядок строк.',
      incorrectFeedback: 'SELECT отвечает за форму строки. Отбор делает WHERE, порядок — ORDER BY.'
    },
    workedExample: {
      title: 'Добавляем вычисление и имя',
      context: 'Аналитику нужна разница между фактическим временем и SLA для закрытых обращений.',
      sql: "SELECT ticket_id,\n       resolution_minutes - sla_minutes AS delta_minutes\nFROM tickets\nWHERE resolution_minutes IS NOT NULL\nORDER BY ticket_id;",
      observation: 'AS задаёт понятное имя вычислению. Положительное delta_minutes означает превышение SLA, отрицательное — запас.'
    },
    fadedPractice: {
      title: 'Назови вычисляемый столбец',
      prompt: 'Дополни выражение, чтобы получить двойное окно SLA под именем double_sla_minutes.',
      starterSql: 'SELECT ticket_id,\n       sla_minutes * 2 AS ___\nFROM tickets\nORDER BY ticket_id;',
      evaluationTaskId: 'task-010',
      successFeedback: 'Готово: вычисление получило устойчивое имя, а количество обращений не изменилось.',
      retryFeedback: 'После AS укажи double_sla_minutes и сохрани вычисление sla_minutes * 2.'
    },
    visualizations: [
      {
        id: 'select-before-after', title: 'SELECT меняет форму строки',
        caption: 'До и после вычисления', columns: ['ticket_id', 'resolution', 'sla', 'delta_minutes'],
        rows: [
          { values: ['1001', '85', '120', '−35'], state: 'notice', stateLabel: 'Вычисление добавлено' },
          { values: ['1004', '510', '60', '450'], state: 'notice', stateLabel: 'Вычисление добавлено' }
        ],
        note: 'Число строк не меняется: к каждой выбранной строке добавляется вычисленное значение.'
      }
    ],
    supportedTaskId: 'task-007', independentTaskId: 'task-012',
    independentContext: 'В самостоятельной задаче нужно рассчитать долю использованного SLA в новом контексте; эталон и обязательная подсказка не раскрываются.',
    misconception: {
      title: '«DISTINCT безопасно чинит любой повтор»',
      mismatch: 'DISTINCT сравнивает всю выбранную строку и может скрыть проблему модели вместо исправления источника.',
      counterexample: 'Сравни SELECT service и SELECT DISTINCT service: второй запрос отвечает на другой вопрос — список уникальных сервисов.',
      revisitSectionId: 'select-concept'
    },
    delayedReview: 'Позже по памяти напиши выражение с AS и объясни, почему оно меняет столбцы, но не фильтрует строки.',
    coveredTaskIds: ['task-007', 'task-008', 'task-009', 'task-010', 'task-011', 'task-012']
  }
};

type LessonCycleSource = {
  id: string;
  module: string;
  title: string;
  objectives: string[];
  sections: Array<{ id: string; kind: string }>;
  example: { title: string; description: string; sql: string };
  check: { question: string; options: string[]; correctIndex: number; explanation: string };
  practiceTaskIds: string[];
};

const authoredFadedFragments: Readonly<Record<string, string>> = {
  'lesson-sorting': 'ORDER BY service ASC, ticket_id ASC',
  'lesson-aggregates': 'COUNT(resolution_minutes) AS observed_count',
  'lesson-grouping': 'GROUP BY service, status',
  'lesson-joins': 'ON parent.service_id = child.parent_id',
  'lesson-subqueries': 'HAVING COUNT(t.ticket_id) > (SELECT 1.0 * COUNT(*) / (SELECT COUNT(*) FROM engineers) FROM tickets)',
  'lesson-cte': 'JOIN counts USING(ticket_id)',
  'lesson-windows': 'SUM(sla_minutes) OVER (ORDER BY ticket_id)',
  'lesson-dates': 'GROUP BY date(closed_at), service',
  'lesson-text': 'upper(substr(subject, 1, 12))',
  'lesson-set-ops': 'EXCEPT SELECT customer_id FROM tickets WHERE customer_id IS NOT NULL',
  'lesson-data-quality': "CASE WHEN resolution_minutes < 0 OR (status = 'Open' AND resolution_minutes IS NOT NULL) THEN 1 ELSE 0 END",
  'lesson-indexes': "WHERE service = 'Email'",
  'lesson-explain': 'WHERE NOT EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.customer_id)',
  'lesson-transactions': "WHERE status = 'Open' AND priority = 'High'",
  'lesson-schema': 'CHECK(severity BETWEEN 1 AND 3)',
  'lesson-support': "SUM(CASE WHEN t.status = 'Closed' AND t.resolution_minutes > t.sla_minutes THEN 1 ELSE 0 END)",
  'lesson-final': 'COUNT(DISTINCT CASE WHEN c.email IS NULL OR c.phone IS NULL THEN c.customer_id END)',
  'lesson-incident-investigation-foundation': 'SUM(service IS NULL) null_service_rows',
  'lesson-incident-investigation-applied': "SUM(CASE result WHEN 'supports' THEN weight WHEN 'contradicts' THEN -weight ELSE 0 END) evidence_score"
};

function markAuthoredGaps(starter: string) {
  return starter
    .replace(/\bWHERE[ \t]*;/gi, 'WHERE ___;')
    .replace(/\bWHERE[ \t]*\r?\n(?=\s*(?:\)|UNION|GROUP BY|ORDER BY|$))/gi, 'WHERE ___\n')
    .replace(/\bORDER BY[ \t]*;/gi, 'ORDER BY ___;')
    .replace(/\bORDER BY[ \t]*\r?\n(?=\s*(?:\)|FROM|LIMIT|SELECT|$))/gi, 'ORDER BY ___\n')
    .replace(/\bPARTITION BY[ \t]*\r?\n(?=\s*(?:ORDER BY|ROWS|$))/gi, 'PARTITION BY ___\n')
    .replace(/\bON[ \t]*\r?\n(?=\s*(?:\)|LEFT|JOIN|WHERE|GROUP BY|ORDER BY|$))/gi, 'ON ___\n')
    .replace(/\bSELECT[ \t]*\r?\n(?=\s*FROM\b)/gi, 'SELECT ___\n')
    .replace(/\bEXISTS\s*\(\s*\)/gi, 'EXISTS (___)')
    .replace(/\(\s+\)/g, '(___)')
    .replace(/=\s*;(?=\s*(?:\r?\n|$))/g, '= ___;')
    .replace(/=\s*\r?\n(?=\s*WHERE\b)/gi, '= ___\n')
    .replace(/\bWHEN\s+(?=THEN\b)/gi, 'WHEN ___ ')
    .replace(/\bWHERE\s+(?=>)/gi, 'WHERE ___ ')
    .replace(/,(\s+)(?=AS\b)/gi, ', $1___ ');
}

function fadedStarterSql(lesson: LessonCycleSource, task: SqlTask) {
  const markedStarter = markAuthoredGaps(task.starter);
  if (markedStarter.includes('___')) return markedStarter;
  const fragment = authoredFadedFragments[lesson.id];
  if (!fragment || !task.solution.includes(fragment)) {
    throw new Error(`${lesson.id}: authored faded fragment is missing from ${task.id}`);
  }
  return task.solution.split(fragment).join('___');
}

function generatedLessonCycle(lesson: LessonCycleSource, catalogTasks: SqlTask[]): BeginnerLessonCycle {
  const block = lesson.practiceTaskIds.map(taskId => catalogTasks.find(task => task.id === taskId));
  if (block.some(task => !task)) throw new Error(`${lesson.id}: practice task block is incomplete`);
  const lessonTasks = block as SqlTask[];
  const supportedTask = lessonTasks[0];
  const fadedTask = lessonTasks[lessonTasks.length === 6 ? 3 : 2];
  const independentTask = lessonTasks.at(-1)!;
  const expectedGrain = fadedTask.learningContract?.expectedGrain
    || `результат соответствует условию задачи «${fadedTask.title}»`;
  const stateRule = fadedTask.learningContract?.stateRules[0]
    || 'каждая строка и каждое изменение объясняются условием задачи';
  const counterexample = fadedTask.learningContract?.adversarialCases[0]
    || `Измени один граничный случай из условия «${fadedTask.title}» и сравни результат до и после.`;
  const pitfallsSection = lesson.sections.find(section => section.kind === 'pitfalls') || lesson.sections.at(-1)!;

  return {
    module: lesson.module,
    objective: `${lesson.objectives[0]}. До запуска назови ожидаемый результат, затем сверь прогноз с данными.`,
    successCriterion: `Запрос решает задачу «${fadedTask.title}» и сохраняет правило: ${stateRule}.`,
    prediction: {
      prompt: lesson.check.question,
      options: lesson.check.options,
      correctIndex: lesson.check.correctIndex,
      correctFeedback: lesson.check.explanation,
      incorrectFeedback: `Сверь ответ с правилом урока: ${lesson.check.explanation}`
    },
    workedExample: {
      title: lesson.example.title,
      context: lesson.example.description,
      sql: lesson.example.sql,
      observation: `После запуска сверь число строк, имена столбцов и ожидаемую гранулярность: ${expectedGrain}.`
    },
    fadedPractice: {
      title: `Дополни: ${fadedTask.title}`,
      prompt: fadedTask.description,
      starterSql: fadedStarterSql(lesson, fadedTask),
      evaluationTaskId: fadedTask.id,
      successFeedback: `Готово: результат соответствует задаче «${fadedTask.title}» и её граничным случаям.`,
      retryFeedback: `Сверь гранулярность, NULL, границы и порядок с условием задачи «${fadedTask.title}».`
    },
    visualizations: [{
      id: `${lesson.id}-contract`,
      title: 'Контракт перед запуском',
      caption: `Что проверить в задаче «${fadedTask.title}»`,
      columns: ['Проверка', 'Ожидаемое наблюдение'],
      rows: [
        { values: ['Гранулярность', expectedGrain], state: 'notice', stateLabel: 'Сверить форму результата' },
        { values: ['Граничное правило', stateRule], state: 'notice', stateLabel: 'Проверить на данных' }
      ],
      note: counterexample
    }],
    supportedTaskId: supportedTask.id,
    independentTaskId: independentTask.id,
    independentContext: `Новая ситуация без готового выражения: ${independentTask.description}`,
    misconception: {
      title: `Типичная ошибка в теме «${lesson.title}»`,
      mismatch: `Если игнорировать гранулярность или граничное правило, результат расходится с условием задачи «${fadedTask.title}».`,
      counterexample,
      revisitSectionId: pitfallsSection.id
    },
    delayedReview: `После перерыва реши без подсказки задачу «${independentTask.title}» и словами объясни одну строку результата.`,
    coveredTaskIds: [...lesson.practiceTaskIds]
  };
}

export function beginnerLessonCycle(lesson: LessonCycleSource, catalogTasks: SqlTask[]) {
  const custom = beginnerLessonCycles[lesson.module as BeginnerCycleModule];
  if (custom && custom.coveredTaskIds.every(taskId => lesson.practiceTaskIds.includes(taskId))) return custom;
  return generatedLessonCycle(lesson, catalogTasks);
}
