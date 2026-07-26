import type { QueryExecResult, SqlJsStatic } from 'sql.js';
import {
  capstoneContract,
  type CapstoneCheckKind,
  type CapstoneDatasetVariant,
  type CapstoneEvaluationContract,
  type CapstoneFileContract
} from '../data/capstone-contracts';
import { trainingSeedSql } from '../data/training-dataset';

export type CapstoneReportStatus = 'passed' | 'failed';
export type CapstoneProvenance = 'independent' | 'guided' | 'solution-assisted';

export interface CapstoneSubmission {
  projectId: string;
  files: Record<string, string>;
  reflection: string;
  startedAt: string;
  guidanceUses: number;
  solutionViews: number;
}

export interface CapstoneCheckResult {
  id: string;
  fileId: string | null;
  datasetId: string | null;
  kind: CapstoneCheckKind;
  title: string;
  passed: boolean;
  score: number;
  maxScore: number;
  message: string;
  remediation: string | null;
  hidden: boolean;
}

export interface CapstoneFileEvidence {
  fileId: string;
  title: string;
  kind: CapstoneFileContract['kind'];
  passed: boolean;
  score: number;
  maxScore: number;
  checks: string[];
}

export interface CapstoneReport {
  version: 1;
  id: string;
  userId: string;
  projectId: string;
  status: CapstoneReportStatus;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  attemptNumber: number;
  score: number;
  bestScore: number;
  passingScore: number;
  passed: boolean;
  provenance: CapstoneProvenance;
  independence: number;
  guidanceUses: number;
  solutionViews: number;
  files: CapstoneFileEvidence[];
  submissionFiles: Record<string, string>;
  checks: CapstoneCheckResult[];
  reflection: string;
  remediation: string[];
}

type SqlTable = { columns: string[]; values: unknown[][] };

type EvaluationContext = {
  SQL: SqlJsStatic;
  contract: CapstoneEvaluationContract;
  submission: CapstoneSubmission;
};

const MUTATING_SQL = /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP\s+TABLE|CREATE\s+TABLE|TRUNCATE|ATTACH|DETACH|VACUUM|PRAGMA\s+(?!query_only\b))\b/i;
const SCHEMA_FORBIDDEN = /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP\s+TABLE|CREATE\s+TABLE|TRUNCATE|ATTACH|DETACH|VACUUM)\b/i;

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function durationSeconds(startedAt: string, completedAt: string) {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.min(86_400, Math.round((end - start) / 1000)));
}

function normalizedValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(6));
  if (value === null) return null;
  return String(value);
}

function normalizeTable(table: SqlTable | null) {
  if (!table) return null;
  return {
    columns: table.columns.map(column => column.trim().toLowerCase()),
    values: table.values.map(row => row.map(normalizedValue))
  };
}

function lastTable(results: QueryExecResult[]): SqlTable | null {
  const result = results.at(-1);
  if (!result) return null;
  return { columns: [...result.columns], values: result.values.map(row => [...row]) };
}

function sameTable(left: SqlTable | null, right: SqlTable | null) {
  return JSON.stringify(normalizeTable(left)) === JSON.stringify(normalizeTable(right));
}

function requiredColumnsPresent(table: SqlTable | null, required: string[] = []) {
  if (!table) return false;
  const actual = table.columns.map(column => column.trim().toLowerCase());
  return required.every((column, index) => actual[index] === column.toLowerCase());
}

function safeSql(file: CapstoneFileContract, sql: string) {
  if (!sql.trim()) return { ok: false, message: 'SQL-файл пуст.' };
  if (sql.length > 40_000) return { ok: false, message: 'SQL-файл превышает 40 000 символов.' };
  if (file.kind === 'query' && MUTATING_SQL.test(sql)) {
    return { ok: false, message: 'Query artifact должен быть read-only.' };
  }
  if (file.kind === 'plan' && (!/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*EXPLAIN\s+QUERY\s+PLAN\b/i.test(sql) || MUTATING_SQL.test(sql))) {
    return { ok: false, message: 'Plan artifact должен начинаться с EXPLAIN QUERY PLAN и не изменять данные.' };
  }
  if (file.kind === 'schema' && SCHEMA_FORBIDDEN.test(sql)) {
    return { ok: false, message: 'Schema artifact не должен изменять или удалять исходные таблицы/строки.' };
  }
  return { ok: true, message: '' };
}

function database(SQL: SqlJsStatic, dataset: CapstoneDatasetVariant) {
  const db = new SQL.Database();
  db.run(trainingSeedSql);
  if (dataset.appendSql.trim()) db.run(dataset.appendSql);
  return db;
}

function fileCheckKind(file: CapstoneFileContract, dataset: CapstoneDatasetVariant): CapstoneCheckKind {
  if (dataset.hidden) return 'hidden-data';
  if (file.kind === 'schema') return 'schema-invariant';
  if (file.kind === 'plan') return 'plan-shape';
  return 'result-contract';
}

function failedFileCheck(file: CapstoneFileContract, dataset: CapstoneDatasetVariant, maxScore: number, message: string): CapstoneCheckResult {
  return {
    id: `${file.id}:${dataset.id}`,
    fileId: file.id,
    datasetId: dataset.id,
    kind: fileCheckKind(file, dataset),
    title: `${file.title} · ${dataset.title}`,
    passed: false,
    score: 0,
    maxScore,
    message,
    remediation: file.remediation,
    hidden: dataset.hidden
  };
}

function passedFileCheck(file: CapstoneFileContract, dataset: CapstoneDatasetVariant, maxScore: number, message: string): CapstoneCheckResult {
  return {
    id: `${file.id}:${dataset.id}`,
    fileId: file.id,
    datasetId: dataset.id,
    kind: fileCheckKind(file, dataset),
    title: `${file.title} · ${dataset.title}`,
    passed: true,
    score: maxScore,
    maxScore,
    message,
    remediation: null,
    hidden: dataset.hidden
  };
}

function evaluatePlan(table: SqlTable | null, sql: string) {
  if (!table || !requiredColumnsPresent(table, ['id', 'parent', 'notused', 'detail'])) {
    return { passed: false, message: 'EXPLAIN не вернул ожидаемый SQLite plan contract.' };
  }
  const details = table.values.map(row => String(row[3] ?? '')).join(' ').toLowerCase();
  const filtersPresent = /\bservice\b/i.test(sql) && /\bstatus\b/i.test(sql);
  const indexed = /search\s+tickets\s+using\s+(?:covering\s+)?index/.test(details);
  if (!filtersPresent) return { passed: false, message: 'Plan query не содержит оба операционных фильтра: service и status.' };
  if (!indexed) return { passed: false, message: 'SQLite plan не показывает индексный SEARCH по tickets.' };
  return { passed: true, message: 'EXPLAIN подтверждает индексный SEARCH и нужные фильтры.' };
}

async function evaluateFileDataset(context: EvaluationContext, file: CapstoneFileContract, dataset: CapstoneDatasetVariant, maxScore: number) {
  const learnerSql = context.submission.files[file.id] || '';
  const safety = safeSql(file, learnerSql);
  if (!safety.ok) return failedFileCheck(file, dataset, maxScore, safety.message);

  const learnerDb = database(context.SQL, dataset);
  let learnerTable: SqlTable | null = null;
  try {
    const learnerResults = learnerDb.exec(learnerSql);
    learnerTable = file.kind === 'schema' && file.postValidationSql
      ? lastTable(learnerDb.exec(file.postValidationSql))
      : lastTable(learnerResults);
  } catch (reason) {
    learnerDb.close();
    return failedFileCheck(file, dataset, maxScore, `SQLite: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  learnerDb.close();

  if (!requiredColumnsPresent(learnerTable, file.requiredColumns)) {
    return failedFileCheck(file, dataset, maxScore, `Неверный result contract. Нужны столбцы: ${(file.requiredColumns || []).join(', ')}.`);
  }

  if (file.kind === 'plan') {
    const plan = evaluatePlan(learnerTable, learnerSql);
    return plan.passed
      ? passedFileCheck(file, dataset, maxScore, plan.message)
      : failedFileCheck(file, dataset, maxScore, plan.message);
  }

  if (!file.referenceSql) {
    return failedFileCheck(file, dataset, maxScore, 'Для artifact отсутствует reference contract.');
  }
  const referenceDb = database(context.SQL, dataset);
  let referenceTable: SqlTable | null = null;
  try {
    referenceTable = lastTable(referenceDb.exec(file.referenceSql));
  } catch (reason) {
    referenceDb.close();
    return failedFileCheck(file, dataset, maxScore, `Reference contract invalid: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  referenceDb.close();

  if (!sameTable(learnerTable, referenceTable)) {
    return failedFileCheck(
      file,
      dataset,
      maxScore,
      dataset.hidden
        ? 'Hidden dataset нарушил значения, строки или стабильный порядок результата.'
        : 'Результат не совпал с public contract по значениям, строкам или порядку.'
    );
  }
  return passedFileCheck(file, dataset, maxScore, dataset.hidden ? 'Hidden edge cases пройдены.' : 'Public result contract совпал.');
}

function evaluateReflection(contract: CapstoneEvaluationContract, reflection: string): CapstoneCheckResult {
  const normalized = reflection.trim().toLowerCase();
  const ideas = contract.reflection.requiredIdeas.filter(idea =>
    idea.keywords.some(keyword => normalized.includes(keyword.toLowerCase()))
  );
  const lengthRatio = Math.min(1, normalized.length / contract.reflection.minimumCharacters);
  const ideaRatio = ideas.length / Math.max(1, contract.reflection.requiredIdeas.length);
  const ratio = Math.min(lengthRatio, ideaRatio);
  const score = Math.round(contract.reflection.weight * ratio);
  const passed = lengthRatio >= 1 && ideaRatio >= 0.75;
  const missing = contract.reflection.requiredIdeas.filter(idea => !ideas.some(found => found.id === idea.id));
  return {
    id: `${contract.projectId}:reflection`,
    fileId: null,
    datasetId: null,
    kind: 'reflection',
    title: contract.reflection.title,
    passed,
    score,
    maxScore: contract.reflection.weight,
    message: passed
      ? 'Self-reflection фиксирует ключевые ограничения результата.'
      : `Нужно не менее ${contract.reflection.minimumCharacters} символов и идеи: ${missing.map(item => item.label).join(', ') || 'расширь объяснение'}.`,
    remediation: passed ? null : contract.reflection.prompt,
    hidden: false
  };
}

function provenance(guidanceUses: number, solutionViews: number) {
  if (solutionViews > 0) return 'solution-assisted' as const;
  if (guidanceUses > 0) return 'guided' as const;
  return 'independent' as const;
}

function independence(guidanceUses: number, solutionViews: number) {
  return clamp(100 - Math.min(40, guidanceUses * 10) - Math.min(80, solutionViews * 50));
}

export async function evaluateCapstone(input: {
  SQL: SqlJsStatic;
  submission: CapstoneSubmission;
  userId?: string;
  attemptNumber?: number;
  bestScore?: number;
  completedAt?: string;
}): Promise<CapstoneReport> {
  const contract = capstoneContract(input.submission.projectId);
  if (!contract) throw new Error(`Unknown capstone project ${input.submission.projectId}`);
  const context: EvaluationContext = { SQL: input.SQL, contract, submission: input.submission };
  const checks: CapstoneCheckResult[] = [];

  for (const file of contract.files) {
    const datasetScore = file.weight / Math.max(1, contract.datasets.length);
    for (const dataset of contract.datasets) {
      checks.push(await evaluateFileDataset(context, file, dataset, datasetScore));
    }
  }
  checks.push(evaluateReflection(contract, input.submission.reflection));

  const completedAt = input.completedAt || new Date().toISOString();
  const score = clamp(checks.reduce((sum, check) => sum + check.score, 0));
  const fileEvidence = contract.files.map(file => {
    const fileChecks = checks.filter(check => check.fileId === file.id);
    return {
      fileId: file.id,
      title: file.title,
      kind: file.kind,
      passed: fileChecks.length > 0 && fileChecks.every(check => check.passed),
      score: clamp(fileChecks.reduce((sum, check) => sum + check.score, 0)),
      maxScore: file.weight,
      checks: fileChecks.map(check => check.id)
    } satisfies CapstoneFileEvidence;
  });
  const reflectionCheck = checks.find(check => check.kind === 'reflection');
  const independentScore = independence(input.submission.guidanceUses, input.submission.solutionViews);
  const passed = score >= contract.passingScore
    && fileEvidence.every(file => file.passed)
    && Boolean(reflectionCheck?.passed)
    && independentScore >= 60;
  const remediation = checks
    .filter(check => !check.passed && check.remediation)
    .map(check => check.remediation!)
    .filter((item, index, values) => values.indexOf(item) === index);
  const submissionFiles = Object.fromEntries(contract.files.map(file => [
    file.id,
    (input.submission.files[file.id] || '').slice(0, 40_000)
  ]));

  return {
    version: 1,
    id: crypto.randomUUID(),
    userId: input.userId || 'local',
    projectId: contract.projectId,
    status: passed ? 'passed' : 'failed',
    startedAt: input.submission.startedAt,
    completedAt,
    durationSeconds: durationSeconds(input.submission.startedAt, completedAt),
    attemptNumber: Math.max(1, input.attemptNumber || 1),
    score,
    bestScore: Math.max(score, input.bestScore || 0),
    passingScore: contract.passingScore,
    passed,
    provenance: provenance(input.submission.guidanceUses, input.submission.solutionViews),
    independence: independentScore,
    guidanceUses: Math.max(0, input.submission.guidanceUses),
    solutionViews: Math.max(0, input.submission.solutionViews),
    files: fileEvidence,
    submissionFiles,
    checks,
    reflection: input.submission.reflection.slice(0, 12_000),
    remediation
  };
}

export function bestCapstoneReport(projectId: string, reports: CapstoneReport[]) {
  return reports
    .filter(report => report.projectId === projectId && report.status === 'passed' && report.passed)
    .sort((left, right) => right.score - left.score || right.completedAt.localeCompare(left.completedAt))[0] || null;
}

export function passedCapstoneReports(reports: CapstoneReport[]) {
  return reports.filter(report => report.status === 'passed' && report.passed);
}
