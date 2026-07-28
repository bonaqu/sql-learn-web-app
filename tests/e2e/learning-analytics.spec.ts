import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { authenticatePage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

function analyticsState(userId: string) {
  const sessionId = 'playwright-analytics-session';
  const started = Date.now() - 20 * 60_000;
  const event = (index: number, input: Record<string, unknown>) => ({
    version: 1,
    id: `playwright-event-${String(index).padStart(4, '0')}`,
    sessionId,
    occurredAt: new Date(started + index * 60_000).toISOString(),
    ...input
  });
  return {
    version: 1,
    userId,
    sharing: 'off',
    events: [
      event(0, { type: 'session_started' }),
      event(1, { type: 'task_opened', taskId: 'task-001', moduleId: 'sql-thinking' }),
      event(2, { type: 'attempted', taskId: 'task-001', moduleId: 'sql-thinking', correct: false, independent: false }),
      event(3, { type: 'diagnostic_observed', taskId: 'task-001', moduleId: 'sql-thinking', diagnosticKind: 'result-shape' }),
      event(4, { type: 'attempted', taskId: 'task-001', moduleId: 'sql-thinking', correct: false, independent: false }),
      event(5, { type: 'diagnostic_observed', taskId: 'task-001', moduleId: 'sql-thinking', diagnosticKind: 'result-shape' }),
      event(6, { type: 'task_opened', taskId: 'task-002', moduleId: 'sql-thinking' }),
      event(7, { type: 'attempted', taskId: 'task-002', moduleId: 'sql-thinking', correct: false, independent: false }),
      event(8, { type: 'diagnostic_observed', taskId: 'task-002', moduleId: 'sql-thinking', diagnosticKind: 'result-shape' }),
      event(9, { type: 'attempted', taskId: 'task-002', moduleId: 'sql-thinking', correct: false, independent: false }),
      event(10, { type: 'attempted', taskId: 'task-002', moduleId: 'sql-thinking', correct: false, independent: false }),
      event(11, { type: 'attempted', taskId: 'task-002', moduleId: 'sql-thinking', correct: true, independent: true }),
      event(12, { type: 'understood', taskId: 'task-002', moduleId: 'sql-thinking', correct: true }),
      event(13, { type: 'independent_pass', taskId: 'task-002', moduleId: 'sql-thinking', correct: true, independent: true }),
      event(14, { type: 'remediation_started', taskId: 'task-002', moduleId: 'sql-thinking', remediation: 'hint' }),
      event(15, { type: 'remediation_completed', taskId: 'task-002', moduleId: 'sql-thinking', remediation: 'retry', correct: true, independent: true })
    ],
    experimentVariants: { 'remediation-copy-v1': 'control' },
    updatedAt: new Date().toISOString()
  };
}

async function seedAnalytics(page: Page, userId: string) {
  await page.addInitScript(({ key, sessionKey, sessionId, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.setItem(sessionKey, sessionId);
  }, {
    key: `sql-academy-learning-analytics-v1:${userId}`,
    sessionKey: `sql-academy-learning-analytics-session-v1:${userId}`,
    sessionId: 'playwright-analytics-session',
    value: analyticsState(userId)
  });
}

async function openAnalytics(page: Page, mobile = false) {
  await page.goto('./');
  void mobile;
  await openAdvancedTool(page, 'learning-analytics-trigger');
  await expect(page.getByTestId('learning-analytics-portal')).toBeVisible();
}

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .include('[data-testid="learning-analytics-portal"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

test('desktop analytics stays local by default and sends only coarse actionable opt-in evidence', async ({ page }, testInfo) => {
  const auth = await authenticatePage(page, 'analytics');
  const userId = String(auth.session.userId);
  await seedAnalytics(page, userId);
  await openAnalytics(page);

  const portal = page.getByTestId('learning-analytics-portal');
  await expect(portal).toContainText('Не собирается:');
  await expect(portal).toContainText('Пора снизить нагрузку');
  await expect(portal).toContainText('Повторяется одна модель ошибки');
  await expect(portal.locator('.learning-analytics-funnel')).toContainText('2');
  await expect(portal.locator('.learning-analytics-grid')).toContainText('6');

  const overload = portal.locator('.learning-intervention').filter({ hasText: 'Пора снизить нагрузку' });
  await overload.getByRole('button', { name: /Скрыть сигнал/ }).click();
  await expect(overload).toHaveCount(0);

  await portal.getByRole('button', { name: 'Coarse opt-in' }).click();
  await expect(portal.getByRole('status')).toContainText('Opt-in включён');

  let snapshotBody = '';
  page.on('request', request => {
    if (request.url().endsWith('/api/learning-analytics/snapshot')) snapshotBody = request.postData() || '';
  });
  await portal.getByRole('button', { name: /Синхронизировать snapshot/i }).click();
  await expect(portal.getByRole('status')).toContainText('Coarse snapshot синхронизирован');

  const payload = JSON.parse(snapshotBody) as { snapshot: Record<string, unknown> };
  const serialized = snapshotBody.toUpperCase();
  expect(serialized).not.toContain('TASK-001');
  expect(serialized).not.toContain('TASK-002');
  expect(serialized).not.toContain(userId.toUpperCase());
  expect(serialized).not.toContain('SELECT ');
  expect(payload.snapshot).toHaveProperty('mastery.same-session', 1);
  expect(payload.snapshot).toHaveProperty('experiments.remediation-copy-v1', 'control');
  expect(Object.keys(payload.snapshot).sort()).toEqual(['courseVersion', 'experiments', 'mastery', 'periodStart', 'rows', 'version'].sort());

  const cohort = page.getByTestId('learning-cohort-report');
  await expect(cohort).toContainText(/Недостаточно contributors|suppressed/i);
  await expect(cohort).toContainText('Course actions');
  await expect(cohort).toContainText('Time-to-mastery');
  await expect(cohort).toContainText('Experiment guardrails');
  await expect(cohort).toContainText('не автоматический «победитель»');

  const downloadPromise = page.waitForEvent('download');
  await portal.getByRole('button', { name: 'Экспорт' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const exported = await readFile(path!, 'utf8');
  expect(exported).not.toContain('SELECT * FROM');
  expect(exported).not.toContain(auth.password);
  expect(exported).not.toContain(String(auth.session.token));

  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-learning-analytics.png'), fullPage: true });

  await portal.getByRole('button', { name: 'Удалить данные' }).click();
  await portal.getByRole('button', { name: 'Подтвердить удаление' }).click();
  await expect(portal.getByRole('status')).toContainText('удалена локально и на сервере');
  const stored = await page.evaluate(key => localStorage.getItem(key), `sql-academy-learning-analytics-v1:${userId}`);
  expect(stored).toBeNull();
});

test('mobile analytics has no horizontal overflow, traps focus and closes back to its launcher', async ({ page }, testInfo) => {
  const auth = await authenticatePage(page, 'analyticsmobile');
  await seedAnalytics(page, String(auth.session.userId));
  await openAnalytics(page, true);

  const portal = page.getByTestId('learning-analytics-portal');
  await expect(portal).toContainText('Моя аналитика обучения');
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);

  const close = portal.getByRole('button', { name: 'Закрыть аналитику' });
  await close.focus();
  await page.keyboard.press('Tab');
  await expect(portal).toContainText('Privacy-first evidence');
  await page.screenshot({ path: testInfo.outputPath('mobile-learning-analytics.png'), fullPage: true });

  await page.keyboard.press('Escape');
  await expect(portal).toBeHidden();
  await expect(page.getByTestId('learning-analytics-trigger')).toBeFocused();
});
