export type TaskMode = 'lesson' | 'practice' | 'interview' | 'puzzle';
export type Difficulty = 'База' | 'Рабочий' | 'Продвинутый' | 'Экспертный';

export interface SqlTask {
  id: string;
  module: string;
  title: string;
  description: string;
  topic: string;
  difficulty: Difficulty;
  mode: TaskMode;
  xp: number;
  starter: string;
  expected: string;
  hints: string[];
}

export const modules = [
  ['sql-thinking', 'SQL-мышление', 'Как читать схему и превращать вопрос в запрос'],
  ['select', 'SELECT и выражения', 'Поля, псевдонимы, вычисления и DISTINCT'],
  ['filtering', 'Фильтрация', 'WHERE, NULL, LIKE, BETWEEN, IN'],
  ['sorting', 'Сортировка и лимиты', 'ORDER BY, LIMIT, OFFSET'],
  ['aggregates', 'Агрегации', 'COUNT, SUM, AVG, MIN, MAX'],
  ['grouping', 'GROUP BY и HAVING', 'Группы, фильтрация групп и отчёты'],
  ['joins', 'Связи таблиц', 'INNER, LEFT, self join и анти-join'],
  ['subqueries', 'Подзапросы', 'Скалярные, коррелированные и EXISTS'],
  ['cte', 'CTE', 'Читаемые этапы и рекурсивные запросы'],
  ['windows', 'Оконные функции', 'RANK, LAG, LEAD и накопительные итоги'],
  ['dates', 'Дата и время', 'Периоды, интервалы и временные отчёты'],
  ['text', 'Строки и очистка', 'CASE, COALESCE и нормализация данных'],
  ['set-ops', 'Операции над множествами', 'UNION, INTERSECT, EXCEPT'],
  ['data-quality', 'Качество данных', 'Дубли, пропуски и аномалии'],
  ['indexes', 'Индексы', 'Составные индексы и селективность'],
  ['explain', 'EXPLAIN', 'Планы выполнения и поиск узких мест'],
  ['transactions', 'Транзакции', 'ACID, блокировки и безопасные изменения'],
  ['schema', 'Проектирование схемы', 'Ключи, ограничения и нормализация'],
  ['support', 'IT Support Analytics', 'SLA, очереди, инженеры и сервисы'],
  ['final', 'Финальный проект', 'Аналитическая витрина вымышленной компании T-Bonk']
] as const;

const topics = modules.map(([id, title]) => ({ id, title }));
const modes: TaskMode[] = ['lesson', 'practice', 'interview', 'puzzle'];
const difficulties: Difficulty[] = ['База', 'Рабочий', 'Продвинутый', 'Экспертный'];

const scenarios = [
  'Найди обращения, которые нарушили SLA, и отсортируй их по времени решения.',
  'Посчитай нагрузку по сервисам и выдели самый проблемный сервис.',
  'Сравни число открытых и закрытых обращений по инженерам.',
  'Построй недельную динамику инцидентов без потери дней с нулевым значением.',
  'Найди повторные обращения одного клиента по одной услуге.',
  'Определи медианное время решения по приоритетам.',
  'Найди инженеров, у которых доля нарушений SLA выше средней по команде.',
  'Покажи сервисы с ростом инцидентов относительно предыдущей недели.',
  'Найди дубли обращений и предложи безопасный способ очистки.',
  'Объясни план выполнения и предложи подходящий индекс.'
];

const starters = [
  'SELECT\n  ticket_id, service, status\nFROM tickets\nWHERE ',
  'SELECT service, COUNT(*) AS tickets_count\nFROM tickets\nGROUP BY service\nORDER BY ',
  'WITH stats AS (\n  SELECT engineer_id, COUNT(*) AS total\n  FROM tickets\n  GROUP BY engineer_id\n)\nSELECT *\nFROM stats\nWHERE ',
  'SELECT\n  service,\n  RANK() OVER (ORDER BY COUNT(*) DESC) AS load_rank\nFROM tickets\nGROUP BY service;',
  'EXPLAIN QUERY PLAN\nSELECT *\nFROM tickets\nWHERE service = \'VPN\';'
];

export const tasks: SqlTask[] = Array.from({ length: 120 }, (_, index) => {
  const topic = topics[index % topics.length];
  const mode = modes[index % modes.length];
  const difficulty = difficulties[Math.min(3, Math.floor(index / 30))];
  const number = index + 1;
  return {
    id: `task-${String(number).padStart(3, '0')}`,
    module: topic.id,
    title: `${topic.title}: задача ${number}`,
    description: scenarios[index % scenarios.length],
    topic: topic.title,
    difficulty,
    mode,
    xp: 50 + (index % 8) * 15,
    starter: starters[index % starters.length],
    expected: 'Решение проверяется по структуре результата, столбцам и контрольным значениям.',
    hints: [
      `Сначала определи, какие строки нужны в теме «${topic.title}».`,
      'Разбей сложный запрос на этапы и проверяй каждый SELECT отдельно.',
      'Для рабочих отчётов добавляй детерминированную сортировку.'
    ]
  };
});

export const achievements = [
  { id: 'first-query', title: 'Первый запрос', description: 'Выполнить первую задачу', threshold: 1 },
  { id: 'ten-tasks', title: 'Разогрев окончен', description: 'Решить 10 задач', threshold: 10 },
  { id: 'join-master', title: 'Связи установлены', description: 'Решить 5 задач по JOIN', threshold: 5 },
  { id: 'window-wizard', title: 'Повелитель окон', description: 'Решить 5 задач по окнам', threshold: 5 },
  { id: 'interview-ready', title: 'Interview Ready', description: 'Решить 15 интервью-задач', threshold: 15 },
  { id: 'academy', title: 'SQL Academy', description: 'Решить все 120 задач', threshold: 120 }
];
