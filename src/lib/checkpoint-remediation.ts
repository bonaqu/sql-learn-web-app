import { curriculumCheckpoints } from '../data/complete-curriculum';
import { modules, tasks } from '../data/course-catalog';
import { phaseDefinitions } from '../data/learning-structure';
import {
  hasIndependentTaskEvidence,
  type Progress
} from './progress';

export type CheckpointRemediationModule = {
  moduleId: string;
  moduleTitle: string;
  score: number;
  weakTaskIds: string[];
};

export type CheckpointRemediationState = {
  checkpointId: string;
  checkpointTitle: string;
  phaseId: string;
  phaseTitle: string;
  reportId: string;
  completedAt: string;
  attemptNumber: number;
  score: number;
  passingScore: number;
  modules: CheckpointRemediationModule[];
};

type RawRecord = Record<string, unknown>;

const checkpointMap = new Map(curriculumCheckpoints.map(checkpoint => [checkpoint.id, checkpoint]));
const moduleTitles = new Map(modules.map(([id, title]) => [id, title]));
const knownTaskIds = new Set(tasks.map(task => task.id));

function record(value: unknown): RawRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RawRecord
    : null;
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedScore(value: unknown) {
  return Math.min(100, Math.max(0, Math.round(finiteNumber(value))));
}

function validCompletedAt(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function phaseForCheckpoint(checkpointId: string) {
  const checkpoint = checkpointMap.get(checkpointId);
  if (!checkpoint) return null;
  const checkpointModules = new Set<string>(checkpoint.moduleIds);
  return phaseDefinitions.find(phase =>
    phase.moduleIds.some(moduleId => checkpointModules.has(moduleId))
  ) || null;
}

function moduleScoreMap(value: unknown, allowed: ReadonlySet<string>) {
  const result = new Map<string, number>();
  if (!Array.isArray(value)) return result;
  for (const candidate of value) {
    const item = record(candidate);
    if (!item || typeof item.module !== 'string' || !allowed.has(item.module)) continue;
    const score = boundedScore(item.score);
    const previous = result.get(item.module);
    if (previous === undefined || score < previous) result.set(item.module, score);
  }
  return result;
}

function weakTaskMap(value: unknown, checkpointTaskIds: ReadonlySet<string>, allowedModules: ReadonlySet<string>) {
  const result = new Map<string, Array<{ taskId: string; score: number }>>();
  if (!Array.isArray(value)) return result;
  for (const candidate of value) {
    const item = record(candidate);
    if (!item
      || typeof item.taskId !== 'string'
      || !knownTaskIds.has(item.taskId)
      || !checkpointTaskIds.has(item.taskId)
      || typeof item.module !== 'string'
      || !allowedModules.has(item.module)) continue;
    const weak = item.correct !== true || item.skipped === true || boundedScore(item.score) < 70;
    if (!weak) continue;
    result.set(item.module, [
      ...(result.get(item.module) || []),
      { taskId: item.taskId, score: boundedScore(item.score) }
    ]);
  }
  return result;
}

function normalizedReport(value: unknown, userId: string) {
  const item = record(value);
  if (!item
    || item.version !== 1
    || item.userId !== userId
    || item.status !== 'completed'
    || typeof item.id !== 'string'
    || typeof item.checkpointId !== 'string'
    || !checkpointMap.has(item.checkpointId)) return null;
  const completedAt = validCompletedAt(item.completedAt);
  if (!completedAt) return null;
  return {
    raw: item,
    id: item.id,
    checkpointId: item.checkpointId,
    completedAt,
    passed: item.passed === true,
    score: boundedScore(item.score),
    passingScore: boundedScore(item.passingScore),
    attemptNumber: Math.max(1, Math.round(finiteNumber(item.attemptNumber, 1)))
  };
}

export function checkpointRemediationsFromReports(
  reports: unknown,
  userId: string | null
): CheckpointRemediationState[] {
  if (!userId || !Array.isArray(reports)) return [];
  const valid = reports
    .map(report => normalizedReport(report, userId))
    .filter((report): report is NonNullable<typeof report> => Boolean(report));
  const byCheckpoint = new Map<string, typeof valid>();
  for (const report of valid) {
    byCheckpoint.set(report.checkpointId, [
      ...(byCheckpoint.get(report.checkpointId) || []),
      report
    ]);
  }

  const states: CheckpointRemediationState[] = [];
  for (const [checkpointId, attempts] of byCheckpoint) {
    if (attempts.some(attempt => attempt.passed)) continue;
    const latest = [...attempts].sort((left, right) =>
      right.completedAt.localeCompare(left.completedAt)
      || right.attemptNumber - left.attemptNumber
      || right.id.localeCompare(left.id)
    )[0];
    if (!latest) continue;
    const checkpoint = checkpointMap.get(checkpointId);
    const phase = phaseForCheckpoint(checkpointId);
    if (!checkpoint || !phase) continue;

    const allowedModules = new Set<string>(checkpoint.moduleIds);
    const checkpointModuleOrder = new Map<string, number>(
      checkpoint.moduleIds.map((moduleId, index) => [moduleId, index])
    );
    const checkpointTaskIds = new Set<string>(checkpoint.taskIds);
    const scores = moduleScoreMap(latest.raw.moduleScores, allowedModules);
    const weakTasks = weakTaskMap(latest.raw.taskScores, checkpointTaskIds, allowedModules);
    const requested = Array.isArray(latest.raw.remediationModules)
      ? latest.raw.remediationModules.filter((moduleId): moduleId is string =>
          typeof moduleId === 'string' && allowedModules.has(moduleId)
        )
      : [];
    const derived = checkpoint.moduleIds.filter(moduleId => (scores.get(moduleId) ?? 100) < 70);
    const fallback = [...checkpoint.moduleIds]
      .sort((left, right) =>
        (scores.get(left) ?? 100) - (scores.get(right) ?? 100)
        || (checkpointModuleOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
          - (checkpointModuleOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
      )[0];
    const targetModules = Array.from(new Set(
      requested.length ? requested : derived.length ? derived : fallback ? [fallback] : []
    )).filter(moduleId => allowedModules.has(moduleId));

    const remediationModules = targetModules
      .map(moduleId => ({
        moduleId,
        moduleTitle: moduleTitles.get(moduleId) || moduleId,
        score: scores.get(moduleId) ?? latest.score,
        weakTaskIds: Array.from(new Set((weakTasks.get(moduleId) || [])
          .sort((left, right) => left.score - right.score || left.taskId.localeCompare(right.taskId))
          .map(item => item.taskId)))
      }))
      .sort((left, right) =>
        left.score - right.score
        || (checkpointModuleOrder.get(left.moduleId) ?? Number.MAX_SAFE_INTEGER)
          - (checkpointModuleOrder.get(right.moduleId) ?? Number.MAX_SAFE_INTEGER)
        || left.moduleId.localeCompare(right.moduleId)
      );
    if (!remediationModules.length) continue;

    states.push({
      checkpointId,
      checkpointTitle: checkpoint.title,
      phaseId: phase.id,
      phaseTitle: phase.title,
      reportId: latest.id,
      completedAt: latest.completedAt,
      attemptNumber: latest.attemptNumber,
      score: latest.score,
      passingScore: latest.passingScore || checkpoint.passingScore,
      modules: remediationModules
    });
  }

  return states.sort((left, right) =>
    phaseDefinitions.findIndex(phase => phase.id === left.phaseId)
    - phaseDefinitions.findIndex(phase => phase.id === right.phaseId)
    || left.completedAt.localeCompare(right.completedAt)
    || left.checkpointId.localeCompare(right.checkpointId)
  );
}

function independentAfter(progress: Progress, taskId: string, completedAt: string) {
  if (!hasIndependentTaskEvidence(progress, taskId)) return false;
  const lastIndependentAt = progress.taskStats[taskId]?.lastIndependentAt;
  return typeof lastIndependentAt === 'string'
    && Number.isFinite(Date.parse(lastIndependentAt))
    && lastIndependentAt > completedAt;
}

export function checkpointRemediationModuleRepaired(
  state: CheckpointRemediationState,
  moduleId: string,
  progress: Progress
) {
  const module = state.modules.find(item => item.moduleId === moduleId);
  if (!module) return true;
  const taskIds = module.weakTaskIds.length
    ? module.weakTaskIds
    : tasks
        .filter(task => task.module === moduleId && task.mode === 'practice')
        .map(task => task.id);
  return taskIds.length > 0
    && taskIds.every(taskId => independentAfter(progress, taskId, state.completedAt));
}

export function unresolvedCheckpointRemediationModules(
  state: CheckpointRemediationState,
  progress: Progress
) {
  return state.modules.filter(module =>
    !checkpointRemediationModuleRepaired(state, module.moduleId, progress)
  );
}

export function nextCheckpointRemediationTaskId(
  state: CheckpointRemediationState,
  moduleId: string,
  progress: Progress
) {
  const module = state.modules.find(item => item.moduleId === moduleId);
  if (!module) return null;
  const candidates = module.weakTaskIds.length
    ? module.weakTaskIds
    : tasks
        .filter(task => task.module === moduleId && task.mode === 'practice')
        .map(task => task.id);
  return candidates.find(taskId => !independentAfter(progress, taskId, state.completedAt)) || null;
}
