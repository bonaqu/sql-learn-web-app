import { type SqlTask } from '../data/course-catalog';
import type { CheckpointRemediationState } from './checkpoint-remediation';
import { emptyCurriculumProgress, type CurriculumProgressV1 } from './curriculum-progress';
import { learnerGoalTitle } from './goal-aware-route';
import type { LearnerGoal } from './learner-onboarding';
import {
  buildJourneyFrontier,
  transferTasksForModule,
  type JourneyAction,
  type JourneyFrontier
} from './learning-journey';
import { hasIndependentTaskEvidence, type Progress, reviewQueue } from './progress';

export type LearningSessionEvidence = {
  curriculum: CurriculumProgressV1;
  passedCheckpointIds?: readonly string[];
  checkpointRemediations?: readonly CheckpointRemediationState[];
  assessmentComplete?: boolean;
  bypassedModuleIds?: readonly string[];
  goal?: LearnerGoal | null;
};

export type SessionItem = {
  id: string;
  task: SqlTask | null;
  action: JourneyAction | null;
  reason: 'review' | 'remediation' | 'new' | 'checkpoint' | 'transfer';
  label: string;
  title: string;
  topic: string;
  minutes: number;
  whyNow: string;
  goalConnection: string;
};

export type DailyRoute = {
  items: SessionItem[];
  totalMinutes: number;
  reviewCount: number;
  remediationCount: number;
  newCount: number;
  transferCount: number;
  targetMinutes: number;
  budgetExplanation: string;
  frontier: JourneyFrontier;
};

const difficultyMinutes: Record<SqlTask['difficulty'], number> = {
  'База': 4,
  'Рабочий': 6,
  'Продвинутый': 8,
  'Экспертный': 10
};

const stageMinutes: Record<JourneyAction['stage'], number> = {
  lesson: 12,
  guided: 6,
  practice: 8,
  review: 6,
  checkpoint: 20,
  interview: 10,
  puzzle: 10,
  assessment: 25,
  project: 30,
  complete: 5
};

export function defaultLearningSessionEvidence(): LearningSessionEvidence {
  return { curriculum: emptyCurriculumProgress() };
}

function pushReview(items: SessionItem[], task: SqlTask | undefined) {
  if (!task || items.some(item => item.task?.id === task.id)) return;
  items.push({
    id: `review:${task.id}`,
    task,
    action: null,
    reason: 'review',
    label: 'Retrieval review до нового материала',
    title: task.title,
    topic: task.topic,
    minutes: difficultyMinutes[task.difficulty],
    whyNow: 'Срок воспроизведения уже наступил: повторение идёт до нового материала, чтобы не маскировать забывание перечитыванием.',
    goalConnection: 'Надёжное воспроизведение поддерживает выбранную цель независимо от специализации.'
  });
}

function actionReason(action: JourneyAction, progress: Progress): SessionItem['reason'] {
  if (action.stage === 'checkpoint') return 'checkpoint';
  if (action.routeReasonCode === 'checkpoint-remediation') return 'remediation';
  if (action.stage === 'interview' || action.stage === 'puzzle' || action.stage === 'project') return 'transfer';
  if (action.task && (progress.taskStats[action.task.id]?.attempts || 0) > 0) return 'remediation';
  return 'new';
}

function actionLabel(action: JourneyAction) {
  if (action.routeReasonCode === 'checkpoint-remediation') {
    return action.stage === 'checkpoint'
      ? 'Повтор контрольного этапа после восстановления'
      : 'Восстановление после непройденного контрольного этапа';
  }
  if (action.stage === 'lesson') return 'Мысленная модель и проверка понимания';
  if (action.stage === 'guided') return 'Практика с подсказками после урока';
  if (action.stage === 'practice') return 'Самостоятельная практика без подсказок';
  if (action.stage === 'checkpoint') return 'Обязательный контрольный этап';
  if (action.stage === 'interview') return 'Перенос навыка: объяснение и решение';
  if (action.stage === 'puzzle') return 'Перенос навыка: непривычная формулировка';
  if (action.stage === 'assessment') return 'Смешанная итоговая проверка';
  if (action.stage === 'project') return 'Итоговый проект на рабочем сценарии';
  if (action.stage === 'complete') return 'Поддержание профессионального уровня';
  return 'Следующий этап маршрута';
}

function pushAction(items: SessionItem[], action: JourneyAction, progress: Progress, goal: LearnerGoal) {
  if (action.task) {
    const duplicateIndex = items.findIndex(item => item.task?.id === action.task?.id);
    if (duplicateIndex >= 0) items.splice(duplicateIndex, 1);
  }
  items.push({
    id: `${action.kind}:${action.lessonId || action.checkpointId || action.projectId || action.task?.id || action.stage}`,
    task: action.task,
    action,
    reason: actionReason(action, progress),
    label: actionLabel(action),
    title: action.title,
    topic: action.moduleTitle || action.phaseTitle || 'SQL Academy',
    minutes: action.task ? difficultyMinutes[action.task.difficulty] : stageMinutes[action.stage],
    whyNow: action.routeReason || action.description,
    goalConnection: action.routeReasonCode === 'shared-foundation'
      ? 'Эта общая база обязательна для любой цели.'
      : `Шаг выбран с учётом цели «${learnerGoalTitle(goal)}» и уже подтверждённых предыдущих тем.`
  });
}

function pushTransfer(items: SessionItem[], task: SqlTask | undefined, goal: LearnerGoal) {
  if (!task || items.some(item => item.task?.id === task.id)) return;
  items.push({
    id: `transfer:${task.id}`,
    task,
    action: null,
    reason: 'transfer',
    label: 'Перенос навыка в незнакомую формулировку',
    title: task.title,
    topic: task.topic,
    minutes: difficultyMinutes[task.difficulty],
    whyNow: 'Основная тема уже подтверждена; короткая новая формулировка проверяет, переносится ли способ решения за пределы знакомого примера.',
    goalConnection: `Практика отобрана внутри безопасного маршрута для цели «${learnerGoalTitle(goal)}».`
  });
}

export function buildDailyRoute(
  progress: Progress,
  targetMinutes = 25,
  evidence: LearningSessionEvidence = defaultLearningSessionEvidence()
): DailyRoute {
  const frontier = buildJourneyFrontier(progress, evidence.curriculum, {
    includeReview: false,
    goal: evidence.goal,
    passedCheckpointIds: evidence.passedCheckpointIds,
    checkpointRemediations: evidence.checkpointRemediations,
    assessmentComplete: evidence.assessmentComplete,
    bypassedModuleIds: evidence.bypassedModuleIds
  });
  const candidates: SessionItem[] = [];
  const primary = frontier.action;

  for (const review of reviewQueue(progress, 1)) pushReview(candidates, review);
  pushAction(candidates, primary, progress, frontier.goal);
  const transferCandidate = frontier.routeModuleIds
    .filter(moduleId => frontier.completedModuleIds.includes(moduleId))
    .flatMap(moduleId => transferTasksForModule(moduleId))
    .find(task => task.id !== primary.task?.id && !hasIndependentTaskEvidence(progress, task.id));
  if (targetMinutes >= 40) pushTransfer(candidates, transferCandidate, frontier.goal);

  const compact: SessionItem[] = [];
  let totalMinutes = 0;
  for (const item of candidates) {
    const primaryItem = item.action === primary;
    if (!primaryItem && totalMinutes + item.minutes > Math.max(targetMinutes, 15)) continue;
    compact.push(item);
    totalMinutes += item.minutes;
  }

  if (!compact.some(item => item.action === primary)) {
    pushAction(compact, primary, progress, frontier.goal);
    totalMinutes = compact.reduce((sum, item) => sum + item.minutes, 0);
  }

  return {
    items: compact,
    totalMinutes,
    reviewCount: compact.filter(item => item.reason === 'review').length,
    remediationCount: compact.filter(item => item.reason === 'remediation').length,
    newCount: compact.filter(item => item.reason === 'new' || item.reason === 'checkpoint').length,
    transferCount: compact.filter(item => item.reason === 'transfer').length,
    targetMinutes,
    budgetExplanation: totalMinutes > targetMinutes
      ? `Обязательный шаг занимает ${totalMinutes} минут и один раз превышает бюджет ${targetMinutes} минут; дополнительные элементы не добавлены.`
      : `В бюджет ${targetMinutes} минут вошло ${compact.length} ${compact.length === 1 ? 'действие' : 'действия'} (${totalMinutes} минут); остальное перенесено без накопления долга.`,
    frontier
  };
}
