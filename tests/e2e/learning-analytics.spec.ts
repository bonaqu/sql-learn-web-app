import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { authenticatePage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';
import { buildLearnerPersona, type LearnerPersonaId } from '../../src/lib/learner-personas';

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

async function seedPersona(page: Page, userId: string, id: LearnerPersonaId) {
  const fixture = buildLearnerPersona(id, userId);
  await page.addInitScript(value => {
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify(value.progress));
    localStorage.setItem(`sql-academy-onboarding-v1:${value.userId}`, JSON.stringify(value.onboarding));
    localStorage.setItem(`sql-academy-curriculum-progress-v1:${value.userId}`, JSON.stringify(value.curriculum));
    localStorage.setItem(`sql-academy-learning-analytics-v1:${value.userId}`, JSON.stringify(value.analytics));
    sessionStorage.setItem(`sql-academy-learning-analytics-session-v1:${value.userId}`, 'persona-session-0001');
  }, {
    userId,
    progress: fixture.progress,
    onboarding: fixture.onboarding,
    curriculum: fixture.curriculum,
    analytics: fixture.analytics
  });
  return fixture;
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
  expect(serialized).toContain('TASK-001');
  expect(serialized).toContain('LESSON-SQL-THINKING');
  expect(serialized).not.toContain(userId.toUpperCase());
  expect(serialized).not.toContain('SELECT ');
  expect(payload.snapshot).toHaveProperty('mastery.same-session', 1);
  expect(payload.snapshot).toHaveProperty('items.0.lessonId', 'lesson-sql-thinking');
  expect(payload.snapshot).toHaveProperty('experiments.remediation-copy-v1', 'control');
  expect(Object.keys(payload.snapshot).sort()).toEqual(['courseVersion', 'experiments', 'items', 'mastery', 'periodStart', 'rows', 'version'].sort());

  const cohort = page.getByTestId('learning-cohort-report');
  await expect(cohort).toContainText(/Недостаточно contributors|suppressed/i);
  await expect(cohort).toContainText('Course actions');
  await expect(cohort).toContainText('Time-to-mastery');
  await expect(cohort).toContainText('Experiment guardrails');
  await expect(cohort).toContainText('Lesson / task health');
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

test('desktop analytics item health shows sample uncertainty and competing explanations', async ({ page }, testInfo) => {
  const auth = await authenticatePage(page, 'analyticshealth');
  await seedAnalytics(page, String(auth.session.userId));
  await page.route('**/api/learning-analytics/report', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      version: 2,
      minimumCohort: 5,
      generatedAt: '2026-08-17T09:00:00.000Z',
      rows: [],
      items: [
        { periodStart: '2026-08-17', taskId: 'task-001', lessonId: 'lesson-sql-thinking', contributors: 5, attempted: 5, independent: 1, hinted: 4, solutionViewed: 2, misconceptions: 4, remediations: 5, remediationSuccesses: 1, retained: 0, placementChecks: 5, placementMatches: 2, suppressed: false },
        { periodStart: '2026-08-17', taskId: 'task-002', lessonId: 'lesson-sql-thinking', contributors: 20, attempted: 40, independent: 35, hinted: 2, solutionViewed: 0, misconceptions: 1, remediations: 2, remediationSuccesses: 2, retained: 10, placementChecks: 10, placementMatches: 9, suppressed: false }
      ],
      mastery: [],
      experiments: [],
      suppressedRows: 0,
      suppressedItems: 0,
      suppressedMasteryPeriods: 0,
      suppressedExperiments: 0
    })
  }));
  await openAnalytics(page);
  const portal = page.getByTestId('learning-analytics-portal');
  await portal.getByRole('button', { name: 'Coarse opt-in' }).click();
  await portal.getByRole('button', { name: 'Обновить course health' }).click();
  const health = page.getByTestId('learning-item-health');
  await expect(health).toContainText('lesson-success-task-failure');
  await expect(health).toContainText('Альтернатива:');
  await health.locator('details').first().locator('summary').click();
  await expect(health).toContainText('Мало данных: n=5');
  await expect(health).toContainText('90% interval');
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-course-item-health.png'), fullPage: true });
});

for (const personaId of ['zero', 'partial', 'role-focused', 'returning'] as const) {
  test(`desktop analytics and mobile analytics seeded ${personaId} persona follow a deterministic prerequisite-safe journey`, async ({ page }, testInfo) => {
    const auth = await authenticatePage(page, `persona${personaId.replace('-', '')}`);
    const fixture = await seedPersona(page, String(auth.session.userId), personaId);
    await page.goto('./');

    const today = page.getByTestId('guided-today');
    await expect(today).toBeVisible();
    await expect(today.locator('.guided-progress-card')).toContainText(`${fixture.progress.completed.length} из 240 задач`);
    const action = page.getByTestId('guided-journey-action');
    await expect(action).toBeVisible();
    await expect(action).not.toHaveAttribute('data-stage', 'loading', { timeout: 15_000 });
    if (personaId === 'returning') {
      await expect(action).toHaveAttribute('data-stage', 'review');
      await expect(action.getByRole('button', { name: 'Начать повторение' })).toBeEnabled();
    } else {
      await expect(action.getByRole('button')).toBeEnabled();
    }

    const evidence = await page.evaluate(userId => {
      const analytics = localStorage.getItem(`sql-academy-learning-analytics-v1:${userId}`) || '';
      const progress = JSON.parse(localStorage.getItem('sql-academy-progress-v4') || '{}') as { completed?: string[] };
      return { analytics, completed: progress.completed?.length || 0 };
    }, String(auth.session.userId));
    expect(evidence.completed).toBe(fixture.progress.completed.length);
    expect(evidence.analytics.toUpperCase()).not.toContain('SELECT ');
    expect(fixture.expected.prerequisiteSafe).toBe(true);

    await openAdvancedTool(page, 'learning-analytics-trigger');
    const portal = page.getByTestId('learning-analytics-portal');
    await expect(portal).toBeVisible();
    await expect(portal).toContainText('Локальный evidence');
    await expectAccessible(page);
    await page.screenshot({ path: testInfo.outputPath(`persona-${personaId}.png`), fullPage: true });
  });
}

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
