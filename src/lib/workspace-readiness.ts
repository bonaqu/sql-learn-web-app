import { tasks, type SqlTask } from '../data/course-catalog';
import {
  moduleOrderIndex,
  phaseDefinitions,
  phaseForModule
} from '../data/learning-structure';
import type { JourneyAction } from './learning-journey';
import {
  hasIndependentTaskEvidence,
  type Progress
} from './progress';

export type WorkspaceMode = 'catalog' | 'practice' | 'review' | 'interview' | 'puzzle';
export type WorkspaceReadinessStatus = 'ready' | 'preview' | 'loading';

export type WorkspaceTaskReadiness = {
  status: WorkspaceReadinessStatus;
  canRun: boolean;
  label: string;
  reason: string;
};

export type WorkspaceJourneyState = {
  action: JourneyAction;
  passedPhaseIds: readonly string[];
};

const phaseOrder = new Map<string, number>(phaseDefinitions.map((phase, index) => [phase.id, index]));
const taskOrder = new Map<string, number>(tasks.map((task, index) => [task.id, index]));

function ready(label: string, reason: string): WorkspaceTaskReadiness {
  return { status: 'ready', canRun: true, label, reason };
}

function preview(label: string, reason: string): WorkspaceTaskReadiness {
  return { status: 'preview', canRun: false, label, reason };
}

function phaseIndex(phaseId: string | null | undefined) {
  if (!phaseId) return Number.MAX_SAFE_INTEGER;
  return phaseOrder.get(phaseId) ?? Number.MAX_SAFE_INTEGER;
}

function frontierDescription(action: JourneyAction) {
  if (action.stage === 'lesson') return `урок «${action.title}»`;
  if (action.stage === 'guided') return `guided-задачу «${action.title}»`;
  if (action.stage === 'practice') return `самостоятельную практику «${action.title}»`;
  if (action.stage === 'checkpoint') return `checkpoint «${action.title}»`;
  if (action.stage === 'interview') return `Interview «${action.title}»`;
  if (action.stage === 'puzzle') return `SQL Puzzle «${action.title}»`;
  if (action.stage === 'assessment') return 'итоговый Assessment';
  if (action.stage === 'project') return `capstone «${action.title}»`;
  return 'текущий этап маршрута';
}

export function workspaceTaskReadiness(
  task: SqlTask,
  progress: Progress,
  journey: WorkspaceJourneyState | null,
  mode: WorkspaceMode
): WorkspaceTaskReadiness {
  if (mode === 'review') {
    return ready('Retrieval review', 'Задача уже находится в адаптивной очереди повторения.');
  }

  if (hasIndependentTaskEvidence(progress, task.id)) {
    return ready('Independent подтверждён', 'Навык уже подтверждён без подсказки; задачу можно повторить в любое время.');
  }

  if (progress.completed.includes(task.id)) {
    return ready('Повтор guided-этапа', 'Задача уже решалась; повторный запуск нужен для independent evidence или закрепления.');
  }

  if (!journey) {
    return {
      status: 'loading',
      canRun: false,
      label: 'Сверяю маршрут',
      reason: 'Загружаю lesson, checkpoint и assessment evidence перед запуском.'
    };
  }

  const { action, passedPhaseIds } = journey;
  if (action.kind === 'complete') {
    return ready('Свободная expert-практика', 'Обязательный маршрут завершён; все задачи доступны для поддержания навыка.');
  }

  if (action.task?.id === task.id) {
    return ready('Текущий шаг маршрута', action.description);
  }

  const taskPhase = phaseForModule(task.module);
  const taskPhaseIndex = phaseIndex(taskPhase?.id);
  const frontierPhaseIndex = phaseIndex(action.phaseId);
  const earlierPhase = taskPhaseIndex < frontierPhaseIndex;
  const laterPhase = taskPhaseIndex > frontierPhaseIndex;
  const isTransfer = task.mode === 'interview' || task.mode === 'puzzle';

  if (isTransfer) {
    if (earlierPhase || (taskPhase && passedPhaseIds.includes(taskPhase.id))) {
      return ready(
        task.mode === 'interview' ? 'Interview открыт' : 'Puzzle открыт',
        'Foundation этой фазы и её checkpoint уже пройдены.'
      );
    }
    return preview(
      task.mode === 'interview' ? 'Interview preview' : 'Puzzle preview',
      `Сначала заверши foundation фазы и её checkpoint. Канонический следующий шаг — ${frontierDescription(action)}.`
    );
  }

  if (action.stage === 'assessment' || action.stage === 'project') {
    return ready('Foundation доступен', 'Базовая и production-части курса уже пройдены; задачу можно повторить.');
  }

  if (earlierPhase) {
    return ready('Пройденная foundation-фаза', 'Задача относится к уже пройденной части маршрута.');
  }

  if (laterPhase) {
    return preview(
      'Поздний модуль · preview',
      `Эта задача находится дальше текущего frontier. Сначала пройди ${frontierDescription(action)}.`
    );
  }

  if (action.stage === 'checkpoint' || action.stage === 'interview' || action.stage === 'puzzle') {
    return ready('Foundation фазы открыт', 'Уроки и самостоятельная практика этой фазы уже завершены.');
  }

  if (!action.moduleId) {
    return preview('Preview', `Сначала пройди ${frontierDescription(action)}.`);
  }

  const moduleDelta = moduleOrderIndex(task.module) - moduleOrderIndex(action.moduleId);
  if (moduleDelta < 0) {
    return ready('Предыдущий модуль', 'Задача относится к уже открытому модулю текущей фазы.');
  }
  if (moduleDelta > 0) {
    return preview(
      'Следующий модуль · preview',
      `Сначала закончи текущий модуль через ${frontierDescription(action)}.`
    );
  }

  if (action.stage === 'lesson') {
    return preview(
      'Сначала mental model',
      `Перед запуском задачи заверши ${frontierDescription(action)} и его knowledge checks.`
    );
  }

  if (action.task) {
    const taskIndex = taskOrder.get(task.id) ?? Number.MAX_SAFE_INTEGER;
    const frontierTaskIndex = taskOrder.get(action.task.id) ?? Number.MAX_SAFE_INTEGER;
    if (taskIndex <= frontierTaskIndex) {
      return ready('Открытый этап модуля', 'Задача находится не дальше текущего шага внутри модуля.');
    }
  }

  return preview(
    'Позже в этом модуле · preview',
    `Сначала пройди ${frontierDescription(action)}; затем маршрут откроет следующий task stage.`
  );
}

export function workspaceStageLabel(task: SqlTask) {
  if (task.mode === 'lesson') return 'Guided';
  if (task.mode === 'practice') return 'Practice';
  if (task.mode === 'interview') return 'Interview';
  return 'Puzzle';
}
