import { moduleGuides, type SqlTask } from './course';
import { coreCheckpointAuthoredTaskBlueprints } from './core-authored-tasks';

const foundationCheckpointTasks: SqlTask[] = [
  {
    id: 'checkpoint-foundation-thinking', module: 'sql-thinking', topic: 'SQL-мышление', difficulty: 'База', mode: 'practice', xp: 0,
    title: 'Checkpoint: контракт обращения для передачи',
    description: 'Верни ticket_id, customer_id и subject для каждого обращения. Сохрани NULL customer_id и кратность строк.',
    starter: 'SELECT\n  \nFROM tickets;',
    solution: 'SELECT ticket_id, customer_id, subject FROM tickets;',
    hints: [], guide: moduleGuides['sql-thinking'], evaluationContractId: 'foundation:checkpoint-foundation-thinking'
  },
  {
    id: 'checkpoint-foundation-filtering', module: 'filtering', topic: 'Фильтрация', difficulty: 'База', mode: 'practice', xp: 0,
    title: 'Checkpoint: открытые High-обращения',
    description: 'Верни ticket_id, priority и status для Open-обращений с priority High.',
    starter: 'SELECT ticket_id, priority, status\nFROM tickets\nWHERE ' ,
    solution: "SELECT ticket_id, priority, status FROM tickets WHERE status = 'Open' INTERSECT SELECT ticket_id, priority, status FROM tickets WHERE priority = 'High';",
    hints: [], guide: moduleGuides.filtering, evaluationContractId: 'foundation:checkpoint-foundation-filtering'
  },
  {
    id: 'checkpoint-foundation-select', module: 'select', topic: 'SELECT и выражения', difficulty: 'База', mode: 'practice', xp: 0,
    title: 'Checkpoint: остаток SLA закрытых обращений',
    description: 'Для закрытых обращений верни ticket_id и sla_minutes − resolution_minutes как remaining_minutes.',
    starter: 'SELECT\n  ticket_id,\n  \nFROM tickets\nWHERE ' ,
    solution: "SELECT ticket_id, sla_minutes - resolution_minutes AS remaining_minutes FROM tickets WHERE status = 'Closed';",
    hints: [], guide: moduleGuides.select, evaluationContractId: 'foundation:checkpoint-foundation-select'
  },
  {
    id: 'checkpoint-foundation-sorting', module: 'sorting', topic: 'Сортировка и лимиты', difficulty: 'База', mode: 'practice', xp: 0,
    title: 'Checkpoint: три самых строгих SLA',
    description: 'Верни три обращения с наименьшим sla_minutes. При равенстве раньше идёт меньший ticket_id.',
    starter: 'SELECT ticket_id, sla_minutes\nFROM tickets\nORDER BY ' ,
    solution: 'WITH ranked AS (SELECT ticket_id, sla_minutes, ROW_NUMBER() OVER (ORDER BY sla_minutes, ticket_id) AS rn FROM tickets) SELECT ticket_id, sla_minutes FROM ranked WHERE rn <= 3 ORDER BY rn;',
    hints: [], guide: moduleGuides.sorting, evaluationContractId: 'foundation:checkpoint-foundation-sorting'
  },
  {
    id: 'checkpoint-foundation-aggregates', module: 'aggregates', topic: 'Агрегации', difficulty: 'База', mode: 'practice', xp: 0,
    title: 'Checkpoint: размер открытого backlog',
    description: 'Верни число Open-обращений как open_count.',
    starter: 'SELECT\n  \nFROM tickets\nWHERE ' ,
    solution: "SELECT COUNT(*) AS open_count FROM tickets WHERE status = 'Open';",
    hints: [], guide: moduleGuides.aggregates, evaluationContractId: 'foundation:checkpoint-foundation-aggregates'
  }
];

const coreAuthoredCheckpointTasks: SqlTask[] = coreCheckpointAuthoredTaskBlueprints.map(blueprint => ({
  ...blueprint,
  module: blueprint.module,
  topic: moduleGuides[blueprint.module].summary,
  difficulty: 'Рабочий',
  mode: 'practice',
  xp: 0,
  guide: moduleGuides[blueprint.module]
} as SqlTask));
const checkpointTasks = [...foundationCheckpointTasks, ...coreAuthoredCheckpointTasks];

const checkpointTasksById = new Map(checkpointTasks.map(task => [task.id, task]));

export const foundationCheckpointTaskIds = foundationCheckpointTasks.map(task => task.id);
export const coreCheckpointTaskIds = coreAuthoredCheckpointTasks.map(task => task.id);

export function checkpointTaskById(taskId: string) {
  return checkpointTasksById.get(taskId) || null;
}

export function checkpointTaskList() {
  return [...checkpointTasks];
}
