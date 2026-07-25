export const onboardingModuleTitles: Record<string, string> = {
  'sql-thinking': 'SQL-мышление',
  select: 'SELECT и выражения',
  filtering: 'Фильтрация',
  sorting: 'Сортировка и лимиты',
  aggregates: 'Агрегации',
  grouping: 'GROUP BY и HAVING',
  joins: 'Связи таблиц',
  subqueries: 'Подзапросы',
  cte: 'CTE',
  windows: 'Оконные функции',
  dates: 'Дата и время',
  text: 'Строки и очистка',
  'set-ops': 'Операции над множествами',
  'data-quality': 'Качество данных',
  indexes: 'Индексы',
  explain: 'EXPLAIN',
  transactions: 'Транзакции',
  schema: 'Проектирование схемы',
  support: 'IT Support Analytics',
  final: 'Финальный проект',
  dml: 'DML и безопасные изменения',
  'schema-evolution': 'Views и развитие схемы',
  'null-logic-advanced': 'NULL: продвинутая логика',
  'conditional-aggregation': 'Условные метрики',
  'advanced-joins': 'Semi, anti и relational division',
  'recursive-cte': 'Рекурсивные CTE',
  'window-frames': 'Оконные frames',
  'json-sql': 'JSON в SQL',
  'sql-security': 'Безопасность SQL',
  concurrency: 'Конкурентность и изоляция',
  'pagination-patterns': 'Production pagination',
  'incident-investigation': 'SQL-расследование инцидента'
};

export function onboardingModuleTitle(moduleId: string) {
  return onboardingModuleTitles[moduleId] || moduleId;
}
