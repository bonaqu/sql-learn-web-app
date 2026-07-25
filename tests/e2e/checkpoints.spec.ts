import { expect, test } from '@playwright/test';
import { authenticatePage, loginPage } from './auth-helper';

const PROGRESS_KEY = 'sql-academy-progress-v4';
const AUTH_KEY = 'sql-academy-auth-session-v2';
const FIRST_CHECKPOINT_SOLUTION = "SELECT ticket_id, service, status FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;";

function checkpointReadyProgress() {
  const completed = Array.from({ length: 30 }, (_, index) => `task-${String(index + 1).padStart(3, '0')}`);
  return {
    version: 4,
    completed,
    taskStats: Object.fromEntries(completed.map(id => [id, {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      completedAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString()
    }])),
    xp: 3600,
    streak: 5,
    history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 2 })),
    lastTask: completed.at(-1),
    lastStudyDate: new Date().toISOString().slice(0, 10)
  };
}

async function waitForHydration(page: import('@playwright/test').Page) {
  await expect.poll(async () => page.evaluate(key => {
    const session = JSON.parse(localStorage.getItem(key) || 'null');
    return Number(session?.revision || 0);
  }, AUTH_KEY), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.locator('.auth-loading-screen')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /SQL, который работает/i })).toBeVisible();
  await page.waitForTimeout(900);
}

async function replaceEditorSql(page: import('@playwright/test').Page, sql: string) {
  const editor = page.locator('.assessment-editor-panel .monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sql);
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

test('desktop checkpoint retries offline evidence sync and hydrates Learning Path on a second device', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'checkpoint');
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: PROGRESS_KEY,
    value: checkpointReadyProgress()
  });
  await page.goto('./');
  await waitForHydration(page);

  await page.getByTestId('checkpoint-trigger').click();
  await expect(page.getByTestId('checkpoint-landing')).toBeVisible();
  await expect(page.locator('.assessment-mode-card')).toHaveCount(8);
  await expect(page.getByTestId('start-checkpoint-foundation')).toBeEnabled();
  await page.getByTestId('start-checkpoint-foundation').click();

  const checkpointSession = page.getByTestId('checkpoint-session');
  await expect(checkpointSession).toBeVisible();
  await expect(checkpointSession.locator('.assessment-progress-strip button')).toHaveCount(5);
  await expect(checkpointSession.getByTestId('checkpoint-locked-tools')).toBeVisible();
  await expect(checkpointSession.getByText('AI Mentor', { exact: true })).toHaveCount(0);
  await expect(checkpointSession.getByRole('button', { name: /Показать решение/i })).toHaveCount(0);

  await replaceEditorSql(page, FIRST_CHECKPOINT_SOLUTION);
  await checkpointSession.getByRole('button', { name: 'Проверить SQL' }).click();
  await expect(checkpointSession.locator('.assessment-feedback.success')).toContainText('Результат совпал');
  await expect(checkpointSession.getByTestId('checkpoint-result')).toBeVisible();

  const sessionKey = `sql-academy-checkpoint-session-v1:${String(auth.session.userId)}`;
  const reportsKey = `sql-academy-checkpoint-reports-v1:${String(auth.session.userId)}`;
  await expect.poll(() => page.evaluate(key => Boolean(localStorage.getItem(key)), sessionKey)).toBe(true);
  await page.reload();
  await expect(page.getByTestId('checkpoint-session')).toBeVisible();
  await expect(page.getByTestId('checkpoint-session').locator('.assessment-progress-strip button').first()).toHaveClass(/correct/);

  await page.context().setOffline(true);
  await page.getByTestId('checkpoint-session').getByRole('button', { name: 'Завершить досрочно' }).click();
  await expect(page.getByTestId('checkpoint-report')).toBeVisible();
  await expect(page.locator('.assessment-report-score strong')).not.toHaveText('0');
  await expect.poll(() => page.evaluate(key => !localStorage.getItem(key), sessionKey)).toBe(true);
  await expect.poll(() => page.evaluate(key => {
    const reports = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(reports) ? reports.length : 0;
  }, reportsKey)).toBeGreaterThan(0);

  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => page.evaluate(async () => {
    const response = await fetch('/api/checkpoints/reports');
    if (!response.ok) return 0;
    const payload = await response.json() as { reports?: unknown[] };
    return Array.isArray(payload.reports) ? payload.reports.length : 0;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('desktop-checkpoint-report.png'), fullPage: true });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username);
  await secondPage.goto(page.url().split('#')[0]);
  await waitForHydration(secondPage);

  await expect.poll(() => secondPage.evaluate(key => {
    const reports = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(reports) ? reports.length : 0;
  }, reportsKey), { timeout: 30_000 }).toBeGreaterThan(0);
  const evidenceModule = await secondPage.evaluate(key => {
    const reports = JSON.parse(localStorage.getItem(key) || '[]');
    return String(reports?.[0]?.moduleScores?.[0]?.module || 'sql-thinking');
  }, reportsKey);

  await secondPage.getByTestId('learning-path-trigger').click();
  const learningPath = secondPage.getByTestId('learning-path');
  await expect(learningPath).toBeVisible();
  await learningPath.locator('.roadmap-section').scrollIntoViewIfNeeded();
  const explainer = learningPath.getByTestId('readiness-explainer');
  await explainer.getByRole('button', { name: /Как считается readiness/i }).click();
  await explainer.locator('select').selectOption(evidenceModule);
  await expect(explainer.getByText(/completed checkpoint report/).first()).toBeVisible();
  await learningPath.getByRole('button', { name: 'Закрыть учебный путь' }).click();

  await secondPage.getByTestId('checkpoint-trigger').click();
  await expect(secondPage.getByTestId('checkpoint-landing')).toBeVisible();
  await expect(secondPage.locator('.assessment-history-list').getByText('Checkpoint · Надёжная база').first()).toBeVisible();
  await expectNoHorizontalOverflow(secondPage);
  await secondContext.close();
});

test('mobile checkpoint center keeps integrity controls usable on Pixel 7', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobilecheckpoint');
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: PROGRESS_KEY,
    value: checkpointReadyProgress()
  });
  await page.goto('./');
  await waitForHydration(page);

  await page.getByTestId('checkpoint-mobile-trigger').click();
  await expect(page.getByTestId('checkpoint-landing')).toBeVisible();
  await expect(page.locator('.assessment-mode-card')).toHaveCount(8);
  await page.getByTestId('start-checkpoint-foundation').click();
  const checkpointSession = page.getByTestId('checkpoint-session');
  await expect(checkpointSession).toBeVisible();
  await expect(checkpointSession.getByTestId('checkpoint-locked-tools')).toBeVisible();
  await expect(checkpointSession.locator('.assessment-progress-strip button')).toHaveCount(5);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-checkpoint-session.png'), fullPage: true });
});
