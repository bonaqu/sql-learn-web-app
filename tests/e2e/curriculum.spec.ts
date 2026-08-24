import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { tasks } from '../../src/data/course-catalog';
import { authenticatePage, loginPage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

async function expectNoSeriousAxeViolations(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function solveConceptCard(card: import('@playwright/test').Locator) {
  const options = card.locator('label');
  for (let index = 0; index < await options.count(); index += 1) {
    await options.nth(index).click();
    await card.getByRole('button', { name: /Проверить рассуждение|Проверить ещё раз/ }).click();
    if (await card.evaluate(element => element.classList.contains('correct'))) return;
  }
  throw new Error('No correct concept-check option found');
}

async function completeBeginnerLoop(studio: import('@playwright/test').Locator) {
  const loop = studio.getByTestId('beginner-lesson-loop');
  await loop.getByTestId('beginner-prediction').getByRole('radio').nth(1).check();
  await loop.getByRole('button', { name: 'Проверить прогноз' }).click();
  await loop.getByRole('button', { name: 'Выполнить пример' }).click();
  await expect(loop.getByTestId('beginner-example-result')).toBeVisible();
  const faded = loop.getByTestId('beginner-faded-practice');
  await faded.getByRole('textbox', { name: /SQL с пропуском/i }).fill('SELECT ticket_id, resolution_minutes FROM tickets ORDER BY ticket_id;');
  await faded.getByRole('button', { name: 'Проверить мой SQL' }).click();
  await expect(faded).toContainText('неизвестное время осталось NULL');
}

async function replacePracticeSql(page: import('@playwright/test').Page, sql: string) {
  const editor = page.locator('.editor-panel .monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sql);
}

test('desktop curriculum honest foundation gate unlocks filtering only after four independent prerequisite contracts', async ({ page }, testInfo) => {
  await authenticatePage(page, 'foundationgate');
  await page.goto('./');
  await openAdvancedTool(page, 'curriculum-trigger');

  const studio = page.getByRole('dialog', { name: /Учебная программа/i });
  await expect(studio).toBeVisible();
  await expect(studio.getByRole('heading', { name: 'SQL-мышление', exact: true })).toBeVisible();
  await completeBeginnerLoop(studio);
  const cards = studio.getByTestId('concept-check-panel').locator('.concept-check-card');
  await expect(cards).toHaveCount(3);
  for (let index = 0; index < await cards.count(); index += 1) await solveConceptCard(cards.nth(index));
  await expect.poll(() => page.evaluate(() => {
    return Object.keys(localStorage)
      .filter(key => key.startsWith('sql-academy-curriculum-progress-v1:'))
      .map(key => {
        const state = JSON.parse(localStorage.getItem(key) || 'null');
        return {
          key,
          sections: Array.isArray(state?.completedSections) ? state.completedSections.length : 0,
          correctAnswers: state?.answers
            ? Object.values(state.answers).filter(answer => (answer as { correct?: boolean }).correct).length
            : 0,
          completed: Boolean(state?.completedLessons?.includes('lesson-sql-thinking'))
        };
      });
  })).toContainEqual(expect.objectContaining({ sections: 3, correctAnswers: 3, completed: true }));

  await studio.getByLabel('Поиск по урокам').fill('Фильтрация');
  await studio.getByRole('button', { name: /Фильтрация.*закрыто/i }).click();
  await expect(studio.getByTestId('curriculum-access-gate')).toBeVisible();

  await studio.getByLabel('Поиск по урокам').fill('SQL-мышление');
  await studio.getByRole('button', { name: /SQL-мышление/i }).first().click();
  const corridor = tasks.filter(task => task.module === 'sql-thinking' && (task.mode === 'lesson' || task.mode === 'practice'));
  expect(corridor).toHaveLength(4);
  await studio.locator('.curriculum-practice-links button').first().click();
  await expect(studio).toBeHidden();

  for (const task of corridor) {
    const taskRow = page.locator('.task-row').filter({ has: page.getByText(task.title, { exact: true }) });
    await taskRow.click();
    await replacePracticeSql(page, task.solution);
    const run = page.getByRole('button', { name: /Проверить SQL/i });
    await expect(run).toBeEnabled();
    await run.click();
    await expect(page.locator('.feedback.success')).toContainText('Самостоятельное решение подтверждено');
    await expect.poll(() => page.evaluate(({ key, taskId }) => {
      const progress = JSON.parse(localStorage.getItem(key) || 'null');
      const stats = progress?.taskStats?.[taskId];
      return {
        independentPasses: Number(stats?.independentPasses || 0),
        evidenceVersion: String(stats?.evidenceContractVersion || ''),
        fixtures: Array.isArray(stats?.validatedFixtureIds) ? stats.validatedFixtureIds.length : 0,
        hidden: Array.isArray(stats?.hiddenFixtureIds) ? stats.hiddenFixtureIds.length : 0
      };
    }, { key: 'sql-academy-progress-v4', taskId: task.id })).toEqual({
      independentPasses: 1,
      evidenceVersion: 'foundation-evidence-v1',
      fixtures: 3,
      hidden: 2
    });
  }

  await expect(page.getByTestId('workspace-next-step')).toBeVisible();
  await openAdvancedTool(page, 'curriculum-trigger');
  await studio.getByLabel('Поиск по урокам').fill('Фильтрация');
  await studio.getByRole('button', { name: /Фильтрация/i }).first().click();
  await expect(studio.getByTestId('curriculum-access-gate')).toHaveCount(0);
  await expect(studio.getByRole('heading', { name: 'Фильтрация', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('foundation-gate-honest-unlock.png'), fullPage: true });
});

test('desktop curriculum studio diagnoses misconceptions and syncs project draft across devices', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'curriculum');
  await page.goto('./');

  const trigger = page.getByTestId('curriculum-trigger');
  await openAdvancedTool(page, 'curriculum-trigger');
  const studio = page.getByRole('dialog', { name: /Учебная программа/i });
  await expect(studio).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SQL-мышление', exact: true })).toBeVisible();

  await completeBeginnerLoop(studio);

  const conceptPanel = page.getByTestId('concept-check-panel');
  await expect(conceptPanel).toBeVisible();
  const cards = conceptPanel.locator('.concept-check-card');
  await expect(cards).toHaveCount(3);

  const explanation = page.getByTestId('concept-check-explanation');
  await explanation.getByLabel('Выбрать индекс').check();
  await explanation.getByRole('button', { name: 'Проверить рассуждение' }).click();
  await expect(explanation.getByText(/Заблуждение:/)).toBeVisible();
  await expect(explanation.locator('.concept-option-feedback')).toContainText(/Сначала|контракт|результат/i);
  await explanation.getByLabel('Описать одну строку и столбцы результата').check();
  await explanation.getByRole('button', { name: /Проверить ещё раз/ }).click();
  await expect(explanation).toHaveClass(/correct/);

  for (let index = 1; index < await cards.count(); index += 1) await solveConceptCard(cards.nth(index));
  await expect(conceptPanel).toContainText('3/3');
  await expect(page.getByTestId('lesson-mastery-loop')).toContainText('Применить самостоятельно');
  await expect(page.getByTestId('lesson-mastery-loop')).toContainText('Реши связанную SQL-задачу');

  await page.getByLabel('Поиск по урокам').fill('DML');
  await page.getByRole('button', { name: /DML и безопасные изменения: основа, закрыто/i }).click();
  await expect(page.getByTestId('curriculum-access-gate')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Эта тема пока закрыта' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Проверить SQL-знания/i })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.getByRole('tab', { name: /Project Lab/i }).click();
  await expect(page.getByTestId('project-lab')).toBeVisible();
  const draft = page.getByTestId('project-sql-draft');
  await draft.fill('WITH base AS (SELECT * FROM tickets) SELECT service, COUNT(*) FROM base GROUP BY service;');
  await expect(draft).toHaveValue(/WITH base/);
  await expect(page.getByTestId('open-capstone-evaluator')).toBeVisible();
  await expect(page.getByTestId('complete-project')).toBeHidden();
  await page.getByTestId('curriculum-sync').click();
  await expect(page.getByTestId('curriculum-sync')).toContainText('В облаке', { timeout: 25_000 });

  await expectNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('curriculum-misconception-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Закрыть учебную программу' }).click();
  await expect(trigger).toBeFocused();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username, auth.password);
  await secondPage.goto('./');
  await openAdvancedTool(secondPage, 'curriculum-trigger');
  const secondStudio = secondPage.getByRole('dialog', { name: /Учебная программа/i });
  await secondStudio.getByTestId('curriculum-sync').click();
  await expect(secondStudio.getByTestId('curriculum-sync')).toContainText('В облаке', { timeout: 25_000 });
  await secondPage.getByRole('tab', { name: /Project Lab/i }).click();
  await expect(secondPage.getByTestId('project-sql-draft')).toHaveValue(/WITH base/);
  await expect(secondPage.getByTestId('open-capstone-evaluator')).toBeVisible();
  await secondContext.close();
});

test('mobile misconception curriculum remains accessible without horizontal overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'curriculummobile');
  await page.goto('./');
  await openAdvancedTool(page, 'curriculum-trigger');
  const studio = page.getByRole('dialog', { name: /Учебная программа/i });
  await expect(studio).toBeVisible();
  await expect(page.getByTestId('curriculum-reader')).toBeVisible();
  await expect(page.getByTestId('concept-check-panel')).toBeVisible();
  await expect(page.getByTestId('concept-check-diagnosis')).toBeVisible();
  await expect(page.getByTestId('lesson-mastery-loop')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await expectNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('curriculum-misconception-mobile.png'), fullPage: true });
});
