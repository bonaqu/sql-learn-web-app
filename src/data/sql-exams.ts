export type SqlTrackId = 'fundamentals' | 'support' | 'analytics' | 'performance' | 'interview';
export type SqlExamId = 'diagnostic' | 'production' | 'final';

export interface SqlTrack {
  id: SqlTrackId;
  title: string;
  purpose: string;
  estimatedHours: number;
  moduleIds: string[];
  outcomes: string[];
}

export interface SqlExam {
  id: SqlExamId;
  title: string;
  description: string;
  durationMinutes: number;
  passingScore: number;
  taskIds: string[];
  requiredModuleIds: string[];
  rules: string[];
  readinessWeight: number;
}

export const sqlTracks: SqlTrack[] = [
  {
    id: 'fundamentals',
    title: 'SQL Fundamentals',
    purpose: 'С нуля до уверенного построения корректных однострочных и агрегированных запросов.',
    estimatedHours: 18,
    moduleIds: ['sql-thinking', 'select', 'filtering', 'sorting', 'aggregates', 'grouping', 'joins', 'subqueries', 'cte', 'dates', 'text', 'set-ops', 'null-logic-advanced'],
    outcomes: ['Читать схему', 'Формулировать контракт результата', 'Писать SELECT/JOIN/GROUP BY', 'Корректно обрабатывать NULL', 'Разбивать запрос на CTE']
  },
  {
    id: 'support',
    title: 'Support SQL',
    purpose: 'Диагностика обращений, SLA, backlog, data quality и безопасные изменения.',
    estimatedHours: 15,
    moduleIds: ['support', 'data-quality', 'dml', 'schema-evolution', 'sql-security', 'concurrency', 'incident-investigation'],
    outcomes: ['Считать SLA и backlog', 'Находить аномалии', 'Безопасно менять данные', 'Сохранять evidence queries', 'Понимать transaction risk']
  },
  {
    id: 'analytics',
    title: 'Analytics SQL',
    purpose: 'От условных метрик до окон, JSON и многоэтапных аналитических витрин.',
    estimatedHours: 19,
    moduleIds: ['conditional-aggregation', 'advanced-joins', 'recursive-cte', 'windows', 'window-frames', 'json-sql', 'final'],
    outcomes: ['Строить доли и cohorts', 'Использовать semi/anti joins', 'Обходить иерархии', 'Применять moving windows', 'Собирать аналитические витрины']
  },
  {
    id: 'performance',
    title: 'Performance SQL',
    purpose: 'Индексы, планы, pagination и reasoning о стоимости запроса.',
    estimatedHours: 10,
    moduleIds: ['indexes', 'explain', 'pagination-patterns', 'schema-evolution'],
    outcomes: ['Читать SCAN/SEARCH', 'Подбирать составной индекс', 'Избегать deep OFFSET', 'Проверять оптимизацию измерением', 'Учитывать write cost']
  },
  {
    id: 'interview',
    title: 'Interview & Production Readiness',
    purpose: 'Смешанные задачи без подсказок, объяснение решений и расследование незнакомой схемы.',
    estimatedHours: 12,
    moduleIds: ['sql-thinking', 'advanced-joins', 'window-frames', 'transactions', 'concurrency', 'incident-investigation', 'final'],
    outcomes: ['Объяснять trade-offs', 'Решать задачи с нуля', 'Диагностировать неверный результат', 'Защищать решение на интервью', 'Работать с неизвестной схемой']
  }
];

export const sqlExams: SqlExam[] = [
  {
    id: 'diagnostic',
    title: 'Diagnostic SQL Check',
    description: 'Короткая входная диагностика. Не блокирует курс: результат определяет стартовую точку и темы для повторения.',
    durationMinutes: 35,
    passingScore: 60,
    taskIds: ['task-002', 'task-014', 'task-026', 'task-034', 'task-040', 'task-046', 'task-058', 'task-070', 'task-082', 'task-094', 'task-142', 'task-152'],
    requiredModuleIds: [],
    rules: ['Без AI Mentor', 'Без готовых решений', 'Можно пропустить вопрос', 'Одна попытка не влияет на XP'],
    readinessWeight: 10
  },
  {
    id: 'production',
    title: 'Production SQL Exam',
    description: 'Проверка надёжного SQL: изменения, качество данных, планы, транзакции и операционные метрики.',
    durationMinutes: 70,
    passingScore: 78,
    taskIds: ['task-080', 'task-087', 'task-093', 'task-099', 'task-105', 'task-111', 'task-117', 'task-124', 'task-132', 'task-148', 'task-155', 'task-166', 'task-184', 'task-196', 'task-205', 'task-214', 'task-226', 'task-234'],
    requiredModuleIds: ['data-quality', 'indexes', 'explain', 'transactions', 'schema', 'support', 'dml', 'sql-security', 'concurrency'],
    rules: ['Без подсказок и AI', 'SQL выполняется на чистом seed', 'Результат и порядок должны совпасть', 'После сдачи доступен разбор по компетенциям'],
    readinessWeight: 30
  },
  {
    id: 'final',
    title: 'SQL Academy Final',
    description: 'Финальная смешанная проверка от fundamentals до advanced production patterns и incident investigation.',
    durationMinutes: 110,
    passingScore: 82,
    taskIds: ['task-005', 'task-017', 'task-029', 'task-035', 'task-041', 'task-047', 'task-053', 'task-059', 'task-065', 'task-071', 'task-077', 'task-083', 'task-089', 'task-095', 'task-101', 'task-107', 'task-113', 'task-119', 'task-128', 'task-139', 'task-150', 'task-160', 'task-170', 'task-180', 'task-190', 'task-200', 'task-210', 'task-220', 'task-230', 'task-240'],
    requiredModuleIds: ['final', 'dml', 'schema-evolution', 'conditional-aggregation', 'advanced-joins', 'recursive-cte', 'window-frames', 'json-sql', 'sql-security', 'concurrency', 'pagination-patterns', 'incident-investigation'],
    rules: ['Без подсказок, AI и solution unlock', 'Можно отмечать вопросы для возврата', 'Сессия resumable до истечения таймера', 'Сертификат готовности выдаётся только вместе с capstone'],
    readinessWeight: 60
  }
];

export const syllabusCompetencies = [
  { id: 'result-contract', title: 'Контракт результата', modules: ['sql-thinking', 'select', 'sorting'], track: 'fundamentals' as const },
  { id: 'row-selection', title: 'Фильтрация и NULL', modules: ['filtering', 'null-logic-advanced'], track: 'fundamentals' as const },
  { id: 'aggregation', title: 'Агрегации и условные метрики', modules: ['aggregates', 'grouping', 'conditional-aggregation'], track: 'analytics' as const },
  { id: 'relationships', title: 'Связи и existence patterns', modules: ['joins', 'subqueries', 'advanced-joins'], track: 'fundamentals' as const },
  { id: 'query-structure', title: 'CTE, рекурсия и множества', modules: ['cte', 'recursive-cte', 'set-ops'], track: 'analytics' as const },
  { id: 'time-series', title: 'Даты и оконные вычисления', modules: ['dates', 'windows', 'window-frames'], track: 'analytics' as const },
  { id: 'data-shaping', title: 'Текст, JSON и качество данных', modules: ['text', 'json-sql', 'data-quality'], track: 'support' as const },
  { id: 'safe-write', title: 'DML, schema и транзакции', modules: ['dml', 'schema', 'schema-evolution', 'transactions', 'concurrency'], track: 'support' as const },
  { id: 'performance', title: 'Индексы, EXPLAIN и pagination', modules: ['indexes', 'explain', 'pagination-patterns'], track: 'performance' as const },
  { id: 'security', title: 'Параметризация и права', modules: ['sql-security'], track: 'support' as const },
  { id: 'operations', title: 'Support analytics и расследование', modules: ['support', 'incident-investigation', 'final'], track: 'support' as const }
];
