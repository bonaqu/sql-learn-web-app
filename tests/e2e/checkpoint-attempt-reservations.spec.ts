import { randomUUID } from 'node:crypto';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { curriculumCheckpoints } from '../../src/data/complete-curriculum';
import { tasks } from '../../src/data/course-catalog';
import { authenticatePage, loginPage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

const WORKER_URL = process.env.PLAYWRIGHT_WORKER_URL || `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT || '8792'}`;
const checkpoint = curriculumCheckpoints[0];
if (!checkpoint) throw new Error('Checkpoint reservation browser contract requires one checkpoint.');

const reservationRequestKey = (userId: string) =>
  `sql-academy-checkpoint-reservation-request-v1:${userId}:${checkpoint.id}`;

function readyProgress() {
  const completedAt = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const completed = tasks
    .filter(task => checkpoint.moduleIds.includes(task.module as never))
    .map(task => task.id);
  return {
    version: 4,
    completed,
    taskStats: Object.fromEntries(completed.map(taskId => [taskId, {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      solutionViews: 0,
      independentPasses: 1,
      lastIndependentAt: completedAt,
      lastAttemptAt: completedAt,
      completedAt
    }])),
    xp: 5_000,
    streak: 1,
    history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 })),
    lastTask: completed.at(-1),
    lastStudyDate: completedAt.slice(0, 10)
  };
}

async function seedReadiness(page: Page, pendingRequestId?: string, userId?: string) {
  await page.addInitScript(({ progress, requestKey, requestId }) => {
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify(progress));
    if (requestKey && requestId) localStorage.setItem(requestKey, requestId);
  }, {
    progress: readyProgress(),
    requestKey: pendingRequestId && userId ? reservationRequestKey(userId) : '',
    requestId: pendingRequestId || ''
  });
}

async function postReservation(page: Page, token: string, clientRequestId: string): Promise<APIResponse> {
  return page.request.post(`${WORKER_URL}/api/checkpoints/reservations`, {
    headers: { authorization: `Bearer ${token}` },
    data: { checkpointId: checkpoint.id, clientRequestId }
  });
}

async function responsePayload(response: APIResponse) {
  return response.json() as Promise<{
    code?: string;
    created?: boolean;
    replayed?: boolean;
    activeElsewhere?: boolean;
    reservation: {
      reservationId: string;
      reportId: string;
      attemptNumber: number;
      ownedByCurrentSession: boolean;
      clientRequestId: string;
      checkpointId: string;
      status: string;
    };
  }>;
}

async function openCenter(page: Page) {
  await openAdvancedTool(page, 'checkpoint-trigger');
  await expect(page.getByTestId('checkpoint-landing')).toBeVisible();
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
}

async function expectAccessible(page: Page, selector: string) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test('desktop checkpoint reservation race yields one active attempt, blocks second device and advances after coordinated completion', async ({ page, browser }, testInfo) => {
  const firstAuth = await authenticatePage(page, 'checkpoint-reservation-first');
  const userId = String(firstAuth.session.userId);
  const firstToken = String(firstAuth.session.token);

  const secondContext: BrowserContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const secondSession = await loginPage(secondPage, firstAuth.username, firstAuth.password);
  const secondToken = String(secondSession.token);

  const firstRequestId = randomUUID();
  const secondRequestId = randomUUID();
  const [firstResponse, secondResponse] = await Promise.all([
    postReservation(page, firstToken, firstRequestId),
    postReservation(secondPage, secondToken, secondRequestId)
  ]);
  expect([firstResponse.status(), secondResponse.status()].sort()).toEqual([200, 409]);
  const firstPayload = await responsePayload(firstResponse);
  const secondPayload = await responsePayload(secondResponse);
  const winner = firstResponse.ok()
    ? { page, token: firstToken, requestId: firstRequestId, payload: firstPayload }
    : { page: secondPage, token: secondToken, requestId: secondRequestId, payload: secondPayload };
  const loser = firstResponse.ok()
    ? { page: secondPage, token: secondToken, requestId: secondRequestId, payload: secondPayload }
    : { page, token: firstToken, requestId: firstRequestId, payload: firstPayload };

  expect(winner.payload.created).toBe(true);
  expect(winner.payload.replayed).toBe(false);
  expect(winner.payload.reservation.attemptNumber).toBe(1);
  expect(winner.payload.reservation.ownedByCurrentSession).toBe(true);
  expect(loser.payload.code).toBe('CHECKPOINT_ATTEMPT_ACTIVE');
  expect(loser.payload.activeElsewhere).toBe(true);
  expect(loser.payload.reservation.reservationId).toBe(winner.payload.reservation.reservationId);
  expect(loser.payload.reservation.attemptNumber).toBe(1);

  await seedReadiness(winner.page, winner.requestId, userId);
  await seedReadiness(loser.page, loser.requestId, userId);
  await winner.page.goto('./');
  await loser.page.goto('./');

  await openCenter(winner.page);
  await winner.page.getByTestId(`start-${checkpoint.id}`).click();
  await expect(winner.page.getByTestId('checkpoint-session')).toBeVisible();
  await expect(winner.page.getByTestId('checkpoint-session-coordination')).toContainText('Cloud-coordinated');

  await openCenter(loser.page);
  await loser.page.getByTestId(`start-${checkpoint.id}`).click();
  await expect(loser.page.getByTestId('checkpoint-active-reservation-banner')).toBeVisible();
  await expect(loser.page.getByTestId('checkpoint-active-reservation-banner')).toContainText('Попытка #1');
  await expect(loser.page.getByTestId('checkpoint-active-reservation-banner')).toContainText('уже активна');
  await expect(loser.page.getByTestId('checkpoint-session')).toHaveCount(0);

  await winner.page.getByRole('button', { name: 'Завершить досрочно' }).click();
  await expect(winner.page.getByTestId('checkpoint-report')).toBeVisible();
  await expect(winner.page.getByTestId('checkpoint-report-coordination')).toContainText('Cloud reservation');
  await expect(winner.page.getByTestId('checkpoint-report-receipt')).not.toContainText('Только локально');

  await loser.page.getByTestId(`start-${checkpoint.id}`).click();
  await expect(loser.page.getByTestId('checkpoint-session')).toBeVisible();
  await expect(loser.page.getByTestId('checkpoint-session-coordination')).toContainText('Cloud-coordinated');
  const activeResponse = await loser.page.request.get(
    `${WORKER_URL}/api/checkpoints/reservations?checkpointId=${checkpoint.id}`,
    { headers: { authorization: `Bearer ${loser.token}` } }
  );
  expect(activeResponse.ok(), await activeResponse.text()).toBe(true);
  const active = await responsePayload(activeResponse);
  expect(active.reservation.attemptNumber).toBe(2);
  expect(active.reservation.ownedByCurrentSession).toBe(true);

  await loser.page.screenshot({ path: testInfo.outputPath('desktop-checkpoint-reservation-second-device.png'), fullPage: true });
  await secondContext.close();
});

test('mobile checkpoint reservation outage starts an explicit provisional session without overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobile-checkpoint-reservation-provisional');
  await seedReadiness(page);
  await page.route('**/api/checkpoints/reservations', route => route.abort('connectionfailed'));
  await page.goto('./');
  await openCenter(page);

  await page.getByTestId(`start-${checkpoint.id}`).click();
  await expect(page.getByTestId('checkpoint-session')).toBeVisible();
  await expect(page.getByTestId('checkpoint-session-coordination')).toContainText('Provisional offline');
  await expect(page.getByTestId('checkpoint-sync-message')).toContainText('provisional');
  await expectAccessible(page, '[data-testid="checkpoint-session"]');
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-checkpoint-provisional-session.png'), fullPage: true });
});
