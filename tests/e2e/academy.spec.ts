import { expect, test } from '@playwright/test';
import { authenticatePage } from './auth-helper';
import { seedFirstLessonEvidence } from './navigation-helper';

const expectNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
};

const replaceEditorSql = async (page: import('@playwright/test').Page, sql: string) => {
  const editor = page.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sql);
};

const mockMentorWithoutUsingQuota = async (page: import('@playwright/test').Page) => {
  await page.route('**/api/mentor', async route => {
    const origin = route.request().headers().origin || '*';
    const headers = {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, x-profile-id',
      'content-type': 'application/json; charset=utf-8'
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    await route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify({ answer: 'Концепт\n• Сначала сформулируй ожидаемые строки.\n• Затем проверь WHERE и ORDER BY.' })
    });
  });
};

test('desktop academy workflow is usable and shares the authenticated Cloudflare API', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await authenticatePage(page, 'desktop-academy');
  await mockMentorWithoutUsingQuota(page);

  await page.goto('./');
  await expect(page.getByTestId('guided-first-run')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Сначала выберем/i })).toBeVisible();
  await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
  await expectNoHorizontalOverflow(page);

  const cloudHealth = await page.evaluate(async () => {
    const response = await fetch('/api/health');
    return { status: response.status, body: await response.json() };
  });
  expect(cloudHealth.status).toBe(200);
  expect(cloudHealth.body).toMatchObject({ ok: true, d1: true, kv: true, ai: true, progressVersion: 4 });

  const cloudProgress = await page.evaluate(async () => {
    const response = await fetch('/api/progress');
    return { status: response.status, body: await response.json() };
  });
  expect(cloudProgress.status).toBe(200);
  expect(cloudProgress.body).toHaveProperty('progress');

  await page.locator('.sidebar nav').getByRole('button', { name: 'Practice' }).click();
  await expect(page.getByRole('heading', { name: 'Practice Mode' })).toBeVisible();
  await seedFirstLessonEvidence(page);
  const firstTask = page.locator('.task-row').first();
  await expect(firstTask).toContainText('Текущий шаг маршрута');
  await firstTask.click();

  await expect(page.locator('.editor-panel')).toBeVisible();
  await expect(page.locator('.mentor-panel')).toBeVisible();
  const runButton = page.getByRole('button', { name: /Проверить SQL/ });
  await expect(runButton).toBeEnabled();

  await replaceEditorSql(page, "SELECT ticket_id, service, status FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;");
  await runButton.click();
  await expect(page.locator('.feedback.success')).toContainText('Верно');
  await expect(page.locator('.result-table-wrap')).toBeVisible();

  await page.locator('.mentor-panel').getByRole('button', { name: 'Объяснить тему' }).click();
  await expect(page.locator('.mentor-panel .mentor-answer')).toContainText('Концепт');
  await expectNoHorizontalOverflow(page);

  await page.screenshot({ path: testInfo.outputPath('desktop-academy.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
});

test('mobile task flow uses list-to-editor navigation after login', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await authenticatePage(page, 'mobile-academy');

  await page.goto('./');
  await expect(page.locator('.mobile-bottom-nav')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Практика' }).click();
  await expect(page.getByRole('heading', { name: 'Practice Mode' })).toBeVisible();
  await seedFirstLessonEvidence(page);
  const firstTask = page.locator('.task-row').first();
  await expect(firstTask).toContainText('Текущий шаг маршрута');
  await firstTask.click();

  await expect(page.locator('.catalog-panel')).toBeHidden();
  await expect(page.locator('.editor-panel')).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: /Проверить SQL/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'К списку' })).toBeVisible();

  await page.getByRole('button', { name: 'Развернуть редактор' }).click();
  await expect(page.locator('.editor-panel')).toHaveClass(/fullscreen/);
  await page.getByRole('button', { name: 'Свернуть редактор' }).click();
  await expect(page.locator('.editor-panel')).not.toHaveClass(/fullscreen/);

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-academy.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
});
