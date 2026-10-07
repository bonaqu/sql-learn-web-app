import { expect, test, type Page } from '@playwright/test';
import { tasks } from '../../src/data/course-catalog';
import { authenticatePage } from './auth-helper';

const advancedTask = tasks.find(task => task.id === 'task-121')!;
const visibleDataCollision = advancedTask.solution.replace(
  /SELECT q\.ticket_id[\s\S]*$/,
  `SELECT 101 AS ticket_id, 'VPN' AS service, 'Open' AS status, 'High' AS priority, 1 AS was_target
   UNION ALL SELECT 102, 'VPN', 'Closed', 'Low', 0
   UNION ALL SELECT 103, 'LMS', 'Open', 'Low', 0
   UNION ALL SELECT 104, 'VPN', 'Open', 'Critical', 0;`
);

async function replaceEditorSql(page: Page, sql: string) {
  const editor = page.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sql);
}

test('desktop curriculum advanced disposable task rejects persistent writes and accepts its canonical lab offline', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await authenticatePage(page, 'advanced-evaluator');
  await page.goto('./');
  await page.evaluate(taskId => {
    const completedAt = new Date().toISOString();
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify({
      version: 4,
      completed: [taskId],
      taskStats: {
        [taskId]: {
          attempts: 1,
          incorrect: 0,
          hintsUsed: 0,
          assistedPasses: 0,
          independentPasses: 1,
          completedAt,
          lastAttemptAt: completedAt
        }
      },
      xp: 0,
      streak: 1,
      history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 })),
      lastStudyDate: completedAt.slice(0, 10)
    }));
  }, advancedTask.id);
  await page.reload();

  await page.locator('.sidebar nav').getByRole('button', { name: 'Практика' }).click();
  await page.getByLabel('Фильтр по модулю').selectOption('dml');
  const taskRow = page.getByRole('button', { name: /121 Докажи target set перед UPDATE/ });
  await expect(taskRow).toContainText('решение в истории');
  await expect(taskRow).toContainText('Нужна новая проверка');
  await expect(taskRow).not.toContainText('самостоятельно ✓');
  await taskRow.click();

  const runButton = page.getByRole('button', { name: /Проверить SQL/ });
  await replaceEditorSql(page, "UPDATE tickets SET status = 'Closed' WHERE ticket_id = 1001; SELECT ticket_id FROM tickets;");
  await runButton.click();
  await expect(page.locator('.feedback.error')).toContainText('Небезопасный скрипт');
  await expect(page.locator('.feedback.error')).toContainText('TEMP-объектов');

  await replaceEditorSql(page, visibleDataCollision);
  await runButton.click();
  await expect(page.locator('.feedback.error')).toContainText('Логика не выдержала новый набор');
  await expect(page.locator('.feedback.error')).toContainText('Вычисляй ответ из таблиц');

  await page.evaluate(() => navigator.serviceWorker?.ready);
  await page.context().setOffline(true);
  await replaceEditorSql(page, advancedTask.solution);
  await runButton.click();
  await expect(page.locator('.feedback.success')).toContainText('Верно');
  await expect(taskRow).toContainText('самостоятельно ✓');
  await expect(page.locator('.result-table-wrap')).toBeVisible();
  await expect(page.locator('.result-table-wrap')).toContainText('was_target');
  await expect.poll(() => page.evaluate(taskId => {
    const progress = JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}');
    const stats = progress.taskStats?.[taskId];
    return {
      evidenceVersion: stats?.evidenceContractVersion,
      evaluationVersion: stats?.evaluationContractVersion,
      fixtureCount: stats?.validatedFixtureIds?.length || 0,
      hiddenCount: stats?.hiddenFixtureIds?.length || 0
    };
  }, advancedTask.id)).toEqual({
    evidenceVersion: 'advanced-evidence-v1',
    evaluationVersion: 'advanced-task-evaluation-v1',
    fixtureCount: 3,
    hiddenCount: 2
  });
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(async taskId => {
    const response = await fetch('/api/user/progress');
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.progress?.taskStats?.[taskId]?.evidenceContractVersion || null;
  }, advancedTask.id)).toBe('advanced-evidence-v1');

  await page.locator('.feedback.success').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('advanced-disposable-evaluation.png'), fullPage: false });
  await page.reload();
  await expect.poll(() => page.evaluate(taskId => {
    const progress = JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}');
    return [...(progress.taskStats?.[taskId]?.validatedFixtureIds || [])].sort();
  }, advancedTask.id)).toEqual(['public-disposable', 'task-121:hidden-state-variation', 'task-121:adversarial-reduction'].sort());
  expect(pageErrors).toEqual([]);
});
