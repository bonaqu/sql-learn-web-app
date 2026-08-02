import { type SqlTask, tasks } from '../data/course-catalog';
import type { JourneyAction } from './learning-journey';
import { openDeferredFeature } from './deferred-features';

const CHECKPOINT_REQUEST_KEY = 'sql-academy-checkpoint-open-request';
const OPEN_CHECKPOINT_EVENT = 'sql-academy-open-checkpoint';

function navLabel(task: SqlTask) {
  if (task.mode === 'interview') return 'Interview';
  if (task.mode === 'puzzle') return 'SQL Puzzle';
  return 'Practice';
}

export function openAcademyTask(taskId: string) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return false;

  const desktopNav = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))
    .find(button => button.textContent?.trim().startsWith(navLabel(task)));
  desktopNav?.click();

  let attempts = 0;
  const select = () => {
    const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.task-row'))
      .find(button => button.querySelector('strong')?.textContent === task.title);
    if (row) {
      row.click();
      row.scrollIntoView({ block: 'nearest' });
      return;
    }
    attempts += 1;
    if (attempts < 24) window.setTimeout(select, 60);
  };
  window.setTimeout(select, 40);
  return true;
}

function openCurriculumTarget(target: 'lesson' | 'project', id: string) {
  const params = new URLSearchParams();
  params.set(target, id);
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${params.toString()}`);
  openDeferredFeature('curriculum');
}

export function openAcademyLesson(lessonId: string) {
  if (!lessonId) return false;
  openCurriculumTarget('lesson', lessonId);
  return true;
}

export function openAcademyCheckpoint(checkpointId: string) {
  if (!checkpointId) return false;
  sessionStorage.setItem(CHECKPOINT_REQUEST_KEY, checkpointId);
  window.dispatchEvent(new CustomEvent(OPEN_CHECKPOINT_EVENT, {
    detail: { checkpointId }
  }));
  return true;
}

export function openJourneyDestination(action: JourneyAction) {
  if (action.kind === 'lesson' && action.lessonId) return openAcademyLesson(action.lessonId);
  if (action.kind === 'project' && action.projectId) {
    openCurriculumTarget('project', action.projectId);
    return true;
  }
  if (action.kind === 'checkpoint' && action.checkpointId) return openAcademyCheckpoint(action.checkpointId);
  if (action.kind === 'assessment') {
    openDeferredFeature('assessment');
    return true;
  }
  if (action.kind === 'complete') {
    openDeferredFeature('learning-path');
    return true;
  }
  return false;
}
