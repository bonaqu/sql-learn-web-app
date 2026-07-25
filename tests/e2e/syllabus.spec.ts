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

test('desktop syllabus exposes tracks dialects and graded exams', async ({ page }, testInfo) => {
  await authenticatePage(page, 'syllabus');
  await page.goto('./');
  await page.getByTestId('syllabus-trigger').click();

  const dialog = page.getByRole('dialog', { name: /SQL Syllabus Center/i });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('syllabus-map')).toBeVisible();
  await expect(page.getByRole('button', { name: /SQL Fundamentals/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Модули маршрута' })).toBeVisible();

  await page.getByRole('tab', { name: /Dialect Lab/i }).click();
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

  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('syllabus-center-desktop.png'), fullPage: true });
});

test('mobile syllabus opens from sidebar without horizontal overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'syllabusmobile');
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByTestId('syllabus-trigger').click();

  await expect(page.getByRole('dialog', { name: /SQL Syllabus Center/i })).toBeVisible();
  await page.getByRole('tab', { name: /Dialect Lab/i }).click();
  await expect(page.getByTestId('dialect-lab')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('syllabus-center-mobile.png'), fullPage: true });
});
