import type { QueryExecResult } from 'sql.js';
import type { SqlTask } from '../data/course';
import { trainingSeedSql } from '../data/training-dataset';
import { taskEvaluationContract } from '../data/foundation-evaluation-contracts';
import type { AttemptDiagnostic } from './attempt-diagnostics';
import {
  FOUNDATION_EVIDENCE_CONTRACT_VERSION,
  TASK_EVALUATION_CONTRACT_VERSION,
  type TaskEvaluationColumn,
  type TaskEvaluationContract,
  type TaskEvaluationDiagnostic,
  type TaskEvaluationDiagnosticCode,
  type TaskEvaluationFixture,
  type TaskEvaluationResult,
  type TaskEvaluationSurface,
  type TaskSqlEngine
} from './task-evaluation-types';

export * from './task-evaluation-types';

export class TaskSqlExecutionError extends Error {
  readonly kind: 'learner' | 'technical';

  constructor(kind: 'learner' | 'technical', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TaskSqlExecutionError';
    this.kind = kind;
  }
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function statements(source: string) {
  const result: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      current += character;
      if (character === quote) {
        if (source[index + 1] === quote) {
          current += source[index + 1];
          index += 1;
        } else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === ';') {
      if (current.trim()) result.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

const SQL_IDENTIFIER_SOURCE = '(?:"(?:""|[^"])+"|\\[(?:\\]\\]|[^\\]])+\\]|`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_$]*)';

function normalizedIdentifier(source: string) {
  const value = source.trim();
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/""/g, '"').toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1).replace(/]]/g, ']').toLowerCase();
  if (value.startsWith('`') && value.endsWith('`')) return value.slice(1, -1).replace(/``/g, '`').toLowerCase();
  return value.toLowerCase();
}

function cleanedStatements(source: string) {
  return statements(source).map(statement => statement
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()).filter(Boolean);
}

function disposableScriptPolicyViolation(source: string) {
  if (!source.trim()) return 'SQL-скрипт пуст.';
  if (source.length > 40_000) return 'SQL-скрипт превышает лимит 40 000 символов.';
  const cleaned = cleanedStatements(source);
  if (!cleaned.length) return 'SQL-скрипт не содержит исполняемых команд.';
  if (cleaned.length > 200) return 'В одноразовой лаборатории разрешено не больше 200 команд.';

  const tempObjects = new Set<string>();
  const createTemp = new RegExp(`^CREATE\\s+(?:TEMP|TEMPORARY)\\s+(?:TABLE|VIEW|INDEX)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${SQL_IDENTIFIER_SOURCE})(?=\\s|\\(|$)`, 'i');
  for (const statement of cleaned) {
    const match = createTemp.exec(statement);
    if (match) tempObjects.add(normalizedIdentifier(match[1]));
  }

  const target = (statement: string, expression: RegExp) => {
    const match = expression.exec(statement);
    return match ? normalizedIdentifier(match[1]) : null;
  };
  const insertTarget = new RegExp(`^(?:INSERT(?:\\s+OR\\s+(?:ROLLBACK|ABORT|REPLACE|FAIL|IGNORE))?|REPLACE)\\s+INTO\\s+(${SQL_IDENTIFIER_SOURCE})(?=\\s|\\(|$)`, 'i');
  const updateTarget = new RegExp(`^UPDATE(?:\\s+OR\\s+(?:ROLLBACK|ABORT|REPLACE|FAIL|IGNORE))?\\s+(${SQL_IDENTIFIER_SOURCE})(?=\\s|$)`, 'i');
  const deleteTarget = new RegExp(`^DELETE\\s+FROM\\s+(${SQL_IDENTIFIER_SOURCE})(?=\\s|$)`, 'i');
  const alterTarget = new RegExp(`^ALTER\\s+TABLE\\s+(${SQL_IDENTIFIER_SOURCE})(?=\\s|$)`, 'i');
  const dropTarget = new RegExp(`^DROP\\s+(?:TABLE|VIEW|INDEX)\\s+(?:IF\\s+EXISTS\\s+)?(${SQL_IDENTIFIER_SOURCE})(?=\\s|$)`, 'i');
  const withMutationTarget = new RegExp(`\\b(?:INSERT(?:\\s+OR\\s+(?:ROLLBACK|ABORT|REPLACE|FAIL|IGNORE))?|REPLACE)\\s+INTO\\s+(${SQL_IDENTIFIER_SOURCE})(?=\\s|\\(|$)|\\bUPDATE(?:\\s+OR\\s+(?:ROLLBACK|ABORT|REPLACE|FAIL|IGNORE))?\\s+(${SQL_IDENTIFIER_SOURCE})(?=\\s|$)|\\bDELETE\\s+FROM\\s+(${SQL_IDENTIFIER_SOURCE})(?=\\s|$)`, 'i');
  const indexTable = new RegExp(`\\bON\\s+(${SQL_IDENTIFIER_SOURCE})\\s*\\(`, 'i');

  for (const statement of cleaned) {
    const withoutStrings = statement.replace(/'(?:''|[^'])*'/g, "''");
    if (/\b(?:ATTACH|DETACH|VACUUM|REINDEX|PRAGMA|LOAD_EXTENSION|ANALYZE)\b/i.test(withoutStrings)) {
      return 'Одноразовая лаборатория запрещает ATTACH, DETACH, PRAGMA и другие команды, меняющие окружение.';
    }
    if (/^CREATE\s+(?:TEMP|TEMPORARY)\s+(?:TABLE|VIEW|INDEX)\b/i.test(statement)) {
      const created = createTemp.exec(statement);
      if (!created) return 'Используй простое имя для временного объекта лаборатории.';
      if (/^CREATE\s+(?:TEMP|TEMPORARY)\s+INDEX\b/i.test(statement)) {
        const table = target(statement, indexTable);
        if (!table || !tempObjects.has(table)) return 'TEMP INDEX можно создавать только для временной таблицы этого скрипта.';
      }
      continue;
    }
    if (/^CREATE\b/i.test(statement)) return 'Создавай объекты только через CREATE TEMP TABLE, VIEW или INDEX.';

    const mutationTarget = target(statement, insertTarget)
      || target(statement, updateTarget)
      || target(statement, deleteTarget)
      || target(statement, alterTarget)
      || target(statement, dropTarget);
    if (mutationTarget) {
      if (!tempObjects.has(mutationTarget)) return 'Изменять можно только временные объекты, объявленные внутри этого скрипта.';
      continue;
    }
    if (/^WITH\b/i.test(statement) && /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(withoutStrings)) {
      const match = withMutationTarget.exec(withoutStrings);
      const withTarget = match ? normalizedIdentifier(match[1] || match[2] || match[3]) : null;
      if (!withTarget || !tempObjects.has(withTarget)) {
        return 'Изменяющий WITH-запрос должен работать только с явно объявленной временной таблицей.';
      }
      continue;
    }
    if (/^(?:SELECT|WITH|EXPLAIN\s+QUERY\s+PLAN|BEGIN\b|COMMIT\b|END\b|ROLLBACK\b|SAVEPOINT\b|RELEASE\b)/i.test(statement)) continue;
    return 'Команда не входит в безопасный набор одноразовой SQL-лаборатории.';
  }
  return null;
}

function statementPolicyViolation(source: string, contract: TaskEvaluationContract) {
  const cleaned = statements(source).map(statement => statement
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()).filter(Boolean);
  if (contract.statementPolicy.readOnly) {
    if (cleaned.length !== 1) return 'Отправь ровно один читающий запрос.';
    const allowed = contract.statementPolicy.allowExplain
      ? /^(?:SELECT|WITH|EXPLAIN\s+QUERY\s+PLAN\s+(?:SELECT|WITH))\b/i
      : /^(?:SELECT|WITH)\b/i;
    if (!allowed.test(cleaned[0])) return contract.statementPolicy.allowExplain
      ? 'В этой задаче разрешены SELECT, WITH … SELECT или EXPLAIN QUERY PLAN.'
      : 'В этой задаче разрешён только SELECT или WITH … SELECT.';
    const withoutStrings = cleaned[0].replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/g, ' ');
    if (/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i.test(withoutStrings)
      || /\bREPLACE\s+INTO\b/i.test(withoutStrings)) {
      return 'Запрос пытается изменить состояние учебной базы.';
    }
    return null;
  }
  const joined = cleaned.join('; ');
  if (/\b(?:ATTACH|DETACH|VACUUM|REINDEX|DROP)\b/i.test(joined)) return 'Команда выходит за границы одноразовой лаборатории.';
  if (contract.statementPolicy.sandbox === 'transaction-rollback') {
    if (cleaned.length < 4 || !/^BEGIN\b/i.test(cleaned[0]) || !/^ROLLBACK\b/i.test(cleaned.at(-1) || '')) {
      return 'Транзакционная лаборатория требует BEGIN, изменение, контрольный SELECT и завершающий ROLLBACK.';
    }
    if (!cleaned.some(statement => /^(?:INSERT|UPDATE|DELETE)\b/i.test(statement))) {
      return 'Между BEGIN и ROLLBACK должно быть явное изменение данных.';
    }
  } else if (cleaned.length < 2 || !/^CREATE\s+(?:TABLE|INDEX)\b/i.test(cleaned[0])) {
    return 'Лаборатория схемы требует CREATE TABLE/INDEX и отдельный проверочный запрос.';
  }
  return null;
}

function diagnostic(
  contractCode: TaskEvaluationDiagnosticCode,
  fixtureId: string,
  title: string,
  explanation: string,
  nextStep: string,
  kind: AttemptDiagnostic['kind']
): TaskEvaluationDiagnostic {
  return { contractCode, fixtureId, title, explanation, nextStep, kind, confidence: 'certain' };
}

function executeOnFixture(
  engine: TaskSqlEngine,
  source: string,
  fixture: TaskEvaluationFixture,
  contract: TaskEvaluationContract,
  role: 'learner' | 'reference'
) {
  let database: InstanceType<TaskSqlEngine['Database']>;
  try {
    database = new engine.Database();
  } catch (reason) {
    throw new TaskSqlExecutionError('technical', `SQLite engine initialization failed: ${errorMessage(reason)}`, { cause: reason });
  }
  try {
    try {
      database.run(trainingSeedSql);
      if (fixture.setupSql.trim()) database.run(fixture.setupSql);
    } catch (reason) {
      throw new TaskSqlExecutionError('technical', `Fixture ${fixture.id} initialization failed: ${errorMessage(reason)}`, { cause: reason });
    }
    const before = JSON.stringify(contract.postState.tablesUnchanged.map(table =>
      database.exec(`SELECT COUNT(*) AS row_count FROM "${table.replace(/"/g, '""')}";`)
    ));
    try {
      if (contract.statementPolicy.readOnly) database.run('PRAGMA query_only = ON;');
      const output = database.exec(source);
      const after = JSON.stringify(contract.postState.tablesUnchanged.map(table =>
        database.exec(`SELECT COUNT(*) AS row_count FROM "${table.replace(/"/g, '""')}";`)
      ));
      return { output, stateChanged: before !== after };
    } catch (reason) {
      const kind = role === 'learner' ? 'learner' : 'technical';
      const label = role === 'learner' ? 'Learner SQL' : 'Reference SQL';
      throw new TaskSqlExecutionError(kind, `${label} (${fixture.id}): ${errorMessage(reason)}`, { cause: reason });
    }
  } finally {
    try { database.close(); } catch { /* Disposable evaluator databases never own learner evidence. */ }
  }
}

function resultTable(results: QueryExecResult[]) {
  if (results.length !== 1) return null;
  return results[0];
}

function columnTypeMatches(value: unknown, column: TaskEvaluationColumn) {
  if (value === null) return column.nullable;
  if (column.type === 'text') return typeof value === 'string';
  if (column.type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === 'number' && Number.isFinite(value);
}

function sameValue(left: unknown, right: unknown, column: TaskEvaluationColumn) {
  if (left === null || right === null) return left === right;
  if (typeof left !== typeof right) return false;
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) <= (column.numericTolerance ?? 0);
  }
  return left === right;
}

function sameRow(left: unknown[], right: unknown[], columns: TaskEvaluationColumn[]) {
  return left.length === right.length && left.every((value, index) => sameValue(value, right[index], columns[index]));
}

function duplicateCount(rows: unknown[][], columns: TaskEvaluationColumn[]) {
  let duplicates = 0;
  const consumed = new Set<number>();
  for (let left = 0; left < rows.length; left += 1) {
    if (consumed.has(left)) continue;
    for (let right = left + 1; right < rows.length; right += 1) {
      if (sameRow(rows[left], rows[right], columns)) {
        consumed.add(right);
        duplicates += 1;
      }
    }
  }
  return duplicates;
}

function unorderedRowsMatch(actual: unknown[][], expected: unknown[][], columns: TaskEvaluationColumn[]) {
  if (actual.length !== expected.length) return false;
  const used = new Set<number>();
  for (const row of expected) {
    const index = actual.findIndex((candidate, candidateIndex) => !used.has(candidateIndex) && sameRow(candidate, row, columns));
    if (index < 0) return false;
    used.add(index);
  }
  return true;
}

function compareFixture(
  contract: TaskEvaluationContract,
  fixture: TaskEvaluationFixture,
  actualResults: QueryExecResult[],
  expectedResults: QueryExecResult[]
): TaskEvaluationDiagnostic | null {
  const actual = resultTable(actualResults);
  const expected = resultTable(expectedResults);
  if (!actual && expected) {
    return diagnostic('wrong-row-count', fixture.id, 'Неверное число строк', `На fixture «${fixture.label}» запрос не вернул строк, ожидается ${expected.values.length}.`, 'Проверь фильтр и гранулярность результата.', 'row-set');
  }
  if (!actual || !expected) {
    return diagnostic('wrong-columns', fixture.id, 'Неверная форма результата', 'Контракт ожидает один табличный результат.', 'Верни один SELECT с указанными столбцами.', 'result-shape');
  }
  const actualColumns = actual.columns.map(column => column.toLowerCase());
  const contractColumns = contract.columns.map(column => column.name.toLowerCase());
  if (actualColumns.length !== contractColumns.length || actualColumns.some((column, index) => column !== contractColumns[index])) {
    return diagnostic('wrong-columns', fixture.id, 'Неверные столбцы', `Ожидаются столбцы: ${contract.columns.map(column => column.name).join(', ')}.`, 'Проверь SELECT-список, порядок столбцов и алиасы.', 'result-shape');
  }
  if (actual.values.some(row => row.some((value, index) => !columnTypeMatches(value, contract.columns[index])))) {
    return diagnostic('wrong-types', fixture.id, 'Неверный тип значения', 'Результат смешивает число, текст или NULL не так, как объявлено в контракте.', 'Не преобразуй значения в строки и сохрани смысл NULL.', 'values');
  }
  if (actual.values.length !== expected.values.length) {
    return diagnostic('wrong-row-count', fixture.id, 'Неверное число строк', `На fixture «${fixture.label}» получено ${actual.values.length}, ожидается ${expected.values.length}.`, 'Проверь фильтр и гранулярность результата.', 'row-set');
  }
  if (contract.duplicatePolicy === 'preserve'
    && duplicateCount(actual.values, contract.columns) !== duplicateCount(expected.values, contract.columns)) {
    return diagnostic('wrong-duplicates', fixture.id, 'Потеряны или добавлены дубли', 'Контракт требует сохранить кратность одинаковых строк.', 'Убери случайный DISTINCT или проверь размножение строк.', 'row-set');
  }
  if (contract.duplicatePolicy === 'distinct' && duplicateCount(actual.values, contract.columns) > 0) {
    return diagnostic('wrong-duplicates', fixture.id, 'Результат содержит дубли', 'Контракт требует уникальный набор строк.', 'Устрани причину дублей или используй DISTINCT, если это соответствует условию.', 'row-set');
  }
  const rowsMatch = contract.order.kind === 'ordered'
    ? actual.values.every((row, index) => sameRow(row, expected.values[index], contract.columns))
    : unorderedRowsMatch(actual.values, expected.values, contract.columns);
  if (rowsMatch) return null;
  const actualNulls = actual.values.flat().filter(value => value === null).length;
  const expectedNulls = expected.values.flat().filter(value => value === null).length;
  if (actualNulls !== expectedNulls) {
    return diagnostic('wrong-null-semantics', fixture.id, 'Неверная семантика NULL', `Количество NULL отличается: ${actualNulls} вместо ${expectedNulls}.`, 'Проверь IS NULL / IS NOT NULL и не подменяй отсутствие значения строкой.', 'null-filter');
  }
  if (contract.order.kind === 'ordered'
    && unorderedRowsMatch(actual.values, expected.values, contract.columns)) {
    return diagnostic('wrong-order', fixture.id, 'Нестабильный порядок', 'Набор строк верный, но порядок или tie-breaker не соответствует контракту.', 'Проверь все ключи ORDER BY и их направления.', 'ordering');
  }
  return diagnostic('wrong-values', fixture.id, 'Неверные значения', 'Форма результата верна, но значения не соответствуют смыслу задачи.', 'Проверь выражения и условия на контрпримере fixture.', 'values');
}

function comparableFallback(results: QueryExecResult[]) {
  return JSON.stringify(results.map(block => ({
    columns: block.columns.map(column => column.toLowerCase()),
    values: block.values
  })));
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function comparableTempState(database: InstanceType<TaskSqlEngine['Database']>) {
  const catalog = database.exec("SELECT type, name FROM sqlite_temp_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name;");
  const rows = catalog[0]?.values || [];
  const objects = rows.map(row => {
    const type = String(row[0]);
    const name = String(row[1]);
    const info = database.exec(`PRAGMA temp.table_info(${quoteIdentifier(name)});`);
    const output = database.exec(`SELECT * FROM temp.${quoteIdentifier(name)};`);
    const values = (output[0]?.values || []).map(item => [...item]);
    values.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return {
      type,
      name: name.toLowerCase(),
      columns: (info[0]?.values || []).map(column => [column[1], column[2], column[3], column[4], column[5]]),
      values
    };
  });
  return JSON.stringify(objects);
}

function executeDisposableScript(engine: TaskSqlEngine, source: string, role: 'learner' | 'reference') {
  let database: InstanceType<TaskSqlEngine['Database']>;
  try {
    database = new engine.Database();
  } catch (reason) {
    throw new TaskSqlExecutionError('technical', `SQLite engine initialization failed: ${errorMessage(reason)}`, { cause: reason });
  }
  try {
    try {
      database.run(trainingSeedSql);
    } catch (reason) {
      throw new TaskSqlExecutionError('technical', `Disposable lab initialization failed: ${errorMessage(reason)}`, { cause: reason });
    }
    try {
      const output = database.exec(source);
      return { output, tempState: comparableTempState(database) };
    } catch (reason) {
      const kind = role === 'learner' ? 'learner' : 'technical';
      const label = role === 'learner' ? 'Learner SQL' : 'Reference SQL';
      throw new TaskSqlExecutionError(kind, `${label} (disposable-lab): ${errorMessage(reason)}`, { cause: reason });
    }
  } finally {
    try { database.close(); } catch { /* Every advanced script runs in its own disposable database. */ }
  }
}

function evaluateDisposableScript(engine: TaskSqlEngine, task: SqlTask, source: string): TaskEvaluationResult {
  const policyViolation = disposableScriptPolicyViolation(source);
  if (policyViolation) {
    return {
      correct: false,
      output: [],
      diagnostic: diagnostic('unsafe-mutation', 'disposable-lab', 'Небезопасный скрипт', policyViolation, 'Оставь изменения внутри явно созданных TEMP-объектов.', 'runtime'),
      evidence: null
    };
  }
  const referenceViolation = disposableScriptPolicyViolation(task.solution);
  if (referenceViolation) {
    throw new TaskSqlExecutionError('technical', `Reference SQL violates disposable lab policy: ${referenceViolation}`);
  }

  let learner;
  try {
    learner = executeDisposableScript(engine, source, 'learner');
  } catch (reason) {
    if (reason instanceof TaskSqlExecutionError && reason.kind === 'technical') throw reason;
    const message = errorMessage(reason);
    const syntax = /syntax|incomplete input|near /i.test(message);
    return {
      correct: false,
      output: [],
      diagnostic: diagnostic(
        syntax ? 'syntax-error' : 'runtime-error',
        'disposable-lab',
        syntax ? 'Синтаксическая ошибка' : 'Ошибка выполнения',
        message,
        syntax ? 'Проверь ключевые слова, запятые, скобки и порядок команд.' : 'Проверь имена временных объектов и порядок шагов лаборатории.',
        syntax ? 'syntax' : 'runtime'
      ),
      evidence: null
    };
  }
  const reference = executeDisposableScript(engine, task.solution, 'reference');
  if (comparableFallback(learner.output) !== comparableFallback(reference.output)) {
    return {
      correct: false,
      output: learner.output,
      diagnostic: diagnostic('wrong-values', 'disposable-lab-output', 'Неверный итог лаборатории', 'Табличный результат отличается от контрольного результата.', 'Проверь последовательность шагов и финальный SELECT.', 'values'),
      evidence: null
    };
  }
  if (learner.tempState !== reference.tempState) {
    return {
      correct: false,
      output: learner.output,
      diagnostic: diagnostic('wrong-values', 'disposable-lab-state', 'Неверное состояние лаборатории', 'Временные таблицы или их итоговые данные отличаются от контрольного состояния.', 'Проверь CREATE TEMP, изменения и откат до финальной проверки.', 'runtime'),
      evidence: null
    };
  }
  return { correct: true, output: learner.output, diagnostic: null, evidence: null };
}

export function executeTaskSql(engine: TaskSqlEngine, source: string, role: 'learner' | 'reference' = 'learner') {
  const fallbackContract: TaskEvaluationContract = {
    version: TASK_EVALUATION_CONTRACT_VERSION,
    id: 'legacy-single-seed',
    taskId: 'legacy',
    columns: [],
    duplicatePolicy: 'preserve',
    nullPolicy: 'preserve',
    order: { kind: 'ordered', keys: [], completeTieBreak: true },
    statementPolicy: { readOnly: true, singleStatement: true },
    postState: { tablesUnchanged: ['tickets'] },
    fixtures: [{ id: 'public-base', label: 'Открытый учебный набор', visibility: 'public', setupSql: '' }],
    requiredConcepts: []
  };
  return executeOnFixture(engine, source, fallbackContract.fixtures[0], fallbackContract, role).output;
}

export function evaluateTaskSql(
  engine: TaskSqlEngine,
  task: SqlTask,
  source: string,
  _surface: TaskEvaluationSurface
): TaskEvaluationResult {
  if (task.evaluationPolicy === 'disposable-script') return evaluateDisposableScript(engine, task, source);
  const contract = task.evaluationContractId ? taskEvaluationContract(task.evaluationContractId) : null;
  if (!contract) {
    const output = executeTaskSql(engine, source, 'learner');
    const expected = executeTaskSql(engine, task.solution, 'reference');
    return { correct: comparableFallback(output) === comparableFallback(expected), output, diagnostic: null, evidence: null };
  }
  const policyViolation = statementPolicyViolation(source, contract);
  if (policyViolation) {
    return {
      correct: false,
      output: [],
      diagnostic: diagnostic('unsafe-mutation', contract.fixtures[0].id, 'Небезопасный запрос', policyViolation, 'Оставь один читающий SELECT-запрос.', 'runtime'),
      evidence: null
    };
  }
  let publicOutput: QueryExecResult[] = [];
  for (const fixture of contract.fixtures) {
    let learner;
    try {
      learner = executeOnFixture(engine, source, fixture, contract, 'learner');
    } catch (reason) {
      if (reason instanceof TaskSqlExecutionError && reason.kind === 'technical') throw reason;
      const message = errorMessage(reason);
      const syntax = /syntax|incomplete input|near /i.test(message);
      return {
        correct: false,
        output: publicOutput,
        diagnostic: diagnostic(
          syntax ? 'syntax-error' : 'runtime-error',
          fixture.id,
          syntax ? 'Синтаксическая ошибка' : 'Ошибка выполнения',
          message,
          syntax ? 'Проверь ключевые слова, запятые, скобки и порядок частей запроса.' : 'Проверь имена таблиц, столбцов и допустимые операции.',
          syntax ? 'syntax' : 'runtime'
        ),
        evidence: null
      };
    }
    if (fixture.visibility === 'public') publicOutput = learner.output;
    if (learner.stateChanged) {
      return { correct: false, output: publicOutput, diagnostic: diagnostic('post-state-changed', fixture.id, 'Изменено состояние базы', 'SELECT-задача не должна менять учебные таблицы.', 'Удали изменяющие операции.', 'runtime'), evidence: null };
    }
    const reference = executeOnFixture(engine, task.solution, fixture, contract, 'reference');
    const difference = compareFixture(contract, fixture, learner.output, reference.output);
    if (difference) return { correct: false, output: publicOutput, diagnostic: difference, evidence: null };
  }
  return {
    correct: true,
    output: publicOutput,
    diagnostic: null,
    evidence: {
      contractId: contract.id,
      contractVersion: contract.version,
      evidenceContractVersion: FOUNDATION_EVIDENCE_CONTRACT_VERSION,
      fixtureIds: contract.fixtures.map(fixture => fixture.id),
      hiddenFixtureIds: contract.fixtures.filter(fixture => fixture.visibility !== 'public').map(fixture => fixture.id)
    }
  };
}
