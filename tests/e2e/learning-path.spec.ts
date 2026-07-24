import { expect, test } from '@playwright/test';

const expectNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
};

test('desktop adaptive learning path builds a session and opens a task', async ({ page }, testInfo) => {
  await page.route('**/api/mentor', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answer: 'Персональный план\n• Закрепи фильтрацию\n• Реши одну новую задачу\n• Заверши контрольной точкой' })
    });
  });

  await page.goto('./');
  await page.getByTestId('learning-path-trigger').click();
  await expect(page.getByTestId('learning-path')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Понятный путь к рабочему SQL/ })).toBeVisible();
  await expect(page.locator('.phase-card')).toHaveCount(4);
  const sessionTasks = await page.locator('.session-list > button').count();
  expect(sessionTasks).toBeGreaterThanOrEqual(2);
  expect(sessionTasks).toBeLessThanOrEqual(6);
  await expect(page.locator('.readiness-ring strong')).toHaveText('0%');

  await page.getByRole('button', { name: 'AI-план' }).click();
  await expect(page.locator('.path-ai-answer')).toContainText('Персональный план');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-learning-path.png'), fullPage: true });

  await page.locator('.session-list > button').first().click();
  await expect(page.getByTestId('learning-path')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Practice Mode' })).toBeVisible();
  await expect(page.locator('.editor-panel')).toBeVisible();
});

test('mobile adaptive learning path remains usable and responsive', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.getByTestId('learning-path-mobile-trigger').click();
  await expect(page.getByTestId('learning-path')).toBeVisible();
  await expect(page.locator('.readiness-ring')).toBeVisible();
  await expect(page.locator('.phase-card')).toHaveCount(4);
  await expect(page.locator('.session-list > button').first()).toBeVisible();

  await page.locator('.path-top-actions select').selectOption('15');
  await expect(page.getByRole('heading', { name: /Сессия на/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-learning-path.png'), fullPage: true });

  await page.getByRole('button', { name: 'Закрыть учебный путь' }).click();
  await expect(page.getByTestId('learning-path')).toBeHidden();
});
