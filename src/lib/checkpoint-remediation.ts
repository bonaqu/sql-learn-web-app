import { curriculumCheckpoints } from '../data/complete-curriculum';
import { modules, tasks } from '../data/course-catalog';
import { phaseDefinitions } from '../data/learning-structure';
import {
  checkpointAttemptSnapshotFromReports,
  type CheckpointAttemptSnapshot
} from './checkpoint-attempt-policy';
import {
  hasIndependentTaskEvidence,
  type Progress
} from './progress';

export type CheckpointRemediationModule = {
  moduleId: string;
  moduleTitle: string;
  score: number;
  weakTaskIds: string[];
  discriminatingTaskId: string;
  transferTaskId: string;
};

export type CheckpointRemediationStep = {
  kind: 'discriminating' | 'transfer';
  taskId: string;
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

function remediationTaskPair(
  moduleId: string,
  checkpointTaskIds: ReadonlySet<string>,
  attemptNumber: number
) {
  const available = tasks
    .filter(task => task.module === moduleId && !checkpointTaskIds.has(task.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const discriminating = available.filter(task => task.mode === 'practice');
  const transfer = available.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
  if (!discriminating.length || !transfer.length) {
    throw new Error(`Checkpoint remediation requires distinct practice and transfer tasks for ${moduleId}.`);
  }
  const rotation = Math.max(0, attemptNumber - 1);
  return {
    discriminatingTaskId: discriminating[rotation % discriminating.length].id,
    transferTaskId: transfer[rotation % transfer.length].id
  };
}

export function checkpointRemediationsFromAttemptSnapshot(
  snapshot: CheckpointAttemptSnapshot
): CheckpointRemediationState[] {
  const states: CheckpointRemediationState[] = [];
  for (const attemptState of snapshot.states) {
    const latest = attemptState.currentAttempt;
    if (latest.passed) continue;
    const checkpoint = checkpointMap.get(latest.checkpointId);
    const phase = phaseForCheckpoint(latest.checkpointId);
    if (!checkpoint || !phase) continue;

    const allowedModules = new Set<string>(checkpoint.moduleIds);
    const checkpointModuleOrder = new Map<string, number>(
      checkpoint.moduleIds.map((moduleId, index) => [moduleId, index])
    );
    const checkpointTaskIds = new Set<string>(checkpoint.taskIds);
    const scores = moduleScoreMap(latest.source.moduleScores, allowedModules);
    const weakTasks = weakTaskMap(latest.source.taskScores, checkpointTaskIds, allowedModules);
    const requested = Array.isArray(latest.source.remediationModules)
      ? latest.source.remediationModules.filter((moduleId): moduleId is string =>
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
          .map(item => item.taskId))),
        ...remediationTaskPair(moduleId, checkpointTaskIds, latest.attemptNumber)
      }))
      .sort((left, right) =>
        left.score - right.score
        || (checkpointModuleOrder.get(left.moduleId) ?? Number.MAX_SAFE_INTEGER)
          - (checkpointModuleOrder.get(right.moduleId) ?? Number.MAX_SAFE_INTEGER)
        || left.moduleId.localeCompare(right.moduleId)
      );
    if (!remediationModules.length) continue;

    states.push({
      checkpointId: latest.checkpointId,
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

export function checkpointRemediationsFromReports(
  reports: unknown,
  userId: string | null
): CheckpointRemediationState[] {
  return checkpointRemediationsFromAttemptSnapshot(
    checkpointAttemptSnapshotFromReports(reports, userId)
  );
}

function independentTimestampAfter(progress: Progress, taskId: string, after: string) {
  if (!hasIndependentTaskEvidence(progress, taskId)) return false;
  const lastIndependentAt = progress.taskStats[taskId]?.lastIndependentAt;
  const timestamp = typeof lastIndependentAt === 'string' ? Date.parse(lastIndependentAt) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > Date.parse(after) ? lastIndependentAt : false;
}

export function checkpointRemediationModuleRepaired(
  state: CheckpointRemediationState,
  moduleId: string,
  progress: Progress
) {
  return nextCheckpointRemediationStep(state, moduleId, progress) === null;
}

export function unresolvedCheckpointRemediationModules(
  state: CheckpointRemediationState,
  progress: Progress
) {
  return state.modules.filter(module =>
    !checkpointRemediationModuleRepaired(state, module.moduleId, progress)
  );
}

export function nextCheckpointRemediationStep(
  state: CheckpointRemediationState,
  moduleId: string,
  progress: Progress
): CheckpointRemediationStep | null {
  const module = state.modules.find(item => item.moduleId === moduleId);
  if (!module) return null;
  const discriminatingAt = independentTimestampAfter(
    progress,
    module.discriminatingTaskId,
    state.completedAt
  );
  if (!discriminatingAt) {
    return { kind: 'discriminating', taskId: module.discriminatingTaskId };
  }
  const transferAt = independentTimestampAfter(progress, module.transferTaskId, discriminatingAt);
  return transferAt ? null : { kind: 'transfer', taskId: module.transferTaskId };
}
