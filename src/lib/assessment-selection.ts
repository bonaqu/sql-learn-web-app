import { tasks, type SqlTask } from '../data/course-catalog';
import {
  ASSESSMENT_BLUEPRINT_VERSION,
  assessmentBlueprints,
  assessmentItem,
  type AssessmentBlueprint,
  type AssessmentBlueprintSlot,
  type CalibratedAssessmentMode
} from '../data/assessment-blueprints';
import {
  calibrationSelectionValue,
  emptyCalibrationSnapshot,
  type AssessmentCalibrationSnapshot
} from './assessment-calibration';
import type { Progress } from './progress';

export interface AssessmentSelectionReport {
  mode: CalibratedAssessmentMode;
  status: 'completed' | 'expired' | 'abandoned';
  completedAt: string;
  taskScores: Array<{ taskId: string; correct: boolean }>;
}

export interface AssessmentSelectionResult {
  tasks: SqlTask[];
  formId: string;
  blueprintVersion: string;
  excludedKnownSolutions: number;
  fallbackKnownSolutions: number;
  distinctModules: number;
  distinctSkills: number;
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function taskHash(taskId: string, seed: string) {
  return hash(`${seed}:${taskId}`) / 0xffffffff;
}

function completedKnownTasks(reports: AssessmentSelectionReport[]) {
  return new Set(reports
    .filter(report => report.status === 'completed')
    .flatMap(report => report.taskScores.filter(item => item.correct).map(item => item.taskId)));
}

function modePool(mode: CalibratedAssessmentMode) {
  return tasks.filter(task => assessmentItem(task.id)?.eligibleModes.includes(mode));
}

function difficultyFit(task: SqlTask, slot?: AssessmentBlueprintSlot) {
  if (!slot?.difficultyBands?.length) return 0;
  const band = assessmentItem(task.id)?.difficultyBand;
  return band && slot.difficultyBands.includes(band) ? 8 : -14;
}

function weaknessValue(task: SqlTask, progress: Progress) {
  const stats = progress.taskStats[task.id];
  if (!stats) return progress.completed.includes(task.id) ? -2 : 5;
  return Math.min(18, stats.incorrect * 4 + stats.hintsUsed * 3 + Math.max(0, stats.attempts - (stats.independentPasses || 0)));
}

function candidateValue(input: {
  task: SqlTask;
  slot?: AssessmentBlueprintSlot;
  progress: Progress;
  calibration: AssessmentCalibrationSnapshot;
  blueprint: AssessmentBlueprint;
  usedModules: Set<string>;
  seed: string;
}) {
  const item = assessmentItem(input.task.id);
  const anchor = input.blueprint.anchorTaskIds?.includes(input.task.id) ? 2 : 0;
  const newModule = input.usedModules.has(input.task.module) ? -6 : 8;
  const slotFit = input.slot && item?.reasoningSkill === input.slot.reasoningSkill ? 20 : input.slot ? -30 : 0;
  return slotFit
    + difficultyFit(input.task, input.slot)
    + weaknessValue(input.task, input.progress)
    + calibrationSelectionValue(input.task.id, input.calibration)
    + anchor
    + newModule
    + taskHash(input.task.id, input.seed) * 42;
}

function chooseCandidate(input: {
  pool: SqlTask[];
  selected: SqlTask[];
  known: Set<string>;
  allowKnown: boolean;
  slot?: AssessmentBlueprintSlot;
  progress: Progress;
  calibration: AssessmentCalibrationSnapshot;
  blueprint: AssessmentBlueprint;
  seed: string;
}) {
  const selectedIds = new Set(input.selected.map(task => task.id));
  const usedModules = new Set(input.selected.map(task => task.module));
  return input.pool
    .filter(task => !selectedIds.has(task.id))
    .filter(task => input.allowKnown || !input.known.has(task.id))
    .filter(task => !input.slot || assessmentItem(task.id)?.reasoningSkill === input.slot.reasoningSkill)
    .map(task => ({
      task,
      value: candidateValue({
        task,
        slot: input.slot,
        progress: input.progress,
        calibration: input.calibration,
        blueprint: input.blueprint,
        usedModules,
        seed: input.seed
      })
    }))
    .sort((left, right) => right.value - left.value || left.task.id.localeCompare(right.task.id))[0]?.task || null;
}

export function assessmentFormId(mode: CalibratedAssessmentMode, userId: string, attemptNumber: number) {
  const form = 1 + (hash(`${userId}:${mode}:${attemptNumber}:${ASSESSMENT_BLUEPRINT_VERSION}`) % 4);
  return `${mode.toUpperCase()}-${ASSESSMENT_BLUEPRINT_VERSION}-F${form}`;
}

export function selectAssessmentForm(input: {
  mode: CalibratedAssessmentMode;
  progress: Progress;
  userId: string;
  reports?: AssessmentSelectionReport[];
  calibration?: AssessmentCalibrationSnapshot;
}): AssessmentSelectionResult {
  const blueprint = assessmentBlueprints[input.mode];
  const reports = input.reports || [];
  const calibration = input.calibration || emptyCalibrationSnapshot();
  const attemptNumber = reports.filter(report => report.mode === input.mode).length + 1;
  const formId = assessmentFormId(input.mode, input.userId, attemptNumber);
  const seed = `${formId}:${input.userId}:${attemptNumber}`;
  const known = completedKnownTasks(reports);

  if (blueprint.fixedTaskIds?.length) {
    const fixed = blueprint.fixedTaskIds.flatMap(taskId => tasks.find(task => task.id === taskId) || []);
    return {
      tasks: fixed,
      formId,
      blueprintVersion: blueprint.version,
      excludedKnownSolutions: fixed.filter(task => known.has(task.id)).length,
      fallbackKnownSolutions: fixed.filter(task => known.has(task.id)).length,
      distinctModules: new Set(fixed.map(task => task.module)).size,
      distinctSkills: new Set(fixed.map(task => assessmentItem(task.id)?.reasoningSkill).filter(Boolean)).size
    };
  }

  const pool = modePool(input.mode);
  const selected: SqlTask[] = [];
  let fallbackKnownSolutions = 0;

  for (const slot of blueprint.slots) {
    for (let index = 0; index < slot.count; index += 1) {
      let candidate = chooseCandidate({
        pool,
        selected,
        known,
        allowKnown: false,
        slot,
        progress: input.progress,
        calibration,
        blueprint,
        seed: `${seed}:${slot.reasoningSkill}:${index}`
      });
      if (!candidate) {
        candidate = chooseCandidate({
          pool,
          selected,
          known,
          allowKnown: true,
          slot,
          progress: input.progress,
          calibration,
          blueprint,
          seed: `${seed}:${slot.reasoningSkill}:${index}:fallback`
        });
        if (candidate && known.has(candidate.id)) fallbackKnownSolutions += 1;
      }
      if (candidate) selected.push(candidate);
    }
  }

  while (selected.length < blueprint.taskCount) {
    const index = selected.length;
    let candidate = chooseCandidate({
      pool,
      selected,
      known,
      allowKnown: false,
      progress: input.progress,
      calibration,
      blueprint,
      seed: `${seed}:fill:${index}`
    });
    if (!candidate) {
      candidate = chooseCandidate({
        pool,
        selected,
        known,
        allowKnown: true,
        progress: input.progress,
        calibration,
        blueprint,
        seed: `${seed}:fill:${index}:fallback`
      });
      if (candidate && known.has(candidate.id)) fallbackKnownSolutions += 1;
    }
    if (!candidate) break;
    selected.push(candidate);
  }

  const result = selected.slice(0, blueprint.taskCount);
  return {
    tasks: result,
    formId,
    blueprintVersion: blueprint.version,
    excludedKnownSolutions: Math.max(0, known.size - fallbackKnownSolutions),
    fallbackKnownSolutions,
    distinctModules: new Set(result.map(task => task.module)).size,
    distinctSkills: new Set(result.map(task => assessmentItem(task.id)?.reasoningSkill).filter(Boolean)).size
  };
}

export function assessmentFormCoverage(mode: CalibratedAssessmentMode, form: SqlTask[]) {
  const blueprint = assessmentBlueprints[mode];
  const skillCounts = new Map<string, number>();
  for (const task of form) {
    const skill = assessmentItem(task.id)?.reasoningSkill || 'unknown';
    skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
  }
  const missingSlots = blueprint.slots.flatMap(slot => {
    const missing = Math.max(0, slot.count - (skillCounts.get(slot.reasoningSkill) || 0));
    return Array.from({ length: missing }, () => slot.reasoningSkill);
  });
  const skills = form.map(task => assessmentItem(task.id)?.reasoningSkill).filter(Boolean);
  return {
    taskCount: form.length,
    distinctModules: new Set(form.map(task => task.module)).size,
    distinctSkills: new Set(skills).size,
    duplicateTasks: form.length - new Set(form.map(task => task.id)).size,
    missingSlots,
    valid: form.length === blueprint.taskCount
      && new Set(form.map(task => task.module)).size >= blueprint.minimumDistinctModules
      && new Set(skills).size >= blueprint.minimumDistinctSkills
      && missingSlots.length === 0
  };
}

export function assessmentFormOverlap(left: SqlTask[], right: SqlTask[]) {
  const rightIds = new Set(right.map(task => task.id));
  return left.length ? left.filter(task => rightIds.has(task.id)).length / left.length : 0;
}
