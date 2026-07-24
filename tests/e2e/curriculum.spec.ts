import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { authenticatePage } from './auth-helper';

async function expectNoSeriousAxeViolations(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test('desktop curriculum studio completes a lesson and persists project draft', async ({ page }, testInfo) => {
  await authenticatePage(page, 'curriculum');
  await page.goto('./');

  const trigger = page.getByTestId('curriculum-trigger');
  await trigger.click();
  const studio = page.getByRole('dialog', { name: /Curriculum Studio/i });
  await expect(studio).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SQL-мышление', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Выполнить на SQLite/i }).click();
  await expect(page.getByTestId('curriculum-example-result')).toBeVisible();

  const sectionButtons = page.getByRole('button', { name: /Отметить раздел изученным/i });
  await expect(sectionButtons).toHaveCount(3);
  while (await sectionButtons.count()) await sectionButtons.first().click();

  await page.getByLabel('Описать одну строку и столбцы результата').check();
  await page.getByRole('button', { name: 'Проверить ответ' }).click();
  await expect(page.getByText('Урок завершён')).toBeVisible();

  await page.getByRole('tab', { name: /Project Lab/i }).click();
  await expect(page.getByTestId('project-lab')).toBeVisible();
  const draft = page.getByTestId('project-sql-draft');
  await draft.fill('WITH base AS (SELECT * FROM tickets) SELECT service, COUNT(*) FROM base GROUP BY service;');
  await expect(draft).toHaveValue(/WITH base/);

  await page.getByRole('button', { name: /Отметить: Надёжный базовый набор/i }).click();
  await page.getByRole('button', { name: /Отметить: Сервисные метрики/i }).click();
  await page.getByRole('button', { name: /Отметить: Приоритет внимания/i }).click();
  await page.getByTestId('complete-project').click();
  await expect(page.getByText('Проект завершён')).toBeVisible();

  await expectNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('curriculum-project-lab-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Закрыть Curriculum Studio' }).click();
  await expect(trigger).toBeFocused();
  await page.reload();
  await page.getByTestId('curriculum-trigger').click();
  await page.getByRole('tab', { name: /Project Lab/i }).click();
  await expect(page.getByTestId('project-sql-draft')).toHaveValue(/WITH base/);
});

test('mobile curriculum reader remains accessible without horizontal overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'curriculummobile');
  await page.goto('./');
  await page.getByTestId('curriculum-mobile-trigger').click();
  const studio = page.getByRole('dialog', { name: /Curriculum Studio/i });
  await expect(studio).toBeVisible();
  await expect(page.getByTestId('curriculum-reader')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await expectNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('curriculum-reader-mobile.png'), fullPage: true });
});
