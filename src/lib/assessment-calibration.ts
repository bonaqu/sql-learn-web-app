import {
  ASSESSMENT_BLUEPRINT_VERSION,
  ASSESSMENT_THRESHOLD_VERSION,
  assessmentItem,
  type AssessmentDifficultyBand
} from '../data/assessment-blueprints';

export const ASSESSMENT_CALIBRATION_VERSION = 1;
export const MINIMUM_CALIBRATION_EVIDENCE = 30;
export const ASSESSMENT_CALIBRATION_CHANGED_EVENT = 'sql-academy-assessment-calibration-changed';
const CALIBRATION_STORAGE_KEY = 'sql-academy-assessment-calibration-v1';

export type AssessmentAbilityBand = 'low' | 'mid' | 'high';
export type CalibrationEvidenceState = 'insufficient' | 'emerging' | 'calibrated';
export type CalibrationFlag = 'too-easy' | 'too-hard' | 'nondiscriminating' | 'too-slow' | 'suspiciously-fast';

export interface AssessmentItemAggregate {
  taskId: string;
  blueprintVersion: string;
  eligibleAttempts: number;
  correctCount: number;
  firstAttemptCorrect: number;
  durationSecondsSum: number;
  independenceSum: number;
  lowAttempts: number;
  lowCorrect: number;
  highAttempts: number;
  highCorrect: number;
  technicalErrorAttempts: number;
  updatedAt: string;
}

export interface AssessmentItemCalibration {
  taskId: string;
  authoredDifficulty: AssessmentDifficultyBand;
  observedDifficulty: AssessmentDifficultyBand;
  expectedSeconds: number;
  observedSeconds: number | null;
  eligibleAttempts: number;
  correctness: number | null;
  firstAttemptRate: number | null;
  meanIndependence: number | null;
  discrimination: number | null;
  confidenceLow: number | null;
  confidenceHigh: number | null;
  evidence: CalibrationEvidenceState;
  flags: CalibrationFlag[];
  updatedAt: string;
}

export interface AssessmentCalibrationSnapshot {
  version: typeof ASSESSMENT_CALIBRATION_VERSION;
  blueprintVersion: typeof ASSESSMENT_BLUEPRINT_VERSION;
  generatedAt: string;
  minimumEvidence: number;
  items: Record<string, AssessmentItemCalibration>;
}

export interface AssessmentMeasurement {
  version: 1;
  blueprintVersion: string;
  thresholdVersion: string;
  formId: string;
  eligibleItems: number;
  excludedItems: number;
  calibratedItems: number;
  accuracyInterval: { low: number; high: number; confidence: 90 };
  scoreBand: { low: number; high: number };
  reliability: 'limited' | 'emerging' | 'supported';
  explanation: string[];
}

const clamp = (value: number, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value));
const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
const percent = (value: number | null) => value === null ? null : Math.round(value * 100);

export function abilityBand(readiness: number): AssessmentAbilityBand {
  if (readiness >= 72) return 'high';
  if (readiness >= 45) return 'mid';
  return 'low';
}

export function wilsonInterval(successes: number, total: number, z = 1.645) {
  if (total <= 0) return { low: 0, high: 1 };
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function observedDifficulty(correctness: number | null, authored: AssessmentDifficultyBand): AssessmentDifficultyBand {
  if (correctness === null) return authored;
  if (correctness >= 0.82) return 'foundation';
  if (correctness >= 0.62) return 'working';
  if (correctness >= 0.4) return 'advanced';
  return 'expert';
}

function evidenceState(attempts: number): CalibrationEvidenceState {
  if (attempts >= MINIMUM_CALIBRATION_EVIDENCE) return 'calibrated';
  if (attempts >= Math.ceil(MINIMUM_CALIBRATION_EVIDENCE / 3)) return 'emerging';
  return 'insufficient';
}

export function calibrationFromAggregate(aggregate: AssessmentItemAggregate): AssessmentItemCalibration | null {
  const item = assessmentItem(aggregate.taskId);
  if (!item || aggregate.blueprintVersion !== ASSESSMENT_BLUEPRINT_VERSION) return null;
  const correctnessRatio = ratio(aggregate.correctCount, aggregate.eligibleAttempts);
  const firstAttemptRatio = ratio(aggregate.firstAttemptCorrect, aggregate.eligibleAttempts);
  const meanIndependence = ratio(aggregate.independenceSum, aggregate.eligibleAttempts);
  const observedSeconds = aggregate.eligibleAttempts > 0
    ? Math.round(aggregate.durationSecondsSum / aggregate.eligibleAttempts)
    : null;
  const lowRate = ratio(aggregate.lowCorrect, aggregate.lowAttempts);
  const highRate = ratio(aggregate.highCorrect, aggregate.highAttempts);
  const discrimination = lowRate === null || highRate === null ? null : highRate - lowRate;
  const interval = aggregate.eligibleAttempts > 0
    ? wilsonInterval(aggregate.correctCount, aggregate.eligibleAttempts)
    : null;
  const evidence = evidenceState(aggregate.eligibleAttempts);
  const flags: CalibrationFlag[] = [];
  if (evidence === 'calibrated' && interval) {
    if (interval.low >= 0.82) flags.push('too-easy');
    if (interval.high <= 0.38) flags.push('too-hard');
    if (aggregate.lowAttempts + aggregate.highAttempts >= MINIMUM_CALIBRATION_EVIDENCE
      && discrimination !== null
      && Math.abs(discrimination) < 0.08) flags.push('nondiscriminating');
    if (observedSeconds !== null && observedSeconds > item.expectedSeconds * 1.65) flags.push('too-slow');
    if (observedSeconds !== null && observedSeconds < item.expectedSeconds * 0.35) flags.push('suspiciously-fast');
  }
  return {
    taskId: aggregate.taskId,
    authoredDifficulty: item.difficultyBand,
    observedDifficulty: observedDifficulty(correctnessRatio, item.difficultyBand),
    expectedSeconds: item.expectedSeconds,
    observedSeconds,
    eligibleAttempts: aggregate.eligibleAttempts,
    correctness: percent(correctnessRatio),
    firstAttemptRate: percent(firstAttemptRatio),
    meanIndependence: meanIndependence === null ? null : Math.round(meanIndependence),
    discrimination: discrimination === null ? null : Math.round(discrimination * 100),
    confidenceLow: interval ? Math.round(interval.low * 100) : null,
    confidenceHigh: interval ? Math.round(interval.high * 100) : null,
    evidence,
    flags,
    updatedAt: aggregate.updatedAt
  };
}

export function calibrationSnapshot(aggregates: AssessmentItemAggregate[], generatedAt = new Date().toISOString()): AssessmentCalibrationSnapshot {
  const items: Record<string, AssessmentItemCalibration> = {};
  for (const aggregate of aggregates) {
    const calibration = calibrationFromAggregate(aggregate);
    if (calibration) items[calibration.taskId] = calibration;
  }
  return {
    version: ASSESSMENT_CALIBRATION_VERSION,
    blueprintVersion: ASSESSMENT_BLUEPRINT_VERSION,
    generatedAt,
    minimumEvidence: MINIMUM_CALIBRATION_EVIDENCE,
    items
  };
}

export function emptyCalibrationSnapshot(): AssessmentCalibrationSnapshot {
  return calibrationSnapshot([], new Date(0).toISOString());
}

export function normalizeCalibrationSnapshot(value: unknown): AssessmentCalibrationSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyCalibrationSnapshot();
  const source = value as Partial<AssessmentCalibrationSnapshot>;
  if (source.version !== ASSESSMENT_CALIBRATION_VERSION
    || source.blueprintVersion !== ASSESSMENT_BLUEPRINT_VERSION
    || !source.items
    || typeof source.items !== 'object') return emptyCalibrationSnapshot();
  const items: Record<string, AssessmentItemCalibration> = {};
  for (const [taskId, item] of Object.entries(source.items)) {
    if (!assessmentItem(taskId) || !item || typeof item !== 'object') continue;
    const candidate = item as AssessmentItemCalibration;
    if (!Number.isInteger(candidate.eligibleAttempts) || candidate.eligibleAttempts < 0) continue;
    items[taskId] = candidate;
  }
  return {
    version: ASSESSMENT_CALIBRATION_VERSION,
    blueprintVersion: ASSESSMENT_BLUEPRINT_VERSION,
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : new Date(0).toISOString(),
    minimumEvidence: MINIMUM_CALIBRATION_EVIDENCE,
    items
  };
}

export function loadAssessmentCalibration(): AssessmentCalibrationSnapshot {
  try {
    return normalizeCalibrationSnapshot(JSON.parse(localStorage.getItem(CALIBRATION_STORAGE_KEY) || 'null'));
  } catch {
    return emptyCalibrationSnapshot();
  }
}

export function saveAssessmentCalibration(snapshot: AssessmentCalibrationSnapshot) {
  const next = normalizeCalibrationSnapshot(snapshot);
  localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(ASSESSMENT_CALIBRATION_CHANGED_EVENT, { detail: next }));
  return next;
}

export async function syncAssessmentCalibration() {
  const response = await fetch('/api/assessment/calibration');
  if (!response.ok) throw new Error('Assessment calibration is unavailable');
  const payload = await response.json() as { aggregates?: AssessmentItemAggregate[]; generatedAt?: string };
  return saveAssessmentCalibration(calibrationSnapshot(payload.aggregates || [], payload.generatedAt));
}

export function calibratedExpectedSeconds(taskId: string, snapshot: AssessmentCalibrationSnapshot) {
  const item = assessmentItem(taskId);
  if (!item) return 300;
  const calibration = snapshot.items[taskId];
  if (!calibration || calibration.evidence !== 'calibrated' || calibration.observedSeconds === null) return item.expectedSeconds;
  return Math.round(item.expectedSeconds * 0.35 + calibration.observedSeconds * 0.65);
}

export function calibrationSelectionValue(taskId: string, snapshot: AssessmentCalibrationSnapshot) {
  const calibration = snapshot.items[taskId];
  if (!calibration) return 0;
  if (calibration.flags.includes('nondiscriminating')) return -18;
  if (calibration.flags.includes('too-easy') || calibration.flags.includes('too-hard')) return -8;
  if (calibration.evidence === 'calibrated') return 8 + Math.max(0, calibration.discrimination || 0) / 5;
  if (calibration.evidence === 'emerging') return 3;
  return 0;
}

export function buildAssessmentMeasurement(input: {
  score: number;
  correct: number;
  eligibleItems: number;
  excludedItems: number;
  taskIds: string[];
  formId: string;
  snapshot: AssessmentCalibrationSnapshot;
}): AssessmentMeasurement {
  const interval = wilsonInterval(input.correct, Math.max(1, input.eligibleItems));
  const calibratedItems = input.taskIds.filter(taskId => input.snapshot.items[taskId]?.evidence === 'calibrated').length;
  const calibratedRatio = calibratedItems / Math.max(1, input.taskIds.length);
  const intervalWidth = interval.high - interval.low;
  const halfWidth = Math.max(5, Math.round(intervalWidth * 45 + (1 - calibratedRatio) * 5));
  const reliability: AssessmentMeasurement['reliability'] = input.eligibleItems >= 18 && calibratedRatio >= 0.65
    ? 'supported'
    : input.eligibleItems >= 8 || calibratedRatio >= 0.35
      ? 'emerging'
      : 'limited';
  const explanation = [
    `Форма ${input.formId} собрана по ${ASSESSMENT_BLUEPRINT_VERSION}.`,
    `${input.eligibleItems} задач вошли в измерение; ${input.excludedItems} исключены из calibration evidence.`,
    calibratedItems
      ? `${calibratedItems} items имеют достаточный aggregate evidence.`
      : 'Item calibration пока опирается на authored difficulty: aggregate evidence недостаточен.',
    'Интервал показывает неопределённость измерения и не является гарантией результата следующей попытки.'
  ];
  return {
    version: 1,
    blueprintVersion: ASSESSMENT_BLUEPRINT_VERSION,
    thresholdVersion: ASSESSMENT_THRESHOLD_VERSION,
    formId: input.formId,
    eligibleItems: input.eligibleItems,
    excludedItems: input.excludedItems,
    calibratedItems,
    accuracyInterval: {
      low: Math.round(interval.low * 100),
      high: Math.round(interval.high * 100),
      confidence: 90
    },
    scoreBand: {
      low: Math.round(clamp(input.score - halfWidth)),
      high: Math.round(clamp(input.score + halfWidth))
    },
    reliability,
    explanation
  };
}
