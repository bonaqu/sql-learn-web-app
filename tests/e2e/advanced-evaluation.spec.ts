import { expect, test, type Page } from '@playwright/test';
import { tasks } from '../../src/data/course-catalog';
import { authenticatePage } from './auth-helper';

const advancedTask = tasks.find(task => task.id === 'task-121')!;

async function replaceEditorSql(page: Page, sql: string) {
  const editor = page.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sql);
}

test('desktop curriculum advanced disposable task rejects persistent writes and accepts its canonical lab offline', async ({ page }, testInfo) => {
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
          hintsUsed: 1,
          assistedPasses: 1,
          independentPasses: 0,
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
  await page.getByRole('button', { name: /121 Докажи target set перед UPDATE/ }).click();

  const runButton = page.getByRole('button', { name: /Проверить SQL/ });
  await replaceEditorSql(page, "UPDATE tickets SET status = 'Closed' WHERE ticket_id = 1001; SELECT ticket_id FROM tickets;");
  await runButton.click();
  await expect(page.locator('.feedback.error')).toContainText('Небезопасный скрипт');
  await expect(page.locator('.feedback.error')).toContainText('TEMP-объектов');

  await page.evaluate(() => navigator.serviceWorker?.ready);
  await page.context().setOffline(true);
  await replaceEditorSql(page, advancedTask.solution);
  await runButton.click();
  await expect(page.locator('.feedback.success')).toContainText('Верно');
  await expect(page.locator('.result-table-wrap')).toBeVisible();
  await expect(page.locator('.result-table-wrap')).toContainText('was_target');
  await page.context().setOffline(false);

  await page.screenshot({ path: testInfo.outputPath('advanced-disposable-evaluation.png'), fullPage: true });
});
