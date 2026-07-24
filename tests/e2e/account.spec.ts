import { expect, test } from '@playwright/test';
import { TEST_PASSWORD } from './auth-helper';

const WORKER_URL = 'http://127.0.0.1:8787';

const replaceEditorSql = async (page: import('@playwright/test').Page, sql: string) => {
  const editor = page.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sql);
};

const expectNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
};

const uniqueUsername = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.toLowerCase();

test('desktop password account requires login and syncs progress across two devices', async ({ page, browser }, testInfo) => {
  const username = uniqueUsername('desktop_auth');
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Войти в академию' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /SQL, который работает/i })).toBeHidden();

  await page.getByRole('button', { name: 'Регистрация' }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByLabel(/Отображаемое имя/).fill('Первый инженер');
  await page.getByTestId('auth-password').fill(TEST_PASSWORD);
  await page.getByTestId('auth-password-confirm').fill(TEST_PASSWORD);
  await page.getByTestId('auth-submit').click();

  await expect(page.getByTestId('recovery-codes-screen')).toBeVisible();
  const codes = page.getByTestId('recovery-codes').locator('code');
  await expect(codes).toHaveCount(8);
  const recoveryCodes = await codes.allTextContents();
  expect(recoveryCodes.map(code => code.replace(/^\d+/, ''))).toEqual(expect.arrayContaining([
    expect.stringMatching(/^SQLR-(?:[A-Z2-9]{4}-){5}[A-Z2-9]{4}$/)
  ]));
  await expect(page.getByRole('button', { name: 'Подтвердить и продолжить' })).toBeDisabled();
  await page.getByLabel(/Я сохранил все 8 кодов/).check();
  await page.getByTestId('recovery-confirm').click();

  await expect(page.getByRole('heading', { name: /SQL, который работает/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Войти в академию' })).toBeHidden();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Practice' }).click();
  await page.locator('.task-row').first().click();
  await replaceEditorSql(page, "SELECT ticket_id, service, status FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;");
  await page.getByRole('button', { name: /Проверить SQL/ }).click();
  await expect(page.locator('.feedback.success')).toContainText('Верно');
  await page.waitForTimeout(2100);

  const appUrl = page.url();
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto(appUrl);
  await secondPage.getByTestId('auth-username').fill(username);
  await secondPage.getByTestId('auth-password').fill(TEST_PASSWORD);
  await secondPage.getByTestId('auth-submit').click();
  await expect(secondPage.getByRole('heading', { name: /SQL, который работает/i })).toBeVisible();

  await expect.poll(async () => secondPage.evaluate(() => {
    const progress = JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}');
    return Array.isArray(progress.completed) && progress.completed.includes('task-001');
  }), { timeout: 25_000 }).toBe(true);

  await secondPage.getByTestId('profile-trigger').click();
  await expect(secondPage.getByTestId('profile-modal')).toBeVisible();
  await secondPage.getByLabel('Отображаемое имя').fill('SQL Engineer');
  await secondPage.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(secondPage.getByText('Настройки профиля сохранены.')).toBeVisible();
  await secondPage.getByRole('button', { name: 'Сессии' }).click();
  await expect(secondPage.locator('.session-list article')).toHaveCount(2);
  await expectNoHorizontalOverflow(secondPage);
  await secondPage.screenshot({ path: testInfo.outputPath('desktop-password-profile.png') });

  await secondContext.close();
});

test('desktop password recovery consumes a code and revokes sessions', async ({ page }) => {
  const username = uniqueUsername('recovery_auth');
  const registration = await page.request.post(`${WORKER_URL}/api/auth/register`, {
    data: { username, password: TEST_PASSWORD, displayName: '', deviceName: 'Recovery source' }
  });
  expect(registration.ok(), await registration.text()).toBe(true);
  const created = await registration.json() as {
    recoveryCodes: string[];
    session: { token: string };
  };
  expect(created.recoveryCodes).toHaveLength(8);
  const firstCode = created.recoveryCodes[0];
  const secondCode = created.recoveryCodes[1];
  const newPassword = 'A different secure password for 2026!';

  await page.goto('./');
  await page.getByRole('button', { name: /Забыл пароль/ }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-recovery').fill(firstCode);
  await page.getByTestId('auth-password').fill(newPassword);
  await page.getByTestId('auth-password-confirm').fill(newPassword);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByText(/Пароль изменён/)).toBeVisible();

  const oldLogin = await page.request.post(`${WORKER_URL}/api/auth/login`, {
    data: { username, password: TEST_PASSWORD, deviceName: 'Old password' }
  });
  expect(oldLogin.status()).toBe(401);

  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(newPassword);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByRole('heading', { name: /SQL, который работает/i })).toBeVisible();

  const reused = await page.request.post(`${WORKER_URL}/api/auth/password/reset`, {
    data: { username, recoveryCode: firstCode, newPassword: 'Third secure password value 2026!' }
  });
  expect(reused.status()).toBe(400);

  const regenerate = await page.evaluate(async password => {
    const response = await fetch('/api/auth/recovery/regenerate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: password })
    });
    return { status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json() };
  }, newPassword);
  expect(regenerate.status).toBe(429);
  expect(Number(regenerate.retryAfter)).toBeGreaterThan(0);

  const changedAgain = await page.evaluate(async ({ currentPassword, recoveryCode }) => {
    const response = await fetch('/api/auth/password/change', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        currentPassword, recoveryCode, newPassword: 'Fourth secure password value 2026!'
      })
    });
    return { status: response.status, body: await response.json() };
  }, { currentPassword: newPassword, recoveryCode: secondCode });
  expect(changedAgain.status).toBe(200);
  await expect(page.getByRole('heading', { name: 'Войти в академию' })).toBeVisible();
});

test('mobile password registration makes saving eight recovery codes mandatory', async ({ page }, testInfo) => {
  const username = uniqueUsername('mobile_auth');
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Войти в академию' })).toBeVisible();
  await page.getByRole('button', { name: 'Регистрация' }).click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(TEST_PASSWORD);
  await page.getByTestId('auth-password-confirm').fill(TEST_PASSWORD);
  await page.getByTestId('auth-submit').click();

  await expect(page.getByTestId('recovery-codes')).toBeVisible();
  await expect(page.getByTestId('recovery-codes').locator('code')).toHaveCount(8);
  await expect(page.getByTestId('recovery-confirm')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Скачать .txt' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-password-recovery-codes.png') });
});
