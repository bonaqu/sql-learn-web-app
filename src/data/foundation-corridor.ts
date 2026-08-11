import type { SqlTask } from './course';

type FoundationTaskOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints' | 'evaluationContractId'>;

function evaluationContractId(taskId: string) {
  return `foundation:${taskId}`;
}

const overrides: Record<string, FoundationTaskOverride> = {
  'task-001': {
    title: 'Форма результата: обращение и сервис',
    description: 'Верни ticket_id и service для каждого обращения. Порядок строк не важен, одинаковые значения не удаляй.',
    starter: 'SELECT\n  \nFROM tickets;',
    solution: 'SELECT ticket_id, service FROM tickets;',
    hints: ['Одна строка — одно обращение.', 'Нужны ровно два столбца: ticket_id и service.', 'Источник строк — таблица tickets.'],
    evaluationContractId: evaluationContractId('task-001')
  },
  'task-002': {
    title: 'Форма результата: обращение и состояние',
    description: 'Верни ticket_id и status для каждого обращения. Не фильтруй строки и не меняй типы значений.',
    starter: 'SELECT\n  ticket_id,\n  \nFROM tickets;',
    solution: 'SELECT ticket_id, status FROM tickets;',
    hints: ['Результат охватывает все обращения.', 'Второй столбец хранит состояние обращения.', 'WHERE здесь не нужен.'],
    evaluationContractId: evaluationContractId('task-002')
  },
  'task-003': {
    title: 'Сохрани кратность сервисов и состояний',
    description: 'Верни service и status для каждого обращения. Одинаковые пары должны повторяться столько раз, сколько они встречаются в tickets.',
    starter: 'SELECT\n  service,\n  \nFROM tickets;',
    solution: 'SELECT service, status FROM tickets;',
    hints: ['Гранулярность остаётся «одно обращение».', 'Одинаковые проекции — не ошибка.', 'Не используй DISTINCT.'],
    evaluationContractId: evaluationContractId('task-003')
  },
  'task-004': {
    title: 'Сохрани неизвестное время решения',
    description: 'Верни ticket_id и resolution_minutes для каждого обращения. NULL должен остаться NULL.',
    starter: 'SELECT\n  ticket_id,\n  \nFROM tickets;',
    solution: 'SELECT ticket_id, resolution_minutes FROM tickets;',
    hints: ['Не исключай незакрытые обращения.', 'Не заменяй NULL строкой или нулём.', 'Выбери исходный столбец resolution_minutes.'],
    evaluationContractId: evaluationContractId('task-004')
  },
  'task-005': {
    title: 'Контракт SLA без лишних столбцов',
    description: 'Верни ticket_id и sla_minutes для каждого обращения. Порядок не является частью требования.',
    starter: 'SELECT\n  \nFROM tickets;',
    solution: 'SELECT ticket_id, sla_minutes FROM tickets;',
    hints: ['Нужны ровно два поля.', 'SLA хранится в sla_minutes.', 'Не добавляй ORDER BY без требования.'],
    evaluationContractId: evaluationContractId('task-005')
  },
  'task-006': {
    title: 'Объясни гранулярность приоритета сервиса',
    description: 'Верни ticket_id, priority и service для каждого обращения. Сохрани одну строку на обращение и объясни этот контракт перед запуском.',
    starter: 'SELECT\n  ticket_id,\n  priority,\n  \nFROM tickets;',
    solution: 'SELECT ticket_id, priority, service FROM tickets;',
    hints: ['Идентификатор удерживает гранулярность.', 'priority и service — атрибуты обращения.', 'Фильтрация не требуется.'],
    evaluationContractId: evaluationContractId('task-006')
  },
  'task-007': {
    title: 'Отклонение SLA только для закрытых обращений',
    description: 'Для закрытых обращений верни ticket_id, resolution_minutes, sla_minutes и разницу resolution_minutes − sla_minutes как delta_minutes. Open-строка с заполненным временем не считается закрытой.',
    starter: 'SELECT\n  ticket_id,\n  resolution_minutes,\n  sla_minutes,\n  \nFROM tickets\nWHERE ' ,
    solution: "SELECT ticket_id, resolution_minutes, sla_minutes, resolution_minutes - sla_minutes AS delta_minutes FROM tickets WHERE status = 'Closed';",
    hints: ['Закрытость определяется status, а не заполненностью времени.', 'Разность задаётся выражением в SELECT.', 'Назови выражение delta_minutes.'],
    evaluationContractId: evaluationContractId('task-007')
  },
  'task-008': {
    title: 'Переведи SLA из минут в часы',
    description: 'Верни ticket_id и sla_minutes / 60.0 как sla_hours для каждого обращения.',
    starter: 'SELECT\n  ticket_id,\n  \nFROM tickets;',
    solution: 'SELECT ticket_id, sla_minutes / 60.0 AS sla_hours FROM tickets;',
    hints: ['60.0 сохраняет вещественный результат.', 'Выражению нужен алиас sla_hours.', 'Фильтр не требуется.'],
    evaluationContractId: evaluationContractId('task-008')
  },
  'task-009': {
    title: 'Дай сервису контрактное имя',
    description: 'Верни ticket_id и service под алиасом product для каждого обращения.',
    starter: 'SELECT\n  ticket_id,\n  service AS \nFROM tickets;',
    solution: 'SELECT ticket_id, service AS product FROM tickets;',
    hints: ['Значение service не меняется.', 'AS задаёт имя выходного столбца.', 'Контракт ожидает product.'],
    evaluationContractId: evaluationContractId('task-009')
  },
  'task-010': {
    title: 'Рассчитай двойное окно SLA',
    description: 'Верни ticket_id и sla_minutes × 2 как double_sla_minutes для каждого обращения.',
    starter: 'SELECT\n  ticket_id,\n  sla_minutes * 2 AS \nFROM tickets;',
    solution: 'SELECT ticket_id, sla_minutes * 2 AS double_sla_minutes FROM tickets;',
    hints: ['Умножение выполняется в SELECT.', 'Результат остаётся целым числом минут.', 'Проверь точный алиас.'],
    evaluationContractId: evaluationContractId('task-010')
  },
  'task-011': {
    title: 'Спрогнозируй время с буфером',
    description: 'Верни ticket_id и resolution_minutes + 15 как projected_minutes. Для неизвестного resolution_minutes результат должен остаться NULL.',
    starter: 'SELECT\n  ticket_id,\n  resolution_minutes + 15 AS \nFROM tickets;',
    solution: 'SELECT ticket_id, resolution_minutes + 15 AS projected_minutes FROM tickets;',
    hints: ['NULL + 15 остаётся NULL.', 'Не подменяй неизвестное значение нулём.', 'Назови выражение projected_minutes.'],
    evaluationContractId: evaluationContractId('task-011')
  },
  'task-012': {
    title: 'Доля использованного SLA',
    description: 'Для закрытых обращений верни ticket_id и resolution_minutes × 100.0 / sla_minutes как sla_usage_pct.',
    starter: 'SELECT\n  ticket_id,\n  \nFROM tickets\nWHERE ' ,
    solution: "SELECT ticket_id, resolution_minutes * 100.0 / sla_minutes AS sla_usage_pct FROM tickets WHERE status = 'Closed';",
    hints: ['Сначала ограничь status = Closed.', '100.0 сохраняет дробную часть.', 'Алиас — sla_usage_pct.'],
    evaluationContractId: evaluationContractId('task-012')
  },
  'task-013': {
    title: 'Отбери закрытые обращения',
    description: 'Верни ticket_id и status только для строк со status = Closed. Порядок не важен.',
    starter: 'SELECT ticket_id, status\nFROM tickets\nWHERE ' ,
    solution: "SELECT ticket_id, status FROM tickets WHERE status = 'Closed';",
    hints: ['WHERE проверяет каждую строку.', 'Closed — строковое значение.', 'Не используй resolution_minutes как замену status.'],
    evaluationContractId: evaluationContractId('task-013')
  },
  'task-014': {
    title: 'Critical среди закрытых',
    description: 'Верни ticket_id, priority и status для закрытых Critical-обращений.',
    starter: 'SELECT ticket_id, priority, status\nFROM tickets\nWHERE ' ,
    solution: "SELECT ticket_id, priority, status FROM tickets WHERE status = 'Closed' AND priority = 'Critical';",
    hints: ['Оба условия должны быть истинны.', 'Соедини их через AND.', 'Проверь точные строковые значения.'],
    evaluationContractId: evaluationContractId('task-014')
  },
  'task-015': {
    title: 'Обращения VPN или LMS',
    description: 'Верни ticket_id и service для обращений сервиса VPN или LMS.',
    starter: 'SELECT ticket_id, service\nFROM tickets\nWHERE ' ,
    solution: "SELECT ticket_id, service FROM tickets WHERE service = 'VPN' OR service = 'LMS';",
    hints: ['Достаточно одного из двух сервисов.', 'Используй OR.', 'Не удаляй повторяющиеся сервисы.'],
    evaluationContractId: evaluationContractId('task-015')
  },
  'task-016': {
    title: 'Найди неизвестное время решения',
    description: 'Верни ticket_id и resolution_minutes для строк, где время решения неизвестно.',
    starter: 'SELECT ticket_id, resolution_minutes\nFROM tickets\nWHERE ' ,
    solution: 'SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes IS NULL;',
    hints: ['NULL проверяется не через =.', 'Используй IS NULL.', 'Сохрани NULL в выходном столбце.'],
    evaluationContractId: evaluationContractId('task-016')
  },
  'task-017': {
    title: 'Закрытые обращения с известным временем',
    description: 'Верни ticket_id, status и resolution_minutes только для закрытых строк с известным временем. Open-строка с числом должна быть исключена.',
    starter: 'SELECT ticket_id, status, resolution_minutes\nFROM tickets\nWHERE ' ,
    solution: "SELECT ticket_id, status, resolution_minutes FROM tickets WHERE status = 'Closed' AND resolution_minutes IS NOT NULL;",
    hints: ['Известное время само по себе не доказывает Closed.', 'Проверь status и IS NOT NULL вместе.', 'Соедини условия через AND.'],
    evaluationContractId: evaluationContractId('task-017')
  },
  'task-018': {
    title: 'Срочные VPN или VDI',
    description: 'Верни ticket_id, service и priority для High или Critical обращений сервиса VPN либо VDI.',
    starter: 'SELECT ticket_id, service, priority\nFROM tickets\nWHERE ' ,
    solution: "SELECT ticket_id, service, priority FROM tickets WHERE (priority = 'High' OR priority = 'Critical') AND (service = 'VPN' OR service = 'VDI');",
    hints: ['Собери две независимые OR-группы.', 'Свяжи группы через AND.', 'Скобки фиксируют смысл условия.'],
    evaluationContractId: evaluationContractId('task-018')
  }
};

export function applyFoundationCorridorOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => overrides[task.id] ? { ...task, ...overrides[task.id] } : task);
}
