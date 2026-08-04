import { tasks } from '../data/course-catalog';
import { loadAuthSession } from './auth';
import {
  checkpointById,
  checkpointDurationMinutes,
  checkpointEligibility,
  loadLocalCheckpointReports,
  type CheckpointAnswer,
  type CheckpointSession
} from './checkpoints';
import type { Progress } from './progress';

export function prepareCheckpointSession(
  checkpointId: string,
  progress: Progress,
  reports = loadLocalCheckpointReports(),
  now = new Date()
): CheckpointSession {
  const auth = loadAuthSession();
  if (!auth) throw new Error('Необходим вход в аккаунт');

  const eligibility = checkpointEligibility(checkpointId, progress, reports);
  if (!eligibility.eligible) {
    throw new Error(eligibility.blockers.join('. ') || 'Checkpoint пока закрыт');
  }
  const checkpoint = checkpointById(checkpointId);
  if (!checkpoint) throw new Error(`Unknown checkpoint ${checkpointId}`);

  const selected = checkpoint.taskIds.flatMap(taskId => {
    const task = tasks.find(item => item.id === taskId);
    return task ? [task] : [];
  });
  if (selected.length !== checkpoint.taskIds.length) {
    throw new Error('Checkpoint содержит неизвестные задачи');
  }
  if (new Set(selected.map(task => task.id)).size !== selected.length) {
    throw new Error('Checkpoint содержит повторяющиеся задачи');
  }
  if (selected.some(task => !checkpoint.moduleIds.includes(task.module as never))) {
    throw new Error('Checkpoint содержит задачу из чужого модуля');
  }

  const startedAt = now.toISOString();
  const answers: Record<string, CheckpointAnswer> = Object.fromEntries(selected.map(task => [task.id, {
    taskId: task.id,
    sql: task.starter,
    attempts: 0,
    incorrect: 0,
    correct: false,
    skipped: false,
    elapsedSeconds: 0,
    startedAt
  }]));

  return {
    version: 1,
    id: crypto.randomUUID(),
    userId: auth.userId,
    checkpointId,
    status: 'active',
    startedAt,
    updatedAt: startedAt,
    deadlineAt: new Date(now.getTime() + checkpointDurationMinutes(checkpointId) * 60_000).toISOString(),
    taskIds: selected.map(task => task.id),
    currentIndex: 0,
    answers
  };
}
