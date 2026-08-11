import { randomUUID } from 'node:crypto';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { checkpointTaskById } from '../../src/data/checkpoint-task-bank';
import { curriculumCheckpoints } from '../../src/data/complete-curriculum';
import { tasks } from '../../src/data/course-catalog';
import { authenticatePage, loginPage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

const WORKER_URL = process.env.PLAYWRIGHT_WORKER_URL || `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT || '8792'}`;
const checkpoint = curriculumCheckpoints[0];
if (!checkpoint) throw new Error('Checkpoint report integrity browser contract requires one checkpoint.');

type IntegrityReport = ReturnType<typeof report>;
type Receipt = {
  version: 1;
  reportId: string;
  checkpointId: string;
  persistedAt: string;
  payloadDigest: string;
};

function report(
  userId: string,
  id: string,
  completedAt: string,
  attemptNumber: number,
  score: number,
  passed: boolean,
  bestScore = score
) {
  return {
    version: 1 as const,
    id,
    userId,
    checkpointId: checkpoint.id,
    status: 'completed' as const,
    startedAt: new Date(Date.parse(completedAt) - 300_000).toISOString(),
    completedAt,
    durationSeconds: 300,
    attemptNumber,
    score,
    bestScore: Math.max(bestScore, score),
    passingScore: checkpoint.passingScore,
    passed,
    accuracy: score,
    firstAttemptRate: score,
    independence: score,
    taskScores: checkpoint.taskIds.map(taskId => {
      const task = checkpointTaskById(taskId) || tasks.find(item => item.id === taskId);
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

function changedPayload(original: IntegrityReport) {
  const completedAt = new Date(Date.parse(original.completedAt) + 30_000).toISOString();
  return report(
    original.userId,
    original.id,
    completedAt,
    original.attemptNumber,
    45,
    false,
    original.bestScore
  );
}

async function postReport(page: Page, token: string, value: IntegrityReport): Promise<APIResponse> {
  return page.request.post(`${WORKER_URL}/api/checkpoints/reports`, {
    headers: { authorization: `Bearer ${token}` },
    data: value
  });
}

async function payload(response: APIResponse) {
  return response.json() as Promise<Record<string, unknown>>;
}

function receiptFrom(value: Record<string, unknown>) {
  return value.receipt as Receipt;
}

async function openCenter(page: Page) {
  await openAdvancedTool(page, 'checkpoint-trigger');
  await expect(page.getByTestId('checkpoint-landing')).toBeVisible();
}

async function seedConflictingLocalReport(page: Page, userId: string, value: IntegrityReport) {
  await page.addInitScript(({ id, reportValue }) => {
    localStorage.setItem(`sql-academy-checkpoint-reports-v1:${id}`, JSON.stringify([reportValue]));
  }, { id: userId, reportValue: value });
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

test('desktop checkpoint immutable report race returns one receipt, rejects mutation and quarantines second-device conflict', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'checkpoint-immutable-report');
  const userId = String(auth.session.userId);
  const token = String(auth.session.token);
  const original = report(
    userId,
    randomUUID(),
    new Date(Date.now() - 60_000).toISOString(),
    1,
    82,
    true
  );

  const [leftResponse, rightResponse] = await Promise.all([
    postReport(page, token, original),
    postReport(page, token, original)
  ]);
  expect(leftResponse.ok(), await leftResponse.text()).toBe(true);
  expect(rightResponse.ok(), await rightResponse.text()).toBe(true);
  const left = await payload(leftResponse);
  const right = await payload(rightResponse);
  expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
  expect(receiptFrom(left)).toEqual(receiptFrom(right));
  expect(receiptFrom(left).reportId).toBe(original.id);
  expect(receiptFrom(left).payloadDigest).toMatch(/^[a-f0-9]{64}$/);

  const exactReplayResponse = await postReport(page, token, original);
  expect(exactReplayResponse.ok(), await exactReplayResponse.text()).toBe(true);
  const exactReplay = await payload(exactReplayResponse);
  expect(exactReplay.replayed).toBe(true);
  expect(receiptFrom(exactReplay)).toEqual(receiptFrom(left));

  const changed = changedPayload(original);
  const conflictResponse = await postReport(page, token, changed);
  expect(conflictResponse.status()).toBe(409);
  const conflict = await payload(conflictResponse);
  expect(conflict).toMatchObject({
    code: 'CHECKPOINT_REPORT_CONFLICT',
    reportId: original.id
  });
  expect(JSON.stringify(conflict)).not.toContain('taskScores');
  expect(JSON.stringify(conflict)).not.toContain('moduleScores');
  expect(JSON.stringify(conflict)).not.toContain(original.completedAt);

  const historyResponse = await page.request.get(`${WORKER_URL}/api/checkpoints/reports`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(historyResponse.ok(), await historyResponse.text()).toBe(true);
  const history = await payload(historyResponse) as {
    reports: IntegrityReport[];
    receipts: Receipt[];
  };
  const persisted = history.reports.find(item => item.id === original.id);
  const persistedReceipt = history.receipts.find(item => item.reportId === original.id);
  expect(persisted).toEqual(original);
  expect(persistedReceipt).toEqual(receiptFrom(left));

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username, auth.password);
  await seedConflictingLocalReport(secondPage, userId, changed);
  await secondPage.goto('./');
  await openCenter(secondPage);

  await expect(secondPage.getByTestId('checkpoint-report-conflict-banner')).toBeVisible();
  await expect(secondPage.getByTestId('checkpoint-report-conflict-banner')).toContainText('Cloud attempt #1 (82%) оставлен активным');
  await expect(secondPage.getByTestId('checkpoint-report-conflict-banner')).toContainText('local attempt #1 (45%)');
  await expect(secondPage.getByTestId('checkpoint-current-pass-count')).toContainText('1');
  const card = secondPage.getByTestId(`checkpoint-${checkpoint.id}`);
  await expect(card.getByTestId(`checkpoint-current-score-${checkpoint.id}`)).toContainText('текущая попытка #1: 82%');
  await expect(secondPage.getByTestId('checkpoint-receipt-count')).toContainText('Cloud receipts: 1');

  await secondPage.locator('.assessment-history-list button').first().click();
  await expect(secondPage.getByTestId('checkpoint-report-current-score')).toContainText('82');
  await expect(secondPage.getByTestId('checkpoint-report-receipt')).not.toContainText('Только локально');
  await expect(secondPage.getByTestId('checkpoint-report-receipt')).toContainText(receiptFrom(left).payloadDigest.slice(0, 12));
  await secondPage.screenshot({ path: testInfo.outputPath('desktop-checkpoint-immutable-conflict.png'), fullPage: true });
  await secondContext.close();
});

test('mobile checkpoint immutable conflict and cloud receipt remain accessible without overflow', async ({ page }, testInfo) => {
  const auth = await authenticatePage(page, 'mobile-checkpoint-immutable-report');
  const userId = String(auth.session.userId);
  const token = String(auth.session.token);
  const original = report(
    userId,
    randomUUID(),
    new Date(Date.now() - 60_000).toISOString(),
    1,
    84,
    true
  );
  const accepted = await postReport(page, token, original);
  expect(accepted.ok(), await accepted.text()).toBe(true);
  const acceptedPayload = await payload(accepted);
  const changed = changedPayload(original);

  await seedConflictingLocalReport(page, userId, changed);
  await page.goto('./');
  await openCenter(page);

  await expect(page.getByTestId('checkpoint-report-conflict-banner')).toContainText('Cloud attempt #1 (84%) оставлен активным');
  await expect(page.getByTestId('checkpoint-receipt-count')).toContainText('Cloud receipts: 1');
  const card = page.getByTestId(`checkpoint-${checkpoint.id}`);
  await expect(card.getByTestId(`checkpoint-current-score-${checkpoint.id}`)).toContainText('84%');
  await expectAccessible(page);
  await expectNoOverflow(page);

  await page.locator('.assessment-history-list button').first().click();
  await expect(page.getByTestId('checkpoint-report-receipt')).toContainText(receiptFrom(acceptedPayload).payloadDigest.slice(0, 12));
  await page.screenshot({ path: testInfo.outputPath('mobile-checkpoint-immutable-conflict.png'), fullPage: true });
});
