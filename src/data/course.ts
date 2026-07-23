export type TaskMode = 'lesson' | 'practice' | 'interview' | 'puzzle';
export type Difficulty = 'База' | 'Рабочий' | 'Продвинутый' | 'Экспертный';

export interface SqlTask {
  id: string; module: string; title: string; description: string; topic: string;
  difficulty: Difficulty; mode: TaskMode; xp: number; starter: string; solution: string; hints: string[];
}

export const modules = [
  ['sql-thinking','SQL-мышление','Как читать схему и превращать вопрос в запрос'],
  ['select','SELECT и выражения','Поля, псевдонимы, вычисления и DISTINCT'],
  ['filtering','Фильтрация','WHERE, NULL, LIKE, BETWEEN, IN'],
  ['sorting','Сортировка и лимиты','ORDER BY, LIMIT, OFFSET'],
  ['aggregates','Агрегации','COUNT, SUM, AVG, MIN, MAX'],
  ['grouping','GROUP BY и HAVING','Группы, фильтрация групп и отчёты'],
  ['joins','Связи таблиц','INNER, LEFT, self join и анти-join'],
  ['subqueries','Подзапросы','Скалярные, коррелированные и EXISTS'],
  ['cte','CTE','Читаемые этапы и рекурсивные запросы'],
  ['windows','Оконные функции','RANK, LAG, LEAD и накопительные итоги'],
  ['dates','Дата и время','Периоды, интервалы и временные отчёты'],
  ['text','Строки и очистка','CASE, COALESCE и нормализация данных'],
  ['set-ops','Операции над множествами','UNION, INTERSECT, EXCEPT'],
  ['data-quality','Качество данных','Дубли, пропуски и аномалии'],
  ['indexes','Индексы','Составные индексы и селективность'],
  ['explain','EXPLAIN','Планы выполнения и поиск узких мест'],
  ['transactions','Транзакции','ACID и безопасные изменения'],
  ['schema','Проектирование схемы','Ключи, ограничения и нормализация'],
  ['support','IT Support Analytics','SLA, очереди, инженеры и сервисы'],
  ['final','Финальный проект','Аналитическая витрина вымышленной компании T-Bonk']
] as const;

const services = ['VPN','LMS','VDI','Email','Access'];
const priorities = ['Critical','High','Medium','Low'];
const modes: TaskMode[] = ['lesson','practice','interview','puzzle'];
const difficulties: Difficulty[] = ['База','Рабочий','Продвинутый','Экспертный'];
type Recipe = (variant:number)=>Pick<SqlTask,'title'|'description'|'starter'|'solution'|'hints'>;

const recipes: Recipe[] = [
  v=>({title:`Выборка обращений по сервису ${services[v%5]}`,description:`Выведи ticket_id, service, status для сервиса ${services[v%5]}. Отсортируй по ticket_id.`,starter:'SELECT ticket_id, service, status\nFROM tickets\nWHERE ',solution:`SELECT ticket_id, service, status FROM tickets WHERE service = '${services[v%5]}' ORDER BY ticket_id;`,hints:[`Сравни service со строкой '${services[v%5]}'.`,'Добавь ORDER BY ticket_id.']}),
  v=>({title:`Фильтр по приоритету ${priorities[v%4]}`,description:`Найди обращения с приоритетом ${priorities[v%4]} и покажи их от новых к старым.`,starter:'SELECT ticket_id, priority, created_at\nFROM tickets\nWHERE priority = ',solution:`SELECT ticket_id, priority, created_at FROM tickets WHERE priority = '${priorities[v%4]}' ORDER BY created_at DESC, ticket_id DESC;`,hints:['Строки заключаются в одинарные кавычки.','Используй DESC.']}),
  v=>({title:`Незакрытые обращения: вариант ${v+1}`,description:'Покажи обращения, у которых время решения ещё неизвестно.',starter:'SELECT ticket_id, status, resolution_minutes\nFROM tickets\nWHERE ',solution:'SELECT ticket_id, status, resolution_minutes FROM tickets WHERE resolution_minutes IS NULL ORDER BY ticket_id;',hints:['NULL нельзя сравнивать через =.','Используй IS NULL.']}),
  v=>({title:`Нагрузка по сервисам: отчёт ${v+1}`,description:'Посчитай число обращений по каждому сервису и выведи самые нагруженные сервисы первыми.',starter:'SELECT service, COUNT(*) AS tickets_count\nFROM tickets\nGROUP BY service\nORDER BY ',solution:'SELECT service, COUNT(*) AS tickets_count FROM tickets GROUP BY service ORDER BY tickets_count DESC, service;',hints:['Сортируй по tickets_count DESC.','Добавь service для стабильности.']}),
  v=>({title:`Среднее время решения: отчёт ${v+1}`,description:'Рассчитай среднее время решения закрытых обращений по приоритетам, округлив до одного знака.',starter:'SELECT priority, ROUND(AVG(resolution_minutes), 1) AS avg_minutes\nFROM tickets\nWHERE ',solution:'SELECT priority, ROUND(AVG(resolution_minutes), 1) AS avg_minutes FROM tickets WHERE resolution_minutes IS NOT NULL GROUP BY priority ORDER BY avg_minutes DESC, priority;',hints:['Исключи NULL.','Не забудь GROUP BY priority.']}),
  v=>({title:`Инженеры и обращения: JOIN ${v+1}`,description:'Соедини tickets и engineers. Покажи номер обращения, имя инженера и сервис.',starter:'SELECT t.ticket_id, e.name AS engineer, t.service\nFROM tickets t\nJOIN engineers e ON ',solution:'SELECT t.ticket_id, e.name AS engineer, t.service FROM tickets t JOIN engineers e ON t.engineer_id = e.engineer_id ORDER BY t.ticket_id;',hints:['Свяжи одинаковые engineer_id.','Используй псевдонимы t и e.']}),
  v=>({title:`Все инженеры: LEFT JOIN ${v+1}`,description:'Покажи каждого инженера и количество назначенных обращений, не теряя инженеров без тикетов.',starter:'SELECT e.name, COUNT(t.ticket_id) AS tickets_count\nFROM engineers e\nLEFT JOIN tickets t ON ',solution:'SELECT e.name, COUNT(t.ticket_id) AS tickets_count FROM engineers e LEFT JOIN tickets t ON e.engineer_id = t.engineer_id GROUP BY e.engineer_id, e.name ORDER BY tickets_count DESC, e.name;',hints:['Левой таблицей должна быть engineers.','Считай t.ticket_id, а не COUNT(*).']}),
  v=>({title:`Обращения выше среднего: ${v+1}`,description:'Найди закрытые обращения, время решения которых выше среднего по всем закрытым обращениям.',starter:'SELECT ticket_id, resolution_minutes\nFROM tickets\nWHERE resolution_minutes > (\n  SELECT ',solution:'SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes > (SELECT AVG(resolution_minutes) FROM tickets WHERE resolution_minutes IS NOT NULL) ORDER BY resolution_minutes DESC, ticket_id;',hints:['Подзапрос должен вернуть одно число.','Используй AVG.']}),
  v=>({title:`CTE для статистики сервисов: ${v+1}`,description:'Через CTE посчитай обращения по сервисам и оставь сервисы минимум с двумя обращениями.',starter:'WITH service_stats AS (\n  SELECT service, COUNT(*) AS tickets_count\n  FROM tickets\n  GROUP BY service\n)\nSELECT ',solution:'WITH service_stats AS (SELECT service, COUNT(*) AS tickets_count FROM tickets GROUP BY service) SELECT service, tickets_count FROM service_stats WHERE tickets_count >= 2 ORDER BY tickets_count DESC, service;',hints:['Во внешнем SELECT выбери service и tickets_count.','Фильтруй CTE во внешнем запросе.']}),
  v=>({title:`Рейтинг сервисов: ${v+1}`,description:'Присвой сервисам место по количеству обращений с помощью RANK().',starter:'SELECT service, COUNT(*) AS tickets_count,\n       RANK() OVER (ORDER BY ',solution:'SELECT service, COUNT(*) AS tickets_count, RANK() OVER (ORDER BY COUNT(*) DESC) AS load_rank FROM tickets GROUP BY service ORDER BY load_rank, service;',hints:['RANK() вызывается без аргументов.','Внутри OVER используй COUNT(*) DESC.']}),
  v=>({title:`Нарушения SLA: аналитика ${v+1}`,description:'Покажи закрытые обращения, где resolution_minutes больше sla_minutes, начиная с самого сильного нарушения.',starter:'SELECT ticket_id, service,\n       resolution_minutes - sla_minutes AS breach_minutes\nFROM tickets\nWHERE ',solution:'SELECT ticket_id, service, resolution_minutes - sla_minutes AS breach_minutes FROM tickets WHERE resolution_minutes > sla_minutes ORDER BY breach_minutes DESC, ticket_id;',hints:['Сравни фактическое и нормативное время.','Сортируй по breach_minutes DESC.']}),
  v=>({title:`EXPLAIN поиска по сервису: ${v+1}`,description:`Изучи план поиска обращений сервиса ${services[v%5]}.`,starter:'EXPLAIN QUERY PLAN\nSELECT ticket_id, service\nFROM tickets\nWHERE ',solution:`EXPLAIN QUERY PLAN SELECT ticket_id, service FROM tickets WHERE service = '${services[v%5]}';`,hints:['Начни с EXPLAIN QUERY PLAN.',`Фильтр: service = '${services[v%5]}'.`]})
];

export const tasks: SqlTask[] = modules.flatMap(([module,topic],moduleIndex)=>Array.from({length:6},(_,taskIndex)=>{
  const globalIndex=moduleIndex*6+taskIndex;
  return {id:`task-${String(globalIndex+1).padStart(3,'0')}`,module,topic,difficulty:difficulties[Math.min(3,Math.floor(globalIndex/30))],mode:modes[globalIndex%4],xp:60+(globalIndex%8)*15,...recipes[(moduleIndex+taskIndex)%recipes.length](taskIndex)};
}));

export const achievements = [
  {id:'first-query',title:'Первый запрос',description:'Правильно решить первую задачу',threshold:1},
  {id:'ten-tasks',title:'Разогрев окончен',description:'Решить 10 задач',threshold:10},
  {id:'quarter',title:'Четверть пути',description:'Решить 30 задач',threshold:30},
  {id:'half',title:'SQL-мидпоинт',description:'Решить 60 задач',threshold:60},
  {id:'interview-ready',title:'Interview Ready',description:'Решить 90 задач',threshold:90},
  {id:'academy',title:'SQL Academy',description:'Решить все 120 задач',threshold:120}
];