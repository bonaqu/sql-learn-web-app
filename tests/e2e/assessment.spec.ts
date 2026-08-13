import { expect, test } from '@playwright/test';
import { tasks } from '../../src/data/course-catalog';
import { authenticatePage, loginPage } from './auth-helper';
import { guidedHome, openAdvancedTool } from './navigation-helper';

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
  await expect(guidedHome(page)).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.locator('.auth-loading-screen')).toHaveCount(0);
  await expect(guidedHome(page)).toBeVisible();
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

test('desktop assessment waits for evidence hydration, uses an adaptive form and syncs explainable measurement', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'assess');
  let releaseCalibration!: () => void;
  const calibrationGate = new Promise<void>(resolve => { releaseCalibration = resolve; });
  await page.route('**/api/assessment/calibration', async route => {
    await calibrationGate;
    await route.continue();
  });

  await page.goto('./');
  await openAdvancedTool(page, 'assessment-trigger');
  await expect(page.getByTestId('assessment-landing')).toBeVisible();
  const calibrationSummary = page.getByTestId('assessment-calibration-summary');
  await expect(calibrationSummary).toBeVisible();
  await expect(calibrationSummary).toContainText(/Blueprint v3|authored difficulty/i);
  const quickStart = page.getByTestId('start-quick');
  await expect(quickStart).toBeDisabled();
  await expect(calibrationSummary).toContainText(/Синхронизирую reports/i);
  releaseCalibration();
  await expect(quickStart).toBeEnabled();
  await expect(calibrationSummary).toContainText(/Cross-device evidence готов|локальную историю/i);
  await quickStart.click();

  const center = page.getByTestId('assessment-center');
  await expect(page.getByTestId('assessment-session')).toBeVisible();
  await expect(page.getByTestId('assessment-timer')).toContainText(/\d{2}:\d{2}/);
  await expect(page.getByTestId('assessment-locked-tools')).toBeVisible();
  await expect(center.getByRole('button', { name: /Следующая подсказка/i })).toHaveCount(0);
  await expect(center.getByRole('button', { name: /Показать решение/i })).toHaveCount(0);
  await expect(center.getByText('AI Mentor', { exact: true })).toHaveCount(0);

  const sessionKey = `sql-academy-assessment-session-v1:${String(auth.session.userId)}`;
  const session = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), sessionKey) as {
    formId: string;
    blueprintVersion: string;
    thresholdVersion: string;
    taskIds: string[];
    selection: { distinctModules: number; distinctSkills: number };
  };
  expect(session.formId).toMatch(/^QUICK-assessment-blueprint-v3-F[1-4]$/);
  expect(session.blueprintVersion).toBe('assessment-blueprint-v3');
  expect(session.thresholdVersion).toBe('assessment-thresholds-v2');
  expect(session.taskIds).toHaveLength(3);
  expect(new Set(session.taskIds).size).toBe(3);
  expect(session.selection.distinctModules).toBeGreaterThanOrEqual(3);
  expect(session.selection.distinctSkills).toBeGreaterThanOrEqual(3);
  const firstTask = tasks.find(task => task.id === session.taskIds[0]);
  expect(firstTask, `Missing adaptive task ${session.taskIds[0]}`).toBeTruthy();

  await replaceEditorSql(page, firstTask!.solution);
  await page.getByRole('button', { name: 'Проверить SQL' }).click();
  await expect(page.locator('.assessment-feedback.success')).toContainText('скрытые проверки пройдены');
  await expect(page.getByTestId('assessment-result')).toBeVisible();

  await expect.poll(() => page.evaluate(key => Boolean(localStorage.getItem(key)), sessionKey)).toBe(true);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('assessment-session')).toBeVisible();
  await expect(page.locator('.assessment-progress-strip button').first()).toHaveClass(/correct/);

  await page.getByRole('button', { name: 'Завершить досрочно' }).click();
  await expect(page.getByTestId('assessment-report')).toBeVisible();
  await expect(page.locator('.assessment-report-score strong')).not.toHaveText('0');
  await expect(page.getByTestId('assessment-measurement-panel')).toBeVisible();
  await expect(page.getByTestId('assessment-measurement-panel')).toContainText(session.formId);
  await expect(page.getByTestId('assessment-measurement-panel')).toContainText(/90% interval точности/i);
  await expect(page.getByTestId('assessment-measurement-panel')).toContainText(/Диапазон отражает неопределённость/i);
  await expect(page.getByText('Skill report синхронизирован с аккаунтом.')).toBeVisible();
  await page.getByRole('button', { name: /Получить AI Debrief/ }).click();
  await expect(page.locator('.assessment-debrief-card pre')).not.toContainText('Анализирую');
  await expect(page.locator('.assessment-debrief-card pre')).toContainText(/измерительный диапазон/i);
  await page.screenshot({ path: testInfo.outputPath('desktop-assessment-calibrated-report.png'), fullPage: true });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username);
  await secondPage.goto(page.url().split('#')[0]);
  await openAdvancedTool(secondPage, 'assessment-trigger');
  await expect(secondPage.getByTestId('assessment-landing')).toBeVisible();
  await expect(secondPage.getByTestId('assessment-calibration-summary')).toBeVisible();
  await expect(secondPage.locator('.assessment-history-list').getByText('Quick Check').first()).toBeVisible();
  await secondPage.locator('.assessment-history-list').getByText('Quick Check').first().click();
  await expect(secondPage.getByTestId('assessment-measurement-panel')).toContainText(session.formId);
  await expectNoHorizontalOverflow(secondPage);
  await secondContext.close();
});

test('desktop diagnostic exam adaptively stops a zero-level learner after three executable probes', async ({ page }) => {
  const auth = await authenticatePage(page, 'diagnostic');
  await page.goto('./');
  await openAdvancedTool(page, 'assessment-trigger');
  await expect(page.getByTestId('assessment-mode-diagnostic')).toBeVisible();
  await page.getByTestId('start-diagnostic').click();

  await expect(page.getByTestId('assessment-session')).toBeVisible();
  await expect(page.locator('.assessment-mode-pill')).toHaveText('Diagnostic');
  await expect(page.locator('.assessment-progress-strip button')).toHaveCount(3);
  await expect(page.getByTestId('assessment-timer')).toContainText(/^1[67]:|^18:/);
  await expect(page.getByTestId('adaptive-diagnostic-status')).toContainText(/три короткие базовые пробы/i);
  await expect(page.getByTestId('assessment-interviewer')).toHaveCount(0);
  await expect(page.getByTestId('assessment-locked-tools')).toBeVisible();

  const sessionKey = `sql-academy-assessment-session-v1:${String(auth.session.userId)}`;
  await expect.poll(() => page.evaluate(key => {
    const session = JSON.parse(localStorage.getItem(key) || 'null');
    return session?.mode === 'diagnostic'
      && session?.taskIds?.length === 7
      && session?.formId?.startsWith('DIAGNOSTIC-assessment-blueprint-v3-');
  }, sessionKey)).toBe(true);
  await page.reload();
  await expect(page.getByTestId('assessment-session')).toBeVisible();
  await expect(page.locator('.assessment-mode-pill')).toHaveText('Diagnostic');
  await expect(page.locator('.assessment-progress-strip button')).toHaveCount(3);

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: 'Пропустить' }).click();
  }
  await expect(page.getByTestId('assessment-report')).toBeVisible();
  await expect(page.getByTestId('adaptive-diagnostic-result')).toContainText(/3 задач/i);
  await expect(page.getByTestId('adaptive-diagnostic-result')).toContainText(/безопасного старта с основ/i);
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), sessionKey)).toBeNull();
});

test('desktop assessment enforces exam integrity and restores an expired session as a report', async ({ page }) => {
  const auth = await authenticatePage(page, 'expiry');
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: PROGRESS_KEY,
    value: practicedProgress()
  });
  await page.goto('./');
  await waitForInitialCloudHydration(page);
  await openAdvancedTool(page, 'assessment-trigger');
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
  await expect(page.getByTestId('assessment-measurement-panel')).toContainText(/limited|emerging/i);
});

test('desktop assessment interview allows bounded clarification without exposing a solution', async ({ page }) => {
  await authenticatePage(page, 'interview');
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: PROGRESS_KEY,
    value: practicedProgress()
  });
  await page.goto('./');
  await waitForInitialCloudHydration(page);
  await openAdvancedTool(page, 'assessment-trigger');
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

test('mobile assessment landing, adaptive session and measurement panel fit Pixel 7', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobileassess');
  await page.goto('./');
  await openAdvancedTool(page, 'assessment-trigger');
  await expect(page.getByTestId('assessment-landing')).toBeVisible();
  await expect(page.locator('.assessment-mode-card')).toHaveCount(6);
  await expect(page.getByTestId('assessment-calibration-summary')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('start-quick').click();
  await expect(page.getByTestId('assessment-session')).toBeVisible();
  await expect(page.getByTestId('assessment-locked-tools')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-assessment-adaptive-session.png'), fullPage: true });
});
