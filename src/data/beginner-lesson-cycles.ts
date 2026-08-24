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
  module: BeginnerCycleModule;
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
    supportedTaskId: 'task-001', independentTaskId: 'task-002',
    independentContext: 'В новой задаче меняются сервис и набор полей. Решение и обязательные подсказки не показываются.',
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
    supportedTaskId: 'task-013', independentTaskId: 'task-015',
    independentContext: 'В самостоятельной задаче меняются столбцы и появляется новое условие OR по сервисам; готового выражения рядом нет.',
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
    supportedTaskId: 'task-007', independentTaskId: 'task-008',
    independentContext: 'В самостоятельной задаче меняется требуемое вычисление; эталон и обязательная подсказка не раскрываются.',
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

export function beginnerLessonCycle(moduleId: string) {
  return beginnerLessonCycles[moduleId as BeginnerCycleModule];
}
