import { expect, test } from '@playwright/test';

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

test('desktop anonymous account syncs progress across two devices', async ({ page, browser }, testInfo) => {
  await page.goto('./');
  await page.getByTestId('account-trigger').click();
  await page.getByRole('button', { name: /Создать аккаунт/ }).click();

  const recovery = page.getByTestId('recovery-code');
  await expect(recovery).toBeVisible();
  const recoveryCode = (await recovery.textContent())?.trim() || '';
  expect(recoveryCode).toMatch(/^SQLA-(?:[A-Z2-9]{4}-){8}[A-Z2-9]{4}$/);

  await page.getByLabel('Я сохранил recovery-код в безопасном месте').check();
  await page.getByTestId('create-account-confirm').click();
  await expect(page.getByRole('heading', { name: 'Аккаунт готов' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть аккаунт' }).click();

  await page.locator('.sidebar nav').getByRole('button', { name: 'Practice' }).click();
  await page.locator('.task-row').first().click();
  await replaceEditorSql(page, "SELECT ticket_id, service, status FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;");
  await page.getByRole('button', { name: /Проверить SQL/ }).click();
  await expect(page.locator('.feedback.success')).toContainText('Верно');

  await page.waitForTimeout(2200);
  await page.getByTestId('account-trigger').click();
  await page.getByRole('button', { name: 'Синхронизировать сейчас' }).click();
  await expect(page.getByText(/Прогресс синхронизирован|объединены/)).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть аккаунт' }).click();

  const firstDeviceProgress = await page.evaluate(() => JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}'));
  expect(firstDeviceProgress.completed).toContain('task-001');
  const appUrl = page.url();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto(appUrl);
  await secondPage.getByTestId('account-trigger').click();
  await secondPage.getByRole('button', { name: /Подключить существующий/ }).click();
  await secondPage.getByTestId('recovery-input').fill(recoveryCode);
  await secondPage.getByLabel('Название этого устройства').fill('Второе устройство');
  await secondPage.getByTestId('connect-account-confirm').click();

  await expect.poll(async () => secondPage.evaluate(() => {
    const progress = JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}');
    return Array.isArray(progress.completed) && progress.completed.includes('task-001');
  }), { timeout: 20_000 }).toBe(true);

  await expect.poll(async () => secondPage.evaluate(() => Boolean(localStorage.getItem('sql-academy-account-session-v1')))).toBe(true);
  await secondPage.getByTestId('account-trigger').click();
  await expect(secondPage.getByText('Синхронизация активна')).toBeVisible();
  await expect(secondPage.locator('.device-row')).toHaveCount(2);
  await expectNoHorizontalOverflow(secondPage);
  await secondPage.screenshot({ path: testInfo.outputPath('desktop-account-center.png'), fullPage: true });

  await secondContext.close();
});

test('mobile anonymous account recovery onboarding is usable', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.getByTestId('account-trigger').click();
  await expect(page.getByTestId('account-modal')).toBeVisible();
  await page.getByRole('button', { name: /Создать аккаунт/ }).click();

  await expect(page.getByRole('heading', { name: 'Сохрани recovery-код' })).toBeVisible();
  await expect(page.getByTestId('recovery-code')).toBeVisible();
  await expect(page.getByText('Скачать файл')).toBeVisible();
  await expect(page.getByLabel('Я сохранил recovery-код в безопасном месте')).not.toBeChecked();
  await expectNoHorizontalOverflow(page);

  await page.screenshot({ path: testInfo.outputPath('mobile-account-onboarding.png'), fullPage: true });
});
