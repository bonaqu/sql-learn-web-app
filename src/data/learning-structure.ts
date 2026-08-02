import type { Difficulty, TaskMode } from './course';

export const phaseDefinitions = [
  {
    id: 'foundation',
    title: 'I. Надёжная база',
    subtitle: 'Контракт результата, фильтры, сортировка и агрегаты',
    moduleIds: ['sql-thinking', 'select', 'filtering', 'sorting', 'aggregates', 'grouping']
  },
  {
    id: 'composition',
    title: 'II. Конструирование запросов',
    subtitle: 'JOIN, подзапросы, CTE, окна, даты, текст и множества',
    moduleIds: ['joins', 'subqueries', 'cte', 'windows', 'dates', 'text', 'set-ops']
  },
  {
    id: 'production-core',
    title: 'III. Production core',
    subtitle: 'Качество, индексы, планы, транзакции и схема',
    moduleIds: ['data-quality', 'indexes', 'explain', 'transactions', 'schema']
  },
  {
    id: 'support-track',
    title: 'IV. Support Analytics',
    subtitle: 'SLA, операционные метрики и базовая витрина T-Bonk',
    moduleIds: ['support', 'final']
  },
  {
    id: 'data-change',
    title: 'V. Изменения и целостность',
    subtitle: 'DML, schema evolution и продвинутая NULL-логика',
    moduleIds: ['dml', 'schema-evolution', 'null-logic-advanced']
  },
  {
    id: 'advanced-querying',
    title: 'VI. Advanced querying',
    subtitle: 'Условные метрики, existence patterns и рекурсивные CTE',
    moduleIds: ['conditional-aggregation', 'advanced-joins', 'recursive-cte']
  },
  {
    id: 'modern-sql',
    title: 'VII. Modern SQL',
    subtitle: 'Window frames, JSON и безопасная параметризация',
    moduleIds: ['window-frames', 'json-sql', 'sql-security']
  },
  {
    id: 'production-operations',
    title: 'VIII. Production operations',
    subtitle: 'Concurrency, keyset pagination и SQL-расследования',
    moduleIds: ['concurrency', 'pagination-patterns', 'incident-investigation']
  }
] as const;

export type LearningPhaseId = typeof phaseDefinitions[number]['id'];

export const canonicalModuleIds = phaseDefinitions.flatMap(phase => [...phase.moduleIds]);

const moduleOrder = new Map<string, number>(canonicalModuleIds.map((id, index) => [id, index]));
const modeOrder: Record<TaskMode, number> = {
  lesson: 0,
  practice: 1,
  interview: 2,
  puzzle: 3
};
const difficultyOrder: Record<Difficulty, number> = {
  'База': 0,
  'Рабочий': 1,
  'Продвинутый': 2,
  'Экспертный': 3
};

export function moduleOrderIndex(moduleId: string) {
  return moduleOrder.get(moduleId) ?? Number.MAX_SAFE_INTEGER;
}

export function taskModeOrder(mode: TaskMode) {
  return modeOrder[mode];
}

export function taskDifficultyOrder(difficulty: Difficulty) {
  return difficultyOrder[difficulty];
}

export function phaseForModule(moduleId: string) {
  return phaseDefinitions.find(phase => phase.moduleIds.some(id => id === moduleId)) || null;
}
