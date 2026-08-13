import { expect, test, type Locator } from '@playwright/test';
import { authenticatePage } from './auth-helper';
import { openAdvancedTool, seedFirstLessonEvidence } from './navigation-helper';

const FIRST_SOLUTION = 'SELECT ticket_id, service FROM tickets;';
const FIRST_TRANSFER_SOLUTION = 'SELECT ticket_id, status FROM tickets;';

async function replaceEditorSql(page: import('@playwright/test').Page, sql: string) {
  const editor = page.locator('.editor-panel .monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sql);
}

async function solveConceptCard(card: Locator) {
  const options = card.locator('label');
  for (let index = 0; index < await options.count(); index += 1) {
    await options.nth(index).click();
    await card.getByRole('button', { name: /Проверить рассуждение|Проверить ещё раз/ }).click();
    if (await card.evaluate(element => element.classList.contains('correct'))) return;
  }
  throw new Error('No correct concept-check option found');
}

async function completeFirstLessonTheory(page: import('@playwright/test').Page) {
  await openAdvancedTool(page, 'curriculum-trigger');
  const studio = page.getByRole('dialog', { name: /Учебная программа/i });
  await expect(studio).toBeVisible();
  const loop = studio.getByTestId('beginner-lesson-loop');
  await loop.getByTestId('beginner-prediction').getByRole('radio').nth(1).check();
  await loop.getByRole('button', { name: 'Проверить прогноз' }).click();
  await loop.getByRole('button', { name: 'Выполнить пример' }).click();
  await expect(loop.getByTestId('beginner-example-result')).toBeVisible();
  const faded = loop.getByTestId('beginner-faded-practice');
  await faded.getByRole('textbox', { name: /SQL с пропуском/i }).fill('SELECT ticket_id, status FROM tickets ORDER BY ticket_id;');
  await faded.getByRole('button', { name: 'Проверить мой SQL' }).click();
  await expect(faded).toContainText('форма результата задана явно');

  const conceptPanel = studio.getByTestId('concept-check-panel');
  const cards = conceptPanel.locator('.concept-check-card');
  await expect(cards).toHaveCount(3);
  for (let index = 0; index < await cards.count(); index += 1) await solveConceptCard(cards.nth(index));
  await expect(conceptPanel).toContainText('3/3');
  await expect(studio.getByTestId('lesson-mastery-loop')).toContainText('Реши связанную SQL-задачу');
  await studio.getByRole('button', { name: 'Закрыть учебную программу' }).click();
}

test('desktop mastery loop distinguishes guided success, independent retry and retention evidence', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mastery');
  await page.goto('./');
  await completeFirstLessonTheory(page);

  await page.getByRole('button', { name: 'Практика', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Практика' })).toBeVisible();
  await replaceEditorSql(page, 'SELECT, FROM tickets;');
  await page.getByRole('button', { name: /Проверить SQL/i }).click();
  await expect(page.getByTestId('attempt-diagnostic')).toContainText('Синтаксическая ошибка');
  await expect(page.getByTestId('attempt-diagnostic')).toContainText('Проверь ключевые слова');

  await page.getByRole('button', { name: 'Следующая подсказка' }).click();
  await replaceEditorSql(page, FIRST_SOLUTION);
  await page.getByRole('button', { name: /Проверить SQL/i }).click();
  await expect(page.locator('.feedback.success')).toContainText('использовалась помощь');
  await expect(page.locator('.feedback.success')).toContainText('Самостоятельно: 0');

  await page.getByRole('button', { name: /002 Форма результата: обращение и состояние/ }).click();
  await page.getByRole('button', { name: /001 Форма результата: обращение и сервис/ }).click();
  await replaceEditorSql(page, FIRST_SOLUTION);
  await page.getByRole('button', { name: /Проверить SQL/i }).click();
  await expect(page.locator('.feedback.success')).toContainText('Самостоятельное решение подтверждено');
  await expect(page.locator('.feedback.success')).toContainText('Самостоятельно: 1');

  await openAdvancedTool(page, 'curriculum-trigger');
  const studio = page.getByRole('dialog', { name: /Учебная программа/i });
  await expect(studio.getByText('Получилось самостоятельно', { exact: true }).first()).toBeVisible();
  await expect(studio.getByTestId('lesson-mastery-loop')).toContainText('самостоятельных решения');
  const remediation = studio.getByTestId('lesson-remediation');
  await expect(remediation).toContainText('SQL начинается с синтаксиса');
  await expect(remediation).toContainText('Сначала запиши');
  await page.screenshot({ path: testInfo.outputPath('desktop-mastery-loop.png'), fullPage: true });
  await studio.getByRole('button', { name: 'Закрыть учебную программу' }).click();

  await openAdvancedTool(page, 'syllabus-trigger');
  const syllabus = page.getByRole('dialog', { name: /SQL Syllabus Center/i });
  await syllabus.getByRole('tab', { name: /Повторение/i }).click();
  await expect(syllabus.getByTestId('spaced-review')).toContainText('доступно по учебным сигналам');
  await expect(syllabus.getByTestId('spaced-review')).toContainText('Самооценка меняет только расписание карточки');
  await expect(syllabus.getByTestId('spaced-review')).toContainText('31');
  await expect(syllabus.getByTestId('spaced-review')).toContainText('тем ещё не изучено');
});

test('desktop mastery solution exposure schedules a delayed clean retrieval', async ({ page }) => {
  const externalRequests: string[] = [];
  await page.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      await route.continue();
      return;
    }
    externalRequests.push(url.href);
    await route.abort();
  });
  await authenticatePage(page, 'solutiondebt');
  await page.goto('./');
  await page.getByRole('button', { name: 'Практика', exact: true }).click();
  await seedFirstLessonEvidence(page);
  await page.getByRole('button', { name: /001 Форма результата: обращение и сервис/ }).click();

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: 'Следующая подсказка' }).click();
  }
  await page.getByRole('button', { name: 'Показать решение' }).click();
  await expect(page.locator('.solution-card')).toContainText(FIRST_SOLUTION);
  await expect(page.locator('.feedback')).toContainText('через 10 минут появится связанная, но другая SQL-задача');

  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}');
    const source = state.taskStats?.['task-001'];
    const target = state.taskStats?.['task-002'];
    return {
      solutionViews: source?.solutionViews,
      source: target?.retrievalSourceTaskId,
      due: Boolean(target?.retrievalDueAt),
      independent: source?.independentPasses || 0
    };
  })).toEqual({ solutionViews: 1, source: 'task-001', due: true, independent: 0 });

  await replaceEditorSql(page, FIRST_SOLUTION);
  await page.getByRole('button', { name: /Проверить SQL/i }).click();
  await expect(page.locator('.feedback.success')).toContainText('использовалась помощь');

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}');
    state.taskStats['task-002'].retrievalDueAt = '2000-01-01T00:00:00.000Z';
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole('button', { name: /Повторение/ }).click();
  await page.getByRole('button', { name: /002 Форма результата: обращение и состояние/ }).click();
  await expect(page.getByTestId('review-return-reason')).toContainText('Отложенная проверка');
  await expect(page.getByTestId('review-return-reason')).toContainText('другую задачу');
  await replaceEditorSql(page, FIRST_TRANSFER_SOLUTION);
  await page.getByRole('button', { name: /Проверить SQL/i }).click();
  await expect(page.locator('.feedback.success')).toContainText('прочное освоение');
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}');
    const stats = state.taskStats?.['task-002'];
    return {
      durable: stats?.lastRetrievalPassed,
      interval: stats?.retrievalIntervalDays,
      source: stats?.retrievalSourceTaskId,
      independent: stats?.independentPasses || 0
    };
  })).toEqual({ durable: true, interval: 1, source: 'task-001', independent: 1 });
  expect(externalRequests, 'The SQL editor and mastery loop must work without any external CDN request').toEqual([]);
});

test('mobile mastery returning learner sees why a transfer task is due and can refresh evidence', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobilereturn');
  await page.goto('./');
  await page.getByLabel('Мобильная навигация').getByRole('button', { name: 'Практика', exact: true }).click();
  await seedFirstLessonEvidence(page);
  await page.getByRole('button', { name: /001 Форма результата: обращение и сервис/ }).click();
  await replaceEditorSql(page, FIRST_SOLUTION);
  await page.getByRole('button', { name: /Проверить SQL/i }).click();
  await expect(page.locator('.feedback.success')).toContainText('Через 10 минут');

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}');
    state.taskStats['task-002'].retrievalDueAt = '2000-01-01T00:00:00.000Z';
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('navigation', { name: 'Разделы академии' }).getByRole('button', { name: /Повторение/ }).click();
  await page.getByRole('button', { name: /002 Форма результата: обращение и состояние/ }).click();
  const reason = page.getByTestId('review-return-reason');
  await expect(reason).toContainText('Почему задача вернулась');
  await expect(reason).toContainText('Отложенная проверка');
  await replaceEditorSql(page, FIRST_TRANSFER_SOLUTION);
  await page.getByRole('button', { name: /Проверить SQL/i }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}');
    const stats = state.taskStats?.['task-002'];
    return { passed: stats?.lastRetrievalPassed, interval: stats?.retrievalIntervalDays, source: stats?.retrievalSourceTaskId };
  })).toEqual({ passed: true, interval: 1, source: 'task-001' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('mobile-returning-retrieval.png'), fullPage: true });
});

test('mobile mastery diagnostics remain readable without horizontal overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobilemastery');
  await page.goto('./');
  await page.getByLabel('Мобильная навигация')
    .getByRole('button', { name: 'Практика', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Практика' })).toBeVisible();
  await seedFirstLessonEvidence(page);
  const firstTask = page.getByRole('button', { name: /001 Форма результата: обращение и сервис/ });
  await expect(firstTask).toContainText('Текущий шаг маршрута');
  await firstTask.click();
  await replaceEditorSql(page, 'SELECT missing_column FROM tickets;');
  const runButton = page.getByRole('button', { name: /Проверить SQL/i });
  await expect(runButton).toBeEnabled();
  await runButton.click();
  const diagnostic = page.getByTestId('attempt-diagnostic');
  await expect(diagnostic).toBeVisible();
  await expect(diagnostic).toContainText('Ошибка выполнения');
  await expect(diagnostic).toContainText('Проверь имена таблиц');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('mobile-mastery-diagnostic.png'), fullPage: true });
});
