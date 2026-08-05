import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
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
    await card.getByRole('button', { name: /Проверить reasoning|Проверить ещё раз/ }).click();
    if (await card.evaluate(element => element.classList.contains('correct'))) return;
  }
  throw new Error('No correct concept-check option found');
}

test('desktop curriculum studio diagnoses misconceptions and syncs project draft across devices', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'curriculum');
  await page.goto('./');

  const trigger = page.getByTestId('curriculum-trigger');
  await openAdvancedTool(page, 'curriculum-trigger');
  const studio = page.getByRole('dialog', { name: /Curriculum Studio/i });
  await expect(studio).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SQL-мышление', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Выполнить на SQLite/i }).click();
  await expect(page.getByTestId('curriculum-example-result')).toBeVisible();

  const sectionButtons = page.getByRole('button', { name: /Отметить раздел изученным/i });
  await expect(sectionButtons).toHaveCount(3);
  while (await sectionButtons.count()) await sectionButtons.first().click();

  const conceptPanel = page.getByTestId('concept-check-panel');
  await expect(conceptPanel).toBeVisible();
  const cards = conceptPanel.locator('.concept-check-card');
  await expect(cards).toHaveCount(3);

  const explanation = page.getByTestId('concept-check-explanation');
  await explanation.getByLabel('Выбрать индекс').check();
  await explanation.getByRole('button', { name: 'Проверить reasoning' }).click();
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
  await expect(page.getByRole('heading', { name: 'Эта advanced-тема пока закрыта' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Diagnostic SQL Check/i })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.getByRole('tab', { name: /Project Lab/i }).click();
  await expect(page.getByTestId('project-lab')).toBeVisible();
  const draft = page.getByTestId('project-sql-draft');
  await draft.fill('WITH base AS (SELECT * FROM tickets) SELECT service, COUNT(*) FROM base GROUP BY service;');
  await expect(draft).toHaveValue(/WITH base/);
  await expect(page.getByTestId('open-capstone-evaluator')).toBeVisible();
  await expect(page.getByTestId('complete-project')).toBeHidden();
  await page.getByTestId('curriculum-sync').click();
  await expect(page.getByTestId('curriculum-sync')).toContainText('В облаке');

  await expectNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('curriculum-misconception-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Закрыть Curriculum Studio' }).click();
  await expect(trigger).toBeFocused();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username, auth.password);
  await secondPage.goto('./');
  await openAdvancedTool(secondPage, 'curriculum-trigger');
  const secondStudio = secondPage.getByRole('dialog', { name: /Curriculum Studio/i });
  await secondStudio.getByTestId('curriculum-sync').click();
  await expect(secondStudio.getByTestId('curriculum-sync')).toContainText('В облаке');
  await secondPage.getByRole('tab', { name: /Project Lab/i }).click();
  await expect(secondPage.getByTestId('project-sql-draft')).toHaveValue(/WITH base/);
  await expect(secondPage.getByTestId('open-capstone-evaluator')).toBeVisible();
  await secondContext.close();
});

test('mobile misconception curriculum remains accessible without horizontal overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'curriculummobile');
  await page.goto('./');
  await openAdvancedTool(page, 'curriculum-trigger');
  const studio = page.getByRole('dialog', { name: /Curriculum Studio/i });
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
