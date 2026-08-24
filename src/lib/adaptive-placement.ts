import { assessmentItem, type AssessmentReasoningSkill } from '../data/assessment-blueprints';

export const ADAPTIVE_DIAGNOSTIC_VERSION = 'adaptive-diagnostic-v1';
export const ADAPTIVE_DIAGNOSTIC_REFERENCE_TASK_IDS = [
  'task-002',
  'task-014',
  'task-026',
  'task-034',
  'task-040',
  'task-058',
  'task-094'
] as const;

export type AdaptivePlacementLevel = 'foundation' | 'developing' | 'working' | 'advanced';
export type AdaptiveStopReason =
  | 'minimum-probe-incomplete'
  | 'foundation-observed'
  | 'bridge-needed'
  | 'challenge-needed'
  | 'maximum-evidence-reached';

export type AdaptiveDiagnosticAnswer = {
  taskId: string;
  correct: boolean;
  skipped: boolean;
};

export type AdaptiveDiagnosticDecision = {
  version: typeof ADAPTIVE_DIAGNOSTIC_VERSION;
  completedCount: number;
  correctCount: number;
  plannedCount: 3 | 5 | 7;
  shouldStop: boolean;
  stopReason: AdaptiveStopReason;
  level: AdaptivePlacementLevel;
  scoreBand: { low: number; high: number };
  confidenceLabel: string;
  explanation: string;
};

const requiredSkillsByLength: Record<3 | 5 | 7, readonly AssessmentReasoningSkill[]> = {
  3: ['result-contract', 'row-selection', 'aggregation'],
  5: ['result-contract', 'row-selection', 'aggregation', 'relationships'],
  7: ['result-contract', 'row-selection', 'aggregation', 'relationships', 'time-series', 'performance']
};

function wilsonBand(correct: number, total: number) {
  if (!total) return { low: 0, high: 100 };
  const z = 1.645;
  const proportion = correct / total;
  const denominator = 1 + z * z / total;
  const center = (proportion + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + z * z / (4 * total)) / total) / denominator;
  return {
    low: Math.max(0, Math.round((center - margin) * 100)),
    high: Math.min(100, Math.round((center + margin) * 100))
  };
}

function levelFor(correct: number, completed: number): AdaptivePlacementLevel {
  if (completed >= 7 && correct >= 6) return 'advanced';
  if (completed >= 5 && correct >= 4) return 'working';
  if (completed >= 3 && correct >= 2) return 'developing';
  return 'foundation';
}

export function adaptiveDiagnosticDecision(
  answers: readonly AdaptiveDiagnosticAnswer[]
): AdaptiveDiagnosticDecision {
  const completed: AdaptiveDiagnosticAnswer[] = [];
  for (const answer of answers.slice(0, 7)) {
    if (!answer.correct && !answer.skipped) break;
    completed.push(answer);
  }
  const completedCount = completed.length;
  const correctCount = completed.filter(answer => answer.correct).length;
  const scoreBand = wilsonBand(correctCount, completedCount);
  const level = levelFor(correctCount, completedCount);

  if (completedCount < 3) return {
    version: ADAPTIVE_DIAGNOSTIC_VERSION,
    completedCount,
    correctCount,
    plannedCount: 3,
    shouldStop: false,
    stopReason: 'minimum-probe-incomplete',
    level,
    scoreBand,
    confidenceLabel: 'Пока недостаточно наблюдений',
    explanation: 'Нужны три короткие базовые пробы: форма результата, фильтрация и агрегация.'
  };

  if (completedCount === 3 && correctCount <= 1) return {
    version: ADAPTIVE_DIAGNOSTIC_VERSION,
    completedCount,
    correctCount,
    plannedCount: 3,
    shouldStop: true,
    stopReason: 'foundation-observed',
    level: 'foundation',
    scoreBand,
    confidenceLabel: 'Достаточно для безопасного старта с основ',
    explanation: 'Более сложные вопросы сейчас не изменят безопасное решение: начать с общей базы и ничего не пропускать.'
  };

  if (completedCount < 5) return {
    version: ADAPTIVE_DIAGNOSTIC_VERSION,
    completedCount,
    correctCount,
    plannedCount: 5,
    shouldStop: false,
    stopReason: 'bridge-needed',
    level,
    scoreBand,
    confidenceLabel: 'Нужны две рабочие пробы',
    explanation: 'База выглядит знакомой; добавляем группировку и связи, чтобы не принять удачную догадку за устойчивый навык.'
  };

  if (completedCount === 5 && correctCount <= 2) return {
    version: ADAPTIVE_DIAGNOSTIC_VERSION,
    completedCount,
    correctCount,
    plannedCount: 5,
    shouldStop: true,
    stopReason: 'bridge-needed',
    level,
    scoreBand,
    confidenceLabel: 'Рабочая граница уточнена',
    explanation: 'Пять независимых результатов уже показывают ближайшую зону роста; сложные задачи не нужны для стартового маршрута.'
  };

  if (completedCount < 7) return {
    version: ADAPTIVE_DIAGNOSTIC_VERSION,
    completedCount,
    correctCount,
    plannedCount: 7,
    shouldStop: false,
    stopReason: 'challenge-needed',
    level,
    scoreBand,
    confidenceLabel: 'Проверяем верхнюю границу',
    explanation: 'Рабочие задачи решены достаточно уверенно; два более сложных сценария уточнят старт без длинного экзамена.'
  };

  return {
    version: ADAPTIVE_DIAGNOSTIC_VERSION,
    completedCount,
    correctCount,
    plannedCount: 7,
    shouldStop: true,
    stopReason: 'maximum-evidence-reached',
    level,
    scoreBand,
    confidenceLabel: scoreBand.high - scoreBand.low <= 45 ? 'Граница старта определена' : 'Старт определён с широкой неопределённостью',
    explanation: 'Достигнут максимум короткой диагностики. Неопределённость будет уточняться обычной практикой, а не дополнительным входным экзаменом.'
  };
}

export function adaptiveDiagnosticCoverage(taskIds: readonly string[]) {
  const length = taskIds.length >= 7 ? 7 : taskIds.length >= 5 ? 5 : 3;
  const considered = taskIds.slice(0, length);
  const skills = new Set(considered.map(taskId => assessmentItem(taskId)?.reasoningSkill).filter(Boolean));
  const missingSkills = requiredSkillsByLength[length].filter(skill => !skills.has(skill));
  const expectedSkills: readonly AssessmentReasoningSkill[] = [
    'result-contract',
    'row-selection',
    'aggregation',
    'aggregation',
    'relationships',
    'time-series',
    'performance'
  ];
  const orderedPrefix = considered.every((taskId, index) => assessmentItem(taskId)?.reasoningSkill === expectedSkills[index]);
  return {
    length,
    distinctSkills: skills.size,
    missingSkills,
    orderedPrefix,
    valid: orderedPrefix && considered.length === length && missingSkills.length === 0
  };
}

export function completedAdaptiveTaskIds(answers: readonly AdaptiveDiagnosticAnswer[]) {
  const decision = adaptiveDiagnosticDecision(answers);
  return answers.slice(0, decision.completedCount).map(answer => answer.taskId);
}
