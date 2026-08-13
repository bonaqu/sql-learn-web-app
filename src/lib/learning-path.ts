import { curriculumCheckpoints } from '../data/complete-curriculum';
import { modules, type SqlTask, tasks } from '../data/course-catalog';
import { phaseDefinitions, phaseForModule } from '../data/learning-structure';
import {
  buildDailyRoute,
  defaultLearningSessionEvidence,
  type DailyRoute,
  type LearningSessionEvidence
} from './daily-route';
import {
  buildJourneyFrontier,
  transferTasksForModule,
  type JourneyAction,
  type JourneyFrontier
} from './learning-journey';
import {
  hasIndependentTaskEvidence,
  type Progress
} from './progress';

export { phaseDefinitions } from '../data/learning-structure';
export { buildDailyRoute } from './daily-route';
export type { LearningSessionEvidence, SessionItem } from './daily-route';

export type MasteryLevel = 'locked' | 'new' | 'learning' | 'practice' | 'mastered';

export type ModuleMastery = {
  id: string;
  title: string;
  description: string;
  index: number;
  phaseId: string;
  solved: number;
  total: number;
  attempts: number;
  incorrect: number;
  hints: number;
  accuracy: number;
  independence: number;
  mastery: number;
  level: MasteryLevel;
  recommendedTask: SqlTask | null;
  routeState: 'completed' | 'current' | 'eligible' | 'locked';
};

export type LearningPhase = {
  id: string;
  title: string;
  subtitle: string;
  moduleIds: string[];
  mastery: number;
  solved: number;
  total: number;
  checkpointTask: SqlTask;
  checkpointPassed: boolean;
  unlocked: boolean;
};

export type DailySession = DailyRoute & {
  focusModule: ModuleMastery | null;
};

function defaultEvidence(): LearningSessionEvidence {
  return defaultLearningSessionEvidence();
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function taskSatisfied(task: SqlTask, progress: Progress) {
  return hasIndependentTaskEvidence(progress, task.id);
}

function frontierFor(progress: Progress, evidence: LearningSessionEvidence) {
  return buildJourneyFrontier(progress, evidence.curriculum, {
    includeReview: false,
    goal: evidence.goal,
    passedCheckpointIds: evidence.passedCheckpointIds,
    checkpointRemediations: evidence.checkpointRemediations,
    assessmentComplete: evidence.assessmentComplete,
    bypassedModuleIds: evidence.bypassedModuleIds
  });
}

function recommendedTaskForModule(
  moduleId: string,
  progress: Progress,
  frontier: JourneyFrontier
) {
  if (frontier.action.moduleId === moduleId) return frontier.action.task;
  if (!frontier.completedModuleIds.includes(moduleId)) return null;
  const phase = phaseForModule(moduleId);
  if (!phase || !frontier.passedPhaseIds.includes(phase.id)) return null;
  return transferTasksForModule(moduleId).find(task => !taskSatisfied(task, progress)) || null;
}

export function moduleMastery(
  progress: Progress,
  evidence: LearningSessionEvidence = defaultEvidence()
): ModuleMastery[] {
  const completed = new Set(progress.completed);
  const frontier = frontierFor(progress, evidence);
  const completedModules = new Set(frontier.completedModuleIds);
  const eligibleModules = new Set(frontier.eligibleModuleIds);
  const currentModuleId = frontier.action.moduleId;
  const routeOrder = new Map(frontier.routeModuleIds.map((moduleId, index) => [moduleId, index]));

  return modules.map(([id, title, description], physicalIndex) => {
    const moduleTasks = tasks.filter(task => task.module === id);
    const solved = moduleTasks.filter(task => completed.has(task.id)).length;
    const independent = moduleTasks.filter(task => hasIndependentTaskEvidence(progress, task.id)).length;
    const stats = moduleTasks.map(task => progress.taskStats[task.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 });
    const attempts = stats.reduce((sum, item) => sum + item.attempts, 0);
    const incorrect = stats.reduce((sum, item) => sum + item.incorrect, 0);
    const hints = stats.reduce((sum, item) => sum + item.hintsUsed, 0);
    const coverage = moduleTasks.length ? solved / moduleTasks.length : 0;
    const independentCoverage = moduleTasks.length ? independent / moduleTasks.length : 0;
    const accuracy = attempts ? clamp((attempts - incorrect) / attempts * 100) : 0;
    const independence = attempts ? clamp(100 - hints / Math.max(attempts, 1) * 28) : 0;
    const mastery = Math.round(clamp(
      coverage * 45
      + independentCoverage * 25
      + accuracy * 0.2
      + independence * 0.1
    ));
    const routeState: ModuleMastery['routeState'] = completedModules.has(id)
      ? 'completed'
      : currentModuleId === id
        ? 'current'
        : eligibleModules.has(id)
          ? 'eligible'
          : 'locked';
    const recommendedTask = recommendedTaskForModule(id, progress, frontier);
    const level: MasteryLevel = routeState === 'locked'
      ? 'locked'
      : routeState === 'completed' && !recommendedTask && mastery >= 82
        ? 'mastered'
        : mastery >= 55 || routeState === 'completed'
          ? 'practice'
          : attempts > 0 || solved > 0
            ? 'learning'
            : 'new';

    return {
      id,
      title,
      description,
      index: routeOrder.get(id) ?? physicalIndex,
      phaseId: phaseForModule(id)?.id || phaseDefinitions[0].id,
      solved,
      total: moduleTasks.length,
      attempts,
      incorrect,
      hints,
      accuracy: Math.round(accuracy),
      independence: Math.round(independence),
      mastery,
      level,
      recommendedTask,
      routeState
    };
  });
}

function checkpointFor(moduleIds: readonly string[]) {
  const candidates = tasks.filter(task => moduleIds.some(moduleId => moduleId === task.module));
  return [...candidates]
    .sort((left, right) => {
      const modeWeight = (task: SqlTask) => task.mode === 'interview' ? 3 : task.mode === 'puzzle' ? 2 : task.mode === 'practice' ? 1 : 0;
      return modeWeight(right) - modeWeight(left) || right.id.localeCompare(left.id);
    })[0]!;
}

function checkpointIdForPhase(phaseId: string) {
  const phase = phaseDefinitions.find(item => item.id === phaseId);
  if (!phase) return null;
  return curriculumCheckpoints.find(checkpoint =>
    checkpoint.moduleIds.some(moduleId => phase.moduleIds.includes(moduleId as never))
  )?.id || null;
}

export function learningPhases(
  progress: Progress,
  mastery: ModuleMastery[] = moduleMastery(progress),
  evidence: LearningSessionEvidence = defaultEvidence()
): LearningPhase[] {
  const frontier = frontierFor(progress, evidence);
  const passedCheckpointIds = new Set(evidence.passedCheckpointIds || []);
  return phaseDefinitions.map(definition => {
    const phaseModules = mastery.filter(item => definition.moduleIds.some(id => id === item.id));
    const total = phaseModules.reduce((sum, item) => sum + item.total, 0);
    const solved = phaseModules.reduce((sum, item) => sum + item.solved, 0);
    const phaseMastery = Math.round(phaseModules.reduce((sum, item) => sum + item.mastery, 0) / Math.max(phaseModules.length, 1));
    const checkpointTask = checkpointFor(definition.moduleIds);
    const checkpointId = checkpointIdForPhase(definition.id);
    const checkpointPassed = frontier.passedPhaseIds.includes(definition.id)
      || Boolean(checkpointId && passedCheckpointIds.has(checkpointId));
    const unlocked = definition.id === phaseDefinitions[0].id
      || phaseModules.some(item => item.routeState !== 'locked')
      || frontier.action.phaseId === definition.id;
    return {
      ...definition,
      moduleIds: [...definition.moduleIds],
      mastery: phaseMastery,
      solved,
      total,
      checkpointTask,
      checkpointPassed,
      unlocked
    };
  });
}

export function buildDailySession(
  progress: Progress,
  targetMinutes = 25,
  evidence: LearningSessionEvidence = defaultEvidence()
): DailySession {
  const route = buildDailyRoute(progress, targetMinutes, evidence);
  const frontier = route.frontier;
  const mastery = moduleMastery(progress, evidence);
  const primary = frontier.action;

  const focusModule = primary.moduleId
    ? mastery.find(module => module.id === primary.moduleId) || null
    : [...mastery]
        .filter(module => module.routeState !== 'locked' && module.level !== 'mastered')
        .sort((left, right) => left.index - right.index)[0] || null;

  return {
    ...route,
    focusModule,
  };
}

export function overallReadiness(
  progress: Progress,
  evidence: LearningSessionEvidence = defaultEvidence()
) {
  const mastery = moduleMastery(progress, evidence);
  const phases = learningPhases(progress, mastery, evidence);
  const weighted = mastery.reduce((sum, item) => sum + item.mastery, 0) / Math.max(mastery.length, 1);
  const checkpoints = phases.filter(phase => phase.checkpointPassed).length / phases.length * 100;
  const transferTasks = tasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
  const transferSolved = transferTasks.filter(task => hasIndependentTaskEvidence(progress, task.id)).length
    / Math.max(transferTasks.length, 1) * 100;
  return Math.round(clamp(weighted * 0.66 + checkpoints * 0.18 + transferSolved * 0.16));
}

export function readinessLabel(score: number) {
  if (score >= 85) return 'Готов к сложным собеседованиям';
  if (score >= 68) return 'Уверенный рабочий уровень';
  if (score >= 45) return 'База собрана, нужна практика';
  if (score >= 18) return 'Формируется фундамент';
  return 'Маршрут только начинается';
}

export function mentorPlanContext(
  progress: Progress,
  evidence: LearningSessionEvidence = defaultEvidence()
) {
  const mastery = moduleMastery(progress, evidence);
  const session = buildDailySession(progress, 25, evidence);
  const weakest = [...mastery]
    .filter(item => item.routeState !== 'locked')
    .sort((left, right) => left.index - right.index || left.mastery - right.mastery)
    .slice(0, 4);
  return {
    goal: session.frontier.goal,
    nextReasonCode: session.frontier.action.routeReasonCode || null,
    checkpointRemediation: session.frontier.checkpointRemediation
      ? {
          checkpointId: session.frontier.checkpointRemediation.checkpointId,
          score: session.frontier.checkpointRemediation.score,
          modules: session.frontier.checkpointRemediation.modules.map(module => module.moduleTitle)
        }
      : null,
    readiness: overallReadiness(progress, evidence),
    weakest: weakest.map(item => ({ title: item.title, mastery: item.mastery, errors: item.incorrect, hints: item.hints })),
    session: session.items.map(item => ({ title: item.title, reason: item.reason, topic: item.topic })),
    completed: progress.completed.length,
    total: tasks.length
  };
}
