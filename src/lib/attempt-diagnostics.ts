import type { SqlTask } from '../data/course-catalog';

export type AttemptErrorKind =
  | 'syntax'
  | 'schema'
  | 'runtime'
  | 'result-shape'
  | 'row-set'
  | 'ordering'
  | 'values'
  | 'null-filter'
  | 'aggregation'
  | 'join-cardinality';

export type AttemptResultBlock = {
  columns: string[];
  values: unknown[][];
};

export type AttemptDiagnostic = {
  kind: AttemptErrorKind;
  title: string;
  explanation: string;
  nextStep: string;
  atlasId?: string;
};

const JOIN_MODULES = new Set(['joins', 'advanced-joins']);
const NULL_MODULES = new Set(['filtering', 'subqueries', 'text', 'null-logic-advanced', 'json-sql']);
const AGGREGATE_MODULES = new Set(['aggregates', 'grouping', 'windows', 'conditional-aggregation', 'window-frames']);

const diagnosticCatalog: Record<AttemptErrorKind, AttemptDiagnostic> = {
  syntax: {
    kind: 'syntax',
    title: 'Синтаксис не разобран',
    explanation: 'SQLite не смог построить выражение. Обычно причина находится рядом с указанным token или перед ним.',
    nextStep: 'Разнеси clauses по строкам, проверь запятые и сократи запрос до минимального SELECT.',
    atlasId: 'syntax-clause-order'
  },
  schema: {
    kind: 'schema',
    title: 'Запрос не совпадает со схемой',
    explanation: 'SQL распарсился, но таблица, столбец или alias не найдены либо неоднозначны.',
    nextStep: 'Открой Schema Explorer, проверь реальные имена и квалифицируй поле через alias.column.',
    atlasId: 'runtime-unknown-column'
  },
  runtime: {
    kind: 'runtime',
    title: 'Ошибка выполнения',
    explanation: 'Запрос синтаксически допустим, но не может быть выполнен на текущих данных или в текущем состоянии базы.',
    nextStep: 'Запусти минимальную часть запроса, проверь типы, функции и входные значения.'
  },
  'result-shape': {
    kind: 'result-shape',
    title: 'Неверный контракт результата',
    explanation: 'Количество result sets или набор и порядок столбцов отличаются от ожидаемого результата.',
    nextStep: 'Сначала перечисли нужные столбцы и алиасы, затем сравни их порядок с условием задачи.',
    atlasId: 'performance-select-star'
  },
  'row-set': {
    kind: 'row-set',
    title: 'Выбран неверный набор строк',
    explanation: 'Форма таблицы совпадает, но запрос возвращает лишние строки или теряет нужные.',
    nextStep: 'Запусти базовый SELECT без части условий и добавляй WHERE/JOIN по одному, сверяя COUNT и идентификаторы.'
  },
  ordering: {
    kind: 'ordering',
    title: 'Строки верные, порядок нет',
    explanation: 'Набор строк совпадает, но ORDER BY не задаёт ожидаемую последовательность или полный tie-breaker.',
    nextStep: 'Проверь направление каждого sort key и добавь уникальный последний ключ.',
    atlasId: 'logical-unstable-limit'
  },
  values: {
    kind: 'values',
    title: 'Значения рассчитаны неверно',
    explanation: 'Столбцы и количество строк совпадают, но хотя бы одно вычисленное или выбранное значение отличается.',
    nextStep: 'Добавь промежуточные выражения в SELECT и проверь одну строку вручную до финального расчёта.'
  },
  'null-filter': {
    kind: 'null-filter',
    title: 'Проверь NULL и логику фильтра',
    explanation: 'Результат похож на ошибку трёхзначной логики, nullable-источника или условия, применённого не на том этапе.',
    nextStep: 'Посчитай NULL отдельно, используй IS NULL/IS NOT NULL и проверь подзапрос или правую сторону JOIN.',
    atlasId: 'logical-not-in-null'
  },
  aggregation: {
    kind: 'aggregation',
    title: 'Нарушена гранулярность агрегата',
    explanation: 'Группы, denominator или момент фильтрации не совпадают с бизнес-вопросом.',
    nextStep: 'Назови одну строку результата, проверь GROUP BY и раздели row filter (WHERE) от group filter (HAVING).'
  },
  'join-cardinality': {
    kind: 'join-cardinality',
    title: 'JOIN размножил или потерял строки',
    explanation: 'Кардинальность связи не соответствует ожидаемой гранулярности результата.',
    nextStep: 'Посчитай строки на join key с обеих сторон и реши, нужна ли предагрегация, EXISTS или другое условие ON.',
    atlasId: 'logical-join-multiplication'
  }
};

function normalize(value: unknown) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return Number.isInteger(value)
    ? String(value)
    : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

function normalizedColumns(blocks: AttemptResultBlock[]) {
  return blocks.map(block => block.columns.map(column => column.toLowerCase()));
}

function normalizedRows(blocks: AttemptResultBlock[]) {
  return blocks.map(block => block.values.map(row => row.map(normalize)));
}

function sortedRows(blocks: AttemptResultBlock[]) {
  return normalizedRows(blocks).map(rows => rows
    .map(row => JSON.stringify(row))
    .sort((left, right) => left.localeCompare(right)));
}

function rowCount(blocks: AttemptResultBlock[]) {
  return blocks.reduce((sum, block) => sum + block.values.length, 0);
}

export function diagnosticForKind(kind: AttemptErrorKind): AttemptDiagnostic {
  return diagnosticCatalog[kind];
}

export function classifySqlAttempt(input: {
  task: SqlTask;
  sql: string;
  actual?: AttemptResultBlock[];
  expected?: AttemptResultBlock[];
  errorMessage?: string;
}): AttemptDiagnostic {
  const message = input.errorMessage?.toLowerCase() || '';
  if (message) {
    if (/syntax error|incomplete input|unrecognized token|near .+ syntax/.test(message)) {
      return diagnosticForKind('syntax');
    }
    if (/no such (column|table)|ambiguous column|has no column named/.test(message)) {
      return diagnosticForKind('schema');
    }
    return diagnosticForKind('runtime');
  }

  const actual = input.actual || [];
  const expected = input.expected || [];
  if (actual.length !== expected.length
    || JSON.stringify(normalizedColumns(actual)) !== JSON.stringify(normalizedColumns(expected))) {
    return diagnosticForKind('result-shape');
  }

  const actualCount = rowCount(actual);
  const expectedCount = rowCount(expected);
  if (actualCount !== expectedCount) {
    if (JOIN_MODULES.has(input.task.module) && actualCount > expectedCount) {
      return diagnosticForKind('join-cardinality');
    }
    if (NULL_MODULES.has(input.task.module) && actualCount === 0 && expectedCount > 0) {
      return diagnosticForKind('null-filter');
    }
    if (AGGREGATE_MODULES.has(input.task.module)) {
      return diagnosticForKind('aggregation');
    }
    return diagnosticForKind('row-set');
  }

  const actualRows = normalizedRows(actual);
  const expectedRows = normalizedRows(expected);
  if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)
    && JSON.stringify(sortedRows(actual)) === JSON.stringify(sortedRows(expected))) {
    return diagnosticForKind('ordering');
  }

  if (NULL_MODULES.has(input.task.module) || /\bnull\b|\bnot\s+in\b/i.test(input.sql)) {
    return diagnosticForKind('null-filter');
  }
  if (JOIN_MODULES.has(input.task.module) || /\bjoin\b/i.test(input.sql)) {
    return diagnosticForKind('join-cardinality');
  }
  if (AGGREGATE_MODULES.has(input.task.module) || /\b(group\s+by|having|count|sum|avg|min|max)\b/i.test(input.sql)) {
    return diagnosticForKind('aggregation');
  }
  return diagnosticForKind('values');
}
