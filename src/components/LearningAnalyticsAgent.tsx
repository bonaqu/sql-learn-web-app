import { useEffect, useRef } from 'react';
import { tasks } from '../data/course-catalog';
import { loadAuthSession } from '../lib/auth';
import {
  activeLearningSession,
  appendLearningEvent,
  ensureExperimentVariant,
  loadLearningAnalyticsState,
  taskForAnalyticsTitle
} from '../lib/learning-analytics';
import { loadProgress, PROGRESS_CHANGED_EVENT, type Progress, type TaskStats } from '../lib/progress';

function delta(next: number | undefined, previous: number | undefined) {
  return Math.max(0, Math.min(50, (next || 0) - (previous || 0)));
}

function ageDays(value: string | undefined) {
  if (!value) return 0;
  return Math.max(0, (Date.now() - new Date(value).getTime()) / 86_400_000);
}

function durationBucket(startedAt: string | undefined) {
  const minutes = startedAt ? Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 60_000) : 0;
  if (minutes < 5) return 'under-5m' as const;
  if (minutes < 15) return '5-15m' as const;
  if (minutes < 30) return '15-30m' as const;
  if (minutes < 60) return '30-60m' as const;
  return '60m-plus' as const;
}

async function recordPlacementCheck(
  task: typeof tasks[number],
  next: TaskStats,
  attempts: number,
  incorrect: number,
  independent: number
) {
  if (attempts <= 0 || !next.lastAttemptAt) return;
  const { loadOnboardingProfile } = await import('../lib/learner-onboarding');
  const profile = loadOnboardingProfile();
  const placement = profile.placement;
  if (placement.status !== 'completed' || !placement.level || !placement.completedAt) return;
  if (new Date(next.lastAttemptAt).getTime() < new Date(placement.completedAt).getTime()) return;
  const taskRank = task.difficulty === 'База' ? 1 : task.difficulty === 'Рабочий' ? 2 : 3;
  const expectedRank = placement.level === 'foundation' || placement.level === 'developing'
    ? 1
    : placement.level === 'working' ? 2 : 3;
  const placementOutcome = independent > 0 && taskRank > expectedRank
    ? 'mismatch-high' as const
    : independent === 0 && incorrect > 0 && taskRank <= expectedRank
      ? 'mismatch-low' as const
      : 'supported' as const;
  appendLearningEvent({
    type: 'placement_checked',
    taskId: task.id,
    moduleId: task.module,
    placementOutcome,
    placementMatch: placementOutcome === 'supported'
  });
}

function recordTaskDelta(taskId: string, next: TaskStats, previous: TaskStats | undefined, nextProgress: Progress, previousProgress: Progress) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return;
  const attempts = delta(next.attempts, previous?.attempts);
  const incorrect = delta(next.incorrect, previous?.incorrect);
  const independent = delta(next.independentPasses, previous?.independentPasses);
  const hints = delta(next.hintsUsed, previous?.hintsUsed);
  const solutions = delta(next.solutionViews, previous?.solutionViews);
  const newlyUnderstood = nextProgress.completed.includes(taskId) && !previousProgress.completed.includes(taskId);

  void recordPlacementCheck(task, next, attempts, incorrect, independent);

  for (let index = 0; index < attempts; index += 1) {
    appendLearningEvent({
      type: 'attempted',
      taskId,
      moduleId: task.module,
      correct: index >= incorrect,
      independent: independent > 0 && index === attempts - 1
    });
  }
  if (incorrect > 0 && next.lastDiagnostic) {
    appendLearningEvent({
      type: 'diagnostic_observed', taskId, moduleId: task.module,
      diagnosticKind: next.lastDiagnostic.kind, correct: false
    });
    if (ageDays(previous?.lastIndependentAt) >= 7) {
      appendLearningEvent({ type: 'lapse_detected', taskId, moduleId: task.module, diagnosticKind: next.lastDiagnostic.kind });
    }
  }
  if (newlyUnderstood) appendLearningEvent({ type: 'understood', taskId, moduleId: task.module, correct: true });
  if (hints > 0) appendLearningEvent({ type: 'remediation_started', taskId, moduleId: task.module, remediation: 'hint' });
  if (solutions > 0) appendLearningEvent({ type: 'remediation_started', taskId, moduleId: task.module, remediation: 'solution' });
  if (independent > 0) {
    const retained = ageDays(previous?.lastIndependentAt) >= 7;
    appendLearningEvent({
      type: retained ? 'retention_checked' : 'independent_pass',
      taskId,
      moduleId: task.module,
      correct: true,
      independent: true
    });
    if ((previous?.incorrect || 0) > 0 || (previous?.hintsUsed || 0) > 0 || (previous?.solutionViews || 0) > 0) {
      appendLearningEvent({
        type: 'remediation_completed', taskId, moduleId: task.module,
        remediation: 'retry', correct: true, independent: true
      });
    }
  }
}

export default function LearningAnalyticsAgent() {
  const previousProgress = useRef<Progress>(loadProgress());
  const lastOpenedTitle = useRef('');

  useEffect(() => {
    const session = loadAuthSession();
    if (!session) return;
    ensureExperimentVariant('remediation-copy-v1', session.userId);
    const sessionId = activeLearningSession(session.userId);
    if (!sessionId) return;
    const state = loadLearningAnalyticsState(session.userId);
    const started = state?.events.some(event => event.sessionId === sessionId && event.type === 'session_started');
    if (!started) appendLearningEvent({ type: 'session_started', sessionId }, session.userId);

    const finish = () => {
      const current = loadLearningAnalyticsState(session.userId);
      const start = current?.events.find(event => event.sessionId === sessionId && event.type === 'session_started');
      const ended = current?.events.some(event => event.sessionId === sessionId && event.type === 'session_ended');
      if (!ended) appendLearningEvent({ type: 'session_ended', sessionId, durationBucket: durationBucket(start?.occurredAt) }, session.userId);
    };
    window.addEventListener('pagehide', finish);
    return () => window.removeEventListener('pagehide', finish);
  }, []);

  useEffect(() => {
    const onProgress = (event: Event) => {
      const next = (event as CustomEvent<Progress>).detail;
      if (!next || next.version !== 4) return;
      const previous = previousProgress.current;
      const taskIds = new Set([...Object.keys(previous.taskStats), ...Object.keys(next.taskStats)]);
      for (const taskId of taskIds) {
        const nextStats = next.taskStats[taskId];
        if (nextStats) recordTaskDelta(taskId, nextStats, previous.taskStats[taskId], next, previous);
      }
      previousProgress.current = next;
    };
    window.addEventListener(PROGRESS_CHANGED_EVENT, onProgress);
    return () => window.removeEventListener(PROGRESS_CHANGED_EVENT, onProgress);
  }, []);

  useEffect(() => {
    const observe = () => {
      const title = document.querySelector<HTMLElement>('.task-title-row h2')?.textContent?.trim() || '';
      if (!title || title === lastOpenedTitle.current) return;
      const task = taskForAnalyticsTitle(title);
      if (!task) return;
      lastOpenedTitle.current = title;
      appendLearningEvent({ type: 'task_opened', taskId: task.id, moduleId: task.module });
    };
    observe();
    const observer = new MutationObserver(observe);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
