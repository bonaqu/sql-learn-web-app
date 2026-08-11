import { expect, test } from '@playwright/test';
import { authenticatePage } from './auth-helper';
import { openAllTools } from './navigation-helper';

const expectNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
};

test('desktop academy keeps Interview browseable but gates execution before the phase checkpoint', async ({ page }, testInfo) => {
  await authenticatePage(page, 'workspace-preview');
  await page.goto('./');

  await openAllTools(page);
  await page.getByRole('button', { name: 'Интервью', exact: true }).click();

  const firstTask = page.locator('.task-row').first();
  await expect(firstTask).toBeVisible();
  await expect(firstTask).toHaveAttribute('data-readiness', 'preview');
  await expect(firstTask).toContainText(/Задача-интервью · предпросмотр/i);
  await firstTask.click();

  const gate = page.getByTestId('workspace-preview-gate');
  await expect(gate).toBeVisible();
  await expect(gate).toContainText(/Предпросмотр без зачёта/i);
  await expect(gate).toContainText(/контрольн(?:ая|ую) точк/i);
  await expect(page.getByRole('button', { name: /Запуск пока закрыт/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Следующая подсказка' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Решение заблокировано/i })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-workspace-preview.png') });

  await gate.getByRole('button', { name: /Открыть правильный следующий этап/i }).click();
  const curriculum = page.getByTestId('curriculum-studio');
  await expect(curriculum).toBeVisible();
  await expect(curriculum.getByText('Урок 01 / 44')).toBeVisible();
  await expect(curriculum.getByRole('heading', { name: 'SQL-мышление', exact: true })).toBeVisible();
});

test('mobile task flow keeps a preview gate readable without horizontal overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobile-workspace-preview');
  await page.goto('./');

  await openAllTools(page);
  await page.locator('.sidebar').getByRole('button', { name: 'Интервью', exact: true }).click();
  const firstTask = page.locator('.task-row').first();
  await expect(firstTask).toHaveAttribute('data-readiness', 'preview');
  await expect(firstTask).toContainText(/Задача-интервью · предпросмотр/i);
  await firstTask.click();

  const gate = page.getByTestId('workspace-preview-gate');
  await expect(gate).toBeVisible();
  await expect(gate).toContainText(/контрольн(?:ая|ую) точк/i);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-workspace-preview.png'), fullPage: true });
});
