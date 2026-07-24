import { expect, test } from '@playwright/test';
import { authenticatePage, loginPage } from './auth-helper';

const QUICK_FIRST_SOLUTION = "SELECT ticket_id, service, status FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;";
const PROGRESS_KEY = 'sql-academy-progress-v4';
const AUTH_KEY = 'sql-academy-auth-session-v2';

const expectNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
};

const replaceEditorSql = async (page: import('@playwright/test').Page, sql: string) => {
  const editor = page.locator('.assessment-editor-panel .monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sql);
};

const waitForInitialCloudHydration = async (page: import('@playwright/test').Page) => {
  await expect.poll(async () => page.evaluate(key => {
    const session = JSON.parse(localStorage.getItem(key) || 'null');
    return Number(session?.revision || 0);
  }, AUTH_KEY), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: /SQL, который работает/i })).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.locator('.auth-loading-screen')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /SQL, который работает/i })).toBeVisible();
};

function practicedProgress() {
  const completed = Array.from({ length: 24 }, (_, index) => `task-${String(index + 1).padStart(3, '0')}`);
  return {
    version: 4,
    completed,
    taskStats: Object.fromEntries(completed.map((id, index) => [id, {
      attempts: index % 3 + 1,
      incorrect: index % 2,
      hintsUsed: index % 5 === 0 ? 1 : 0,
      completedAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString()
    }])),
    xp: 2400,
    streak: 4,
    history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 1 })),
    lastTask: completed.at(-1),
    lastStudyDate: new Date().toISOString().slice(0, 10)
  };
}

test('desktop assessment resumes, scores SQL and syncs report to a second device', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'assess');
  await page.goto('./');
  await page.getByTestId('assessment-trigger').click();
  await expect(page.getByTestId('assessment-landing')).toBeVisible();
  await page.getByTestId('start-quick').click();

  const center = page.getByTestId('assessment-center');
  await expect(page.getByTestId('assessment-session')).toBeVisible();
  await expect(page.getByTestId('assessment-timer')).toContainText(/\d{2}:\d{2}/);
  await expect(page.getByTestId('assessment-locked-tools')).toBeVisible();
  await expect(center.getByRole('button', { name: /Следующая подсказка/i })).toHaveCount(0);
  await expect(center.getByRole('button', { name: /Показать решение/i })).toHaveCount(0);
  await expect(center.getByText('AI Mentor', { exact: true })).toHaveCount(0);

  await replaceEditorSql(page, QUICK_FIRST_SOLUTION);
  await page.getByRole('button', { name: 'Проверить SQL' }).click();
  await expect(page.locator('.assessment-feedback.success')).toContainText('Результат совпал');
  await expect(page.getByTestId('assessment-result')).toBeVisible();

  const sessionKey = `sql-academy-assessment-session-v1:${String(auth.session.userId)}`;
  await expect.poll(() => page.evaluate(key => Boolean(localStorage.getItem(key)), sessionKey)).toBe(true);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('assessment-session')).toBeVisible();
  await expect(page.locator('.assessment-progress-strip button').first()).toHaveClass(/correct/);

  await page.getByRole('button', { name: 'Завершить досрочно' }).click();
  await expect(page.getByTestId('assessment-report')).toBeVisible();
  await expect(page.locator('.assessment-report-score strong')).not.toHaveText('0');
  await expect(page.getByText('Skill report синхронизирован с аккаунтом.')).toBeVisible();
  await page.getByRole('button', { name: /Получить AI Debrief/ }).click();
  await expect(page.locator('.assessment-debrief-card pre')).not.toContainText('Анализирую');
  await page.screenshot({ path: testInfo.outputPath('desktop-assessment-report.png'), fullPage: true });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username);
  await secondPage.goto(page.url().split('#')[0]);
  await secondPage.getByTestId('assessment-trigger').click();
  await expect(secondPage.getByTestId('assessment-landing')).toBeVisible();
  await expect(secondPage.locator('.assessment-history-list').getByText('Quick Check').first()).toBeVisible();
  await expectNoHorizontalOverflow(secondPage);
  await secondContext.close();
});

test('desktop assessment enforces exam integrity and restores an expired session as a report', async ({ page }) => {
  const auth = await authenticatePage(page, 'expiry');
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: PROGRESS_KEY,
    value: practicedProgress()
  });
  await page.goto('./');
  await waitForInitialCloudHydration(page);
  await page.getByTestId('assessment-trigger').click();
  await page.getByTestId('start-exam').click();

  const center = page.getByTestId('assessment-center');
  await expect(page.getByTestId('assessment-session')).toBeVisible();
  await expect(page.getByTestId('assessment-interviewer')).toHaveCount(0);
  await expect(center.getByRole('button', { name: /Следующая подсказка/i })).toHaveCount(0);
  await expect(center.getByRole('button', { name: /Показать решение/i })).toHaveCount(0);

  const sessionKey = `sql-academy-assessment-session-v1:${String(auth.session.userId)}`;
  await page.evaluate(key => {
    const session = JSON.parse(localStorage.getItem(key) || 'null');
    session.deadlineAt = new Date(Date.now() - 2_000).toISOString();
    localStorage.setItem(key, JSON.stringify(session));
  }, sessionKey);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('assessment-report')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/Время истекло/)).toBeVisible();
  await expect(page.locator('.assessment-task-score')).toHaveCount(8);
});

test('desktop assessment interview allows bounded clarification without exposing a solution', async ({ page }) => {
  await authenticatePage(page, 'interview');
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: PROGRESS_KEY,
    value: practicedProgress()
  });
  await page.goto('./');
  await waitForInitialCloudHydration(page);
  await page.getByTestId('assessment-trigger').click();
  await page.getByTestId('start-interview').click();
  await expect(page.getByTestId('assessment-interviewer')).toBeVisible();
  await page.getByPlaceholder('Задай уточняющий вопрос о требованиях…').fill('Нужна ли стабильная сортировка результата?');
  const askButton = page.getByRole('button', { name: 'Спросить' });
  await expect(askButton).toBeEnabled();
  await askButton.click();
  await expect(page.locator('.assessment-interviewer p')).not.toContainText('AI Interviewer может');
  await expect(page.locator('.assessment-interviewer')).toContainText('Осталось уточнений: 1');
  await expect(page.locator('.assessment-interviewer p')).not.toContainText(/SELECT\s/i);
});

test('mobile assessment landing and recovery-safe session UI fit Pixel 7', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobileassess');
  await page.goto('./');
  await page.getByTestId('assessment-mobile-trigger').click();
  await expect(page.getByTestId('assessment-landing')).toBeVisible();
  await expect(page.locator('.assessment-mode-card')).toHaveCount(3);
  await page.getByTestId('start-quick').click();
  await expect(page.getByTestId('assessment-session')).toBeVisible();
  await expect(page.getByTestId('assessment-locked-tools')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-assessment-session.png'), fullPage: true });
});
