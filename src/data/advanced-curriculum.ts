import type { CurriculumCheckpoint, CurriculumLesson, GlossaryEntry, KnowledgeCheck } from './curriculum';
import { advancedGuides, advancedModules, advancedTasks, type AdvancedModuleId } from './advanced-syllabus';

const prerequisites: Record<AdvancedModuleId, string[]> = {
  dml: ['transactions'],
  'schema-evolution': ['schema', 'dml'],
  'null-logic-advanced': ['filtering', 'text'],
  'conditional-aggregation': ['grouping', 'null-logic-advanced'],
  'advanced-joins': ['joins', 'subqueries'],
  'recursive-cte': ['cte', 'advanced-joins'],
  'window-frames': ['windows', 'dates'],
  'json-sql': ['text', 'data-quality'],
  'sql-security': ['dml', 'schema-evolution'],
  concurrency: ['transactions', 'dml'],
  'pagination-patterns': ['sorting', 'indexes'],
  'incident-investigation': ['support', 'conditional-aggregation', 'window-frames']
};

const glossary: Record<AdvancedModuleId, GlossaryEntry[]> = {
  dml: [
    { term: 'Target set', definition: 'Точный набор строк, который должен быть изменён.' },
    { term: 'UPSERT', definition: 'INSERT с определённым поведением при конфликте уникального ключа.' }
  ],
  'schema-evolution': [
    { term: 'Compatibility view', definition: 'Представление, временно сохраняющее старый контракт чтения после изменения схемы.' },
    { term: 'Invariant', definition: 'Условие, которое должно оставаться истинным для всех допустимых данных.' }
  ],
  'null-logic-advanced': [
    { term: 'UNKNOWN', definition: 'Третье логическое состояние SQL, возникающее при сравнении с NULL.' },
    { term: 'Null-safe', definition: 'Выражение, поведение которого явно определено для NULL.' }
  ],
  'conditional-aggregation': [
    { term: 'Denominator', definition: 'Общий набор, относительно которого рассчитывается доля.' },
    { term: 'Conditional aggregate', definition: 'Агрегат, учитывающий строки через CASE или FILTER.' }
  ],
  'advanced-joins': [
    { term: 'Semi join', definition: 'Возвращает строки слева, для которых существует совпадение справа.' },
    { term: 'Relational division', definition: 'Запрос, находящий сущности, связанные со всеми элементами требуемого множества.' }
  ],
  'recursive-cte': [
    { term: 'Anchor member', definition: 'Начальный набор строк рекурсивного CTE.' },
    { term: 'Recursive member', definition: 'Шаг, который строит следующий уровень из уже найденных строк.' }
  ],
  'window-frames': [
    { term: 'Frame', definition: 'Подмножество строк окна, участвующее в вычислении для текущей строки.' },
    { term: 'Gaps and islands', definition: 'Класс задач поиска непрерывных последовательностей и разрывов.' }
  ],
  'json-sql': [
    { term: 'JSON path', definition: 'Выражение, указывающее положение значения внутри JSON-документа.' },
    { term: 'Semi-structured data', definition: 'Данные с частично гибкой структурой, сохранённой внутри значения.' }
  ],
  'sql-security': [
    { term: 'Bind parameter', definition: 'Значение, передаваемое отдельно от SQL-текста.' },
    { term: 'Least privilege', definition: 'Предоставление только минимально необходимых прав.' }
  ],
  concurrency: [
    { term: 'Lost update', definition: 'Параллельная запись, незаметно перезаписавшая более раннее изменение.' },
    { term: 'Idempotency', definition: 'Свойство операции давать тот же итог при безопасном повторе.' }
  ],
  'pagination-patterns': [
    { term: 'Keyset pagination', definition: 'Пагинация через значения последней строки полного ORDER BY.' },
    { term: 'Cursor', definition: 'Набор значений sort key, от которого продолжается следующая страница.' }
  ],
  'incident-investigation': [
    { term: 'Baseline', definition: 'Нормальный уровень метрики для сравнения с аномалией.' },
    { term: 'Evidence query', definition: 'Сохранённый воспроизводимый запрос, подтверждающий вывод расследования.' }
  ]
};

type CheckPair = [KnowledgeCheck, KnowledgeCheck];

const checks: Record<AdvancedModuleId, CheckPair> = {
  dml: [
    { id: 'check-dml-target', question: 'Что должно предшествовать UPDATE в production?', options: ['COMMIT', 'SELECT того же target set', 'DROP INDEX', 'VACUUM'], correctIndex: 1, explanation: 'Target SELECT показывает строки до изменения и позволяет сверить WHERE.' },
    { id: 'check-dml-upsert', question: 'Что определяет ветку UPSERT?', options: ['ORDER BY', 'Conflict key', 'HAVING', 'Window frame'], correctIndex: 1, explanation: 'Поведение ON CONFLICT связано с конкретным unique/primary key.' }
  ],
  'schema-evolution': [
    { id: 'check-schema-invariant', question: 'Где надёжнее хранить обязательный invariant?', options: ['В UI', 'В constraint схемы', 'В README', 'В ORDER BY'], correctIndex: 1, explanation: 'Constraint действует для всех клиентов и путей записи.' },
    { id: 'check-schema-view', question: 'Зачем compatibility view при миграции?', options: ['Для случайной сортировки', 'Чтобы временно сохранить старый read contract', 'Чтобы удалить PK', 'Чтобы отключить FK'], correctIndex: 1, explanation: 'View позволяет потребителям мигрировать постепенно.' }
  ],
  'null-logic-advanced': [
    { id: 'check-null-unknown', question: 'Результат `NULL = NULL` в SQL?', options: ['TRUE', 'FALSE', 'UNKNOWN', '0'], correctIndex: 2, explanation: 'Сравнение неизвестных значений возвращает UNKNOWN.' },
    { id: 'check-null-not-in', question: 'Почему NOT IN опасен при NULL в подзапросе?', options: ['Удаляет индекс', 'Условие может стать UNKNOWN для всех строк', 'Создаёт дубли', 'Запрещён стандартом'], correctIndex: 1, explanation: 'NULL внутри множества влияет на трёхзначную логику NOT IN.' }
  ],
  'conditional-aggregation': [
    { id: 'check-conditional-denominator', question: 'Что нужно зафиксировать перед расчётом процента?', options: ['Alias таблицы', 'Denominator', 'Имя индекса', 'OFFSET'], correctIndex: 1, explanation: 'Доля бессмысленна без точного общего набора.' },
    { id: 'check-conditional-division', question: 'Зачем использовать 100.0, а не 100?', options: ['Для индекса', 'Чтобы избежать integer division', 'Для NULL', 'Для JOIN'], correctIndex: 1, explanation: 'В ряде диалектов целочисленное деление теряет дробную часть.' }
  ],
  'advanced-joins': [
    { id: 'check-semi-exists', question: 'Как естественно выразить «есть хотя бы одна связь»?', options: ['EXISTS', 'OFFSET', 'UNION ALL', 'PRAGMA'], correctIndex: 0, explanation: 'EXISTS проверяет сам факт существования строки.' },
    { id: 'check-anti-null', question: 'Какой anti-join устойчив к NULL?', options: ['NOT IN', 'NOT EXISTS', 'CROSS JOIN', 'NATURAL JOIN'], correctIndex: 1, explanation: 'NOT EXISTS не ломается из-за NULL внутри подзапроса.' }
  ],
  'recursive-cte': [
    { id: 'check-recursive-anchor', question: 'Что задаёт первый уровень рекурсии?', options: ['Anchor member', 'HAVING', 'Frame', 'Trigger'], correctIndex: 0, explanation: 'Anchor member формирует начальные строки.' },
    { id: 'check-recursive-cycle', question: 'Что защищает обход от циклов?', options: ['SELECT *', 'Path/depth guard', 'OFFSET', 'DISTINCT alias'], correctIndex: 1, explanation: 'Нужен явный контроль пути или глубины.' }
  ],
  'window-frames': [
    { id: 'check-frame-rows', question: 'Что означает ROWS BETWEEN 2 PRECEDING AND CURRENT ROW?', options: ['Все строки partition', 'Текущая и две предыдущие физические строки', 'Два предыдущих дня', 'Только ties'], correctIndex: 1, explanation: 'ROWS задаёт физические позиции строк.' },
    { id: 'check-frame-order', question: 'Почему ORDER BY окна должен быть детерминированным?', options: ['Иначе frame может менять состав при ties', 'Иначе нет индекса', 'Иначе запрещён SUM', 'Иначе удаляются NULL'], correctIndex: 0, explanation: 'Неуникальный порядок делает соседство неоднозначным.' }
  ],
  'json-sql': [
    { id: 'check-json-valid', question: 'Что проверить до json_extract на внешних данных?', options: ['json_valid', 'COUNT(*)', 'VACUUM', 'COMMIT'], correctIndex: 0, explanation: 'Некорректный JSON должен быть выявлен до извлечения.' },
    { id: 'check-json-null', question: 'JSON null и SQL NULL — это всегда одно и то же?', options: ['Да', 'Нет', 'Только в PostgreSQL', 'Только в JOIN'], correctIndex: 1, explanation: 'Нужно различать отсутствующий key, JSON null и SQL NULL.' }
  ],
  'sql-security': [
    { id: 'check-security-bind', question: 'Главная защита значений от SQL injection?', options: ['Конкатенация', 'Bind parameters', 'DISTINCT', 'VIEW'], correctIndex: 1, explanation: 'Параметры отделяют структуру SQL от данных.' },
    { id: 'check-security-identifier', question: 'Как безопасно выбирать динамическое имя столбца?', options: ['Bind как value', 'Whitelist допустимых идентификаторов', 'Добавить кавычки вокруг ввода', 'Использовать LIKE'], correctIndex: 1, explanation: 'Идентификаторы обычно нельзя bind-ить как значения, поэтому нужен whitelist.' }
  ],
  concurrency: [
    { id: 'check-concurrency-lost', question: 'Какой pattern снижает риск lost update?', options: ['UPDATE без WHERE', 'Version check в WHERE', 'SELECT *', 'OFFSET'], correctIndex: 1, explanation: 'Optimistic version check обнаруживает изменение после чтения.' },
    { id: 'check-concurrency-retry', question: 'Когда автоматический retry безопаснее?', options: ['Операция идемпотентна', 'Есть SELECT *', 'Нет индекса', 'Всегда'], correctIndex: 0, explanation: 'Повтор не должен удваивать побочный эффект.' }
  ],
  'pagination-patterns': [
    { id: 'check-pagination-keyset', question: 'Что содержит keyset cursor?', options: ['Только номер страницы', 'Все значения полного sort key', 'COUNT(*)', 'SQL password'], correctIndex: 1, explanation: 'Cursor должен однозначно описывать позицию в ORDER BY.' },
    { id: 'check-pagination-strict', question: 'Почему следующий cursor predicate обычно строгий `>`?', options: ['Чтобы не повторить последнюю строку', 'Чтобы использовать OFFSET', 'Чтобы удалить NULL', 'Чтобы создать индекс'], correctIndex: 0, explanation: '>= повторит строку cursor на следующей странице.' }
  ],
  'incident-investigation': [
    { id: 'check-incident-baseline', question: 'С чего начинать расследование?', options: ['С UPDATE', 'С масштаба и baseline', 'С DROP TABLE', 'С поиска одного виновника'], correctIndex: 1, explanation: 'Сначала нужно доказать наличие и границы аномалии.' },
    { id: 'check-incident-evidence', question: 'Что делает вывод воспроизводимым?', options: ['Скриншот без SQL', 'Evidence query и зафиксированный период', 'SELECT * без фильтра', 'Устное описание'], correctIndex: 1, explanation: 'Другой инженер должен суметь повторить измерение.' }
  ]
};

function lessonSections(module: AdvancedModuleId, applied: boolean) {
  const guide = advancedGuides[module];
  return [
    {
      id: `${module}-${applied ? 'applied' : 'foundation'}-concept`,
      kind: 'concept' as const,
      title: applied ? 'Production-модель' : 'Фундаментальная модель',
      lead: guide.summary,
      paragraphs: [guide.mentalModel, applied
        ? 'Свяжи конструкцию с failure modes: что произойдёт при NULL, дублях, параллельной записи и изменении объёма данных.'
        : 'Сначала объясни поведение словами и только после этого выбирай синтаксис.'],
      bullets: applied ? guide.commonMistakes : guide.checklist
    },
    {
      id: `${module}-${applied ? 'applied' : 'foundation'}-workflow`,
      kind: 'workflow' as const,
      title: applied ? 'Проверка в рабочем сценарии' : 'Пошаговый алгоритм',
      lead: applied ? 'Собери контрольный набор и сравни поведение до и после изменения.' : 'Двигайся короткими проверяемыми шагами.',
      paragraphs: [applied
        ? 'Используй минимальный воспроизводимый набор, стабильный ORDER BY и отдельный запрос для проверки результата.'
        : 'Зафиксируй входные данные, ожидаемую гранулярность, оператор и контрольный результат.'],
      bullets: guide.checklist
    },
    {
      id: `${module}-${applied ? 'applied' : 'foundation'}-diagnostics`,
      kind: 'pitfalls' as const,
      title: 'Диагностика ошибок',
      lead: 'Отделяй syntax error, runtime error, logical mismatch и performance problem.',
      paragraphs: ['Запрос может выполняться без ошибки и всё равно быть неверным. Проверяй число строк, ключи, NULL, порядок и побочные эффекты.'],
      bullets: guide.commonMistakes
    }
  ];
}

export const advancedCurriculumLessons: CurriculumLesson[] = advancedModules.flatMap(([module, title, subtitle], moduleIndex) => {
  const moduleTasks = advancedTasks.filter(task => task.module === module);
  const [foundationCheck, appliedCheck] = checks[module];
  const basePrerequisites = prerequisites[module] as CurriculumLesson['prerequisites'];
  const foundationId = `lesson-${module}-foundation`;
  return [
    {
      id: foundationId,
      module,
      title: `${title}: основа`,
      subtitle,
      minutes: 18 + (moduleIndex % 3) * 4,
      prerequisites: basePrerequisites,
      objectives: advancedGuides[module].checklist.slice(0, 3),
      sections: lessonSections(module, false),
      glossary: glossary[module],
      example: {
        id: `example-${module}-foundation`,
        title: `Runnable example · ${title}`,
        description: moduleTasks[0].description,
        sql: moduleTasks[0].solution
      },
      check: foundationCheck,
      practiceTaskIds: moduleTasks.slice(0, 5).map(task => task.id)
    },
    {
      id: `lesson-${module}-applied`,
      module,
      title: `${title}: production patterns`,
      subtitle: `Failure modes, диагностика и применение · ${subtitle}`,
      minutes: 22 + (moduleIndex % 4) * 4,
      prerequisites: basePrerequisites,
      objectives: [
        `Применять ${title.toLowerCase()} в рабочем сценарии`,
        'Диагностировать логически корректный, но неверный результат',
        'Объяснять trade-offs и ограничения выбранного pattern'
      ],
      sections: lessonSections(module, true),
      glossary: glossary[module],
      example: {
        id: `example-${module}-applied`,
        title: `Applied example · ${title}`,
        description: moduleTasks[5].description,
        sql: moduleTasks[5].solution
      },
      check: appliedCheck,
      practiceTaskIds: moduleTasks.slice(5, 10).map(task => task.id)
    }
  ];
});

export const advancedCurriculumCheckpoints: CurriculumCheckpoint[] = [
  {
    id: 'checkpoint-data-change',
    title: 'Checkpoint · Изменения и целостность',
    description: 'DML, schema evolution и продвинутая NULL-логика.',
    moduleIds: ['dml', 'schema-evolution', 'null-logic-advanced'],
    taskIds: ['task-122', 'task-135', 'task-148', 'task-129', 'task-140'],
    passingScore: 80,
    criteria: ['Target set доказан', 'Изменение обратимо', 'Constraint соответствует invariant', 'NULL имеет явный смысл']
  },
  {
    id: 'checkpoint-advanced-querying',
    title: 'Checkpoint · Advanced querying',
    description: 'Условные метрики, existence patterns и рекурсивные иерархии.',
    moduleIds: ['conditional-aggregation', 'advanced-joins', 'recursive-cte'],
    taskIds: ['task-152', 'task-166', 'task-174', 'task-159', 'task-180'],
    passingScore: 82,
    criteria: ['Denominator зафиксирован', 'JOIN не размножает строки', 'NOT EXISTS null-safe', 'Рекурсия имеет guard']
  },
  {
    id: 'checkpoint-modern-sql',
    title: 'Checkpoint · Modern SQL',
    description: 'Window frames, JSON и security reasoning.',
    moduleIds: ['window-frames', 'json-sql', 'sql-security'],
    taskIds: ['task-182', 'task-196', 'task-204', 'task-189', 'task-210'],
    passingScore: 84,
    criteria: ['Frame указан явно', 'JSON type проверен', 'Пользовательский ввод не становится SQL-кодом', 'Порядок детерминирован']
  },
  {
    id: 'checkpoint-production-operations',
    title: 'Checkpoint · Production operations',
    description: 'Concurrency, keyset pagination и incident investigation.',
    moduleIds: ['concurrency', 'pagination-patterns', 'incident-investigation'],
    taskIds: ['task-212', 'task-226', 'task-234', 'task-219', 'task-240'],
    passingScore: 85,
    criteria: ['Retry безопасен', 'Cursor полный и строгий', 'Baseline доказан', 'Evidence query воспроизводим']
  }
];
