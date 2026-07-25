import { SqlTask, tasks } from '../data/course-catalog';

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
