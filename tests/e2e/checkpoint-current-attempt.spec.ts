import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { curriculumCheckpoints } from '../../src/data/complete-curriculum';
import { tasks } from '../../src/data/course-catalog';
import { authenticatePage, loginPage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

const WORKER_URL = 'http://127.0.0.1:8787';
const checkpoint = curriculumCheckpoints[0];
if (!checkpoint) throw new Error('Checkpoint current-attempt browser contract requires one checkpoint.');

function report(
  userId: string,
  id: string,
  completedAt: string,
  attemptNumber: number,
  score: number,
  passed: boolean,
  bestScore: number
) {
  return {
    version: 1,
    id,
    userId,
    checkpointId: checkpoint.id,
    status: 'completed',
    startedAt: new Date(Date.parse(completedAt) - 300_000).toISOString(),
    completedAt,
    durationSeconds: 300,
    attemptNumber,
    score,
    bestScore,
    passingScore: checkpoint.passingScore,
    passed,
    accuracy: score,
    firstAttemptRate: score,
    independence: score,
    taskScores: checkpoint.taskIds.map(taskId => {
      const task = tasks.find(item => item.id === taskId);
      return {
        taskId,
        title: task?.title || taskId,
        module: task?.module || checkpoint.moduleIds[0],
        correct: passed,
        skipped: false,
        attempts: 1,
        elapsedSeconds: 60,
        score: passed ? score : 0
      };
    }),
    moduleScores: checkpoint.moduleIds.map(module => ({
      module,
      title: module,
      score,
      correct: passed ? 1 : 0,
      total: 1
    })),
    remediationModules: passed ? [] : [...checkpoint.moduleIds]
  };
}

function fixture(userId: string) {
  const olderAt = new Date(Date.now() - 120_000).toISOString();
  const newerAt = new Date(Date.now() - 60_000).toISOString();
  return {
    olderPass: report(userId, 'a0000000-0000-0000-0000-000000000001', olderAt, 1, 91, true, 91),
    newerFail: report(userId, 'b0000000-0000-0000-0000-000000000002', newerAt, 2, 45, false, 91),
    laterPass: report(userId, 'c0000000-0000-0000-0000-000000000003', new Date().toISOString(), 3, 88, true, 91)
  };
}

async function seedReports(page: Page, userId: string, reports: unknown[]) {
  await page.goto('./');
  await page.evaluate(({ id, value }) => {
    localStorage.setItem(`sql-academy-checkpoint-reports-v1:${id}`, JSON.stringify(value));
  }, { id: userId, value: reports });
  await page.reload();
}

async function saveCloudReports(page: Page, token: string, reports: unknown[]) {
  for (const value of reports) {
    const response = await page.request.post(`${WORKER_URL}/api/checkpoints/reports`, {
      headers: { authorization: `Bearer ${token}` },
      data: value
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

async function openCenter(page: Page) {
  await openAdvancedTool(page, 'checkpoint-trigger');
  await expect(page.getByTestId('checkpoint-landing')).toBeVisible();
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
}

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .include('[data-testid="checkpoint-landing"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test('desktop checkpoint attempt shows current failure separately from historical best and restores on later pass', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'checkpoint-current-attempt');
  const userId = String(auth.session.userId);
  const token = String(auth.session.token);
  const value = fixture(userId);
  await seedReports(page, userId, [value.olderPass, value.newerFail]);
  await openCenter(page);

  await expect(page.getByTestId('checkpoint-current-pass-count')).toContainText('0');
  const card = page.getByTestId(`checkpoint-${checkpoint.id}`);
  await expect(card.getByTestId(`checkpoint-current-score-${checkpoint.id}`)).toContainText('текущая попытка #2: 45%');
  await expect(card.getByTestId(`checkpoint-historical-best-${checkpoint.id}`)).toContainText('исторический максимум 91%');
  await expect(card.locator('.assessment-mode-icon svg')).not.toHaveClass(/trophy/i);

  await page.locator('.assessment-history-list button').first().click();
  await expect(page.getByTestId('checkpoint-report-current-score')).toContainText('Текущая попытка #2');
  await expect(page.getByTestId('checkpoint-report-current-score')).toContainText('45');
  await expect(page.getByTestId('checkpoint-report-historical-best')).toContainText('91%');
  await page.screenshot({ path: testInfo.outputPath('desktop-checkpoint-current-vs-best.png'), fullPage: true });

  await saveCloudReports(page, token, [value.olderPass, value.newerFail]);
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username, auth.password);
  await secondPage.goto('./');
  await openCenter(secondPage);
  await expect(secondPage.getByTestId('checkpoint-current-pass-count')).toContainText('0');
  const secondCard = secondPage.getByTestId(`checkpoint-${checkpoint.id}`);
  await expect(secondCard.getByTestId(`checkpoint-current-score-${checkpoint.id}`)).toContainText('текущая попытка #2: 45%');
  await expect(secondCard.getByTestId(`checkpoint-historical-best-${checkpoint.id}`)).toContainText('исторический максимум 91%');
  await secondContext.close();

  await seedReports(page, userId, [value.newerFail, value.olderPass, value.laterPass]);
  await openCenter(page);
  await expect(page.getByTestId('checkpoint-current-pass-count')).toContainText('1');
  const restoredCard = page.getByTestId(`checkpoint-${checkpoint.id}`);
  await expect(restoredCard.getByTestId(`checkpoint-current-score-${checkpoint.id}`)).toContainText('текущая попытка #3: 88%');
  await expect(restoredCard.getByTestId(`checkpoint-historical-best-${checkpoint.id}`)).toContainText('исторический максимум 91%');
});

test('mobile checkpoint attempt current and historical values remain accessible without overflow', async ({ page }, testInfo) => {
  const auth = await authenticatePage(page, 'mobile-checkpoint-current-attempt');
  const value = fixture(String(auth.session.userId));
  await seedReports(page, String(auth.session.userId), [value.olderPass, value.newerFail]);
  await openCenter(page);

  const card = page.getByTestId(`checkpoint-${checkpoint.id}`);
  await expect(card.getByTestId(`checkpoint-current-score-${checkpoint.id}`)).toContainText('45%');
  await expect(card.getByTestId(`checkpoint-historical-best-${checkpoint.id}`)).toContainText('91%');
  await expectAccessible(page);
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-checkpoint-current-vs-best.png'), fullPage: true });
});
