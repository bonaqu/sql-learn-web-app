import { expect, test } from '@playwright/test';

const expectNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
};

test('desktop academy workflow is usable and stable', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('./');
  await expect(page.getByRole('heading', { name: /SQL, который работает/i })).toBeVisible();
  await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
  await expectNoHorizontalOverflow(page);

  await page.locator('.sidebar nav').getByRole('button', { name: 'Practice' }).click();
  await expect(page.getByRole('heading', { name: 'Practice Mode' })).toBeVisible();
  await page.locator('.task-row').first().click();

  await expect(page.locator('.editor-panel')).toBeVisible();
  await expect(page.locator('.editor-wrap')).toBeVisible();
  await expect(page.locator('.mentor-panel')).toBeVisible();

  await page.locator('.mentor-panel').getByRole('button', { name: 'Следующий шаг' }).click();
  await expect(page.locator('.mentor-panel .mentor-answer')).not.toContainText('Анализирую текущий SQL');
  await expect(page.locator('.mentor-panel .mentor-answer')).not.toBeEmpty();
  await expectNoHorizontalOverflow(page);

  await page.screenshot({ path: testInfo.outputPath('desktop-academy.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
});

test('mobile task flow uses list-to-editor navigation', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('./');
  await expect(page.locator('.mobile-bottom-nav')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Практика' }).click();
  await expect(page.getByRole('heading', { name: 'Practice Mode' })).toBeVisible();
  await page.locator('.task-row').first().click();

  await expect(page.locator('.catalog-panel')).toBeHidden();
  await expect(page.locator('.editor-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'К списку' })).toBeVisible();

  await page.getByRole('button', { name: 'Развернуть редактор' }).click();
  await expect(page.locator('.editor-panel')).toHaveClass(/fullscreen/);
  await page.getByRole('button', { name: 'Свернуть редактор' }).click();
  await expect(page.locator('.editor-panel')).not.toHaveClass(/fullscreen/);

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-academy.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
});
