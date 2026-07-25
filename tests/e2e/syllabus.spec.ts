import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { authenticatePage } from './auth-helper';

async function expectAccessible(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

test('desktop syllabus exposes tracks review tools dialects and graded exams', async ({ page }, testInfo) => {
  await authenticatePage(page, 'syllabus');
  await page.goto('./');
  await page.getByTestId('syllabus-trigger').click();

  const dialog = page.getByRole('dialog', { name: /SQL Syllabus Center/i });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('syllabus-map')).toBeVisible();
  await expect(page.getByRole('button', { name: /SQL Fundamentals/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Модули маршрута' })).toBeVisible();

  await page.getByRole('tab', { name: /Повторение/i }).click();
  await expect(page.getByTestId('spaced-review')).toBeVisible();
  await expect(page.getByText('32').first()).toBeVisible();
  await page.getByTestId('reveal-review-answer').click();
  await expect(page.locator('.review-answer')).toBeVisible();
  await page.getByTestId('review-grade-good').click();
  await expect(page.locator('.review-card-top')).toContainText('31 осталось');

  await page.getByRole('tab', { name: /Инструменты/i }).click();
  await expect(page.getByTestId('learning-tools')).toBeVisible();
  await expect(page.getByTestId('schema-explorer')).toBeVisible();
  await page.getByRole('button', { name: /ticket_events/i }).click();
  await expect(page.getByRole('heading', { name: 'ticket_events' })).toBeVisible();
  await page.getByRole('tab', { name: 'Errors' }).click();
  await expect(page.getByTestId('error-atlas')).toBeVisible();
  await page.getByRole('tab', { name: /Performance/i }).click();
  await expect(page.getByRole('heading', { name: /Полный scan вместо индекса/i })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('tab', { name: /Диалекты/i }).click();
  await expect(page.getByTestId('dialect-lab')).toBeVisible();
  await page.getByRole('button', { name: /UPSERT/i }).click();
  await expect(page.getByRole('heading', { name: 'PostgreSQL' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'MySQL' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SQL Server' })).toBeVisible();
  await expect(page.getByText(/ON CONFLICT\(key\)/i).first()).toBeVisible();

  await page.getByRole('tab', { name: /Экзамены/i }).click();
  await expect(page.getByTestId('syllabus-exams')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Diagnostic SQL Check' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Production SQL Exam' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SQL Academy Final' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Сначала prerequisites/i }).first()).toBeDisabled();

  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('syllabus-center-desktop.png'), fullPage: true });
});

test('mobile syllabus tools remain usable without page overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'syllabusmobile');
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByTestId('syllabus-trigger').click();

  await expect(page.getByRole('dialog', { name: /SQL Syllabus Center/i })).toBeVisible();
  await page.getByRole('tab', { name: /Повторение/i }).click();
  await expect(page.getByTestId('spaced-review')).toBeVisible();
  await page.getByTestId('reveal-review-answer').click();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: /Инструменты/i }).click();
  await page.getByRole('tab', { name: 'Errors' }).click();
  await expect(page.getByTestId('error-atlas')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('syllabus-tools-mobile.png'), fullPage: true });
});
