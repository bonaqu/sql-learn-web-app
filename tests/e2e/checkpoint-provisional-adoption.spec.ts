import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { curriculumCheckpoints } from '../../src/data/complete-curriculum';
import { tasks } from '../../src/data/course-catalog';
import { authenticatePage, loginPage } from './auth-helper';

const WORKER_URL = process.env.PLAYWRIGHT_WORKER_URL || `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT || '8792'}`;
const checkpoint = curriculumCheckpoints[0];
if (!checkpoint) throw new Error('Provisional adoption browser contract requires one checkpoint.');

type AdoptionReceipt = {
  version: 1;
  reportId: string;
  checkpointId: string;
  provisionalAttemptNumber: number;
  canonicalAttemptNumber: number;
  adoptedAt: string;
  evidenceDigest: string;
};
type Reservation = {
  reservationId: string;
  reportId: string;
  attemptNumber: number;
  checkpointId: string;
  status: string;
};

function scoredReport(
  userId: string,
  id: string,
  completedAt: string,
  attemptNumber: number,
  score: number,
  coordination: 'provisional' | 'cloud',
  reservationId?: string
) {
  const passed = score >= checkpoint.passingScore;
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
    bestScore: score,
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
    remediationModules: passed ? [] : [...checkpoint.moduleIds],
    coordination,
    ...(coordination === 'cloud' && reservationId ? { reservationId } : {})
  };
}

type ScoredReport = ReturnType<typeof scoredReport>;
type ProvisionalReport = Omit<ScoredReport, 'coordination' | 'reservationId'> & {
  coordination: 'provisional';
};
type AdoptedReport = Omit<ProvisionalReport, 'coordination'> & {
  coordination: 'adopted';
  provisionalAttemptNumber: number;
  canonicalAttemptNumber: number;
};

function provisionalReport(
  userId: string,
  id: string,
  completedAt: string,
  attemptNumber: number,
  score: number
): ProvisionalReport {
  const report = scoredReport(userId, id, completedAt, attemptNumber, score, 'provisional');
  const { reservationId: _reservationId, ...provisional } = report;
  return { ...provisional, coordination: 'provisional' };
}

async function postAdoption(page: Page, token: string, report: ProvisionalReport): Promise<APIResponse> {
  return page.request.post(`${WORKER_URL}/api/checkpoints/provisional-adoptions`, {
    headers: { authorization: `Bearer ${token}` },
    data: report
  });
}

async function postReservation(page: Page, token: string, clientRequestId: string): Promise<APIResponse> {
  return page.request.post(`${WORKER_URL}/api/checkpoints/reservations`, {
    headers: { authorization: `Bearer ${token}` },
    data: { checkpointId: checkpoint.id, clientRequestId }
  });
}

async function postCoordinatedReport(
  page: Page,
  token: string,
  userId: string,
  reservation: Reservation,
  completedAt: string
) {
  const report = scoredReport(
    userId,
    reservation.reportId,
    completedAt,
    reservation.attemptNumber,
    78,
    'cloud',
    reservation.reservationId
  );
  return page.request.post(`${WORKER_URL}/api/checkpoints/reports`, {
    headers: { authorization: `Bearer ${token}` },
    data: report
  });
}

async function json(response: APIResponse) {
  return response.json() as Promise<Record<string, unknown>>;
}

function adoptionPayload(value: Record<string, unknown>) {
  return value as unknown as {
    ok: true;
    replayed: boolean;
    report: AdoptedReport;
    receipt: AdoptionReceipt;
  };
}

async function cloudHistory(page: Page, token: string) {
  const response = await page.request.get(`${WORKER_URL}/api/checkpoints/reports`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as {
    reports: AdoptedReport[];
    adoptions: AdoptionReceipt[];
  };
}

test('desktop checkpoint provisional adoption allocates once, replays exactly, blocks behind an active attempt and converges on a second device', async ({ page, browser }) => {
  const auth = await authenticatePage(page, 'checkpoint-provisional-adoption');
  const userId = String(auth.session.userId);
  const token = String(auth.session.token);
  const first = provisionalReport(
    userId,
    randomUUID(),
    new Date(Date.now() - 120_000).toISOString(),
    1,
    82
  );

  const [leftResponse, rightResponse] = await Promise.all([
    postAdoption(page, token, first),
    postAdoption(page, token, first)
  ]);
  expect(leftResponse.ok(), await leftResponse.text()).toBe(true);
  expect(rightResponse.ok(), await rightResponse.text()).toBe(true);
  const left = adoptionPayload(await json(leftResponse));
  const right = adoptionPayload(await json(rightResponse));
  expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
  expect(left.receipt).toEqual(right.receipt);
  expect(left.receipt).toMatchObject({
    reportId: first.id,
    checkpointId: checkpoint.id,
    provisionalAttemptNumber: 1,
    canonicalAttemptNumber: 1
  });
  expect(left.receipt.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(left.report).toMatchObject({
    id: first.id,
    coordination: 'adopted',
    attemptNumber: 1,
    provisionalAttemptNumber: 1,
    canonicalAttemptNumber: 1,
    score: first.score,
    completedAt: first.completedAt
  });

  const exactReplayResponse = await postAdoption(page, token, first);
  expect(exactReplayResponse.ok(), await exactReplayResponse.text()).toBe(true);
  const exactReplay = adoptionPayload(await json(exactReplayResponse));
  expect(exactReplay.replayed).toBe(true);
  expect(exactReplay.receipt).toEqual(left.receipt);

  const reservationResponse = await postReservation(page, token, randomUUID());
  expect(reservationResponse.ok(), await reservationResponse.text()).toBe(true);
  const reservationPayload = await json(reservationResponse) as unknown as { reservation: Reservation };
  expect(reservationPayload.reservation.attemptNumber).toBe(2);

  const second = provisionalReport(
    userId,
    randomUUID(),
    new Date(Date.now() - 60_000).toISOString(),
    2,
    74
  );
  const blockedResponse = await postAdoption(page, token, second);
  expect(blockedResponse.status()).toBe(409);
  const blocked = await json(blockedResponse);
  expect(blocked).toMatchObject({
    code: 'CHECKPOINT_PROVISIONAL_ACTIVE_ATTEMPT',
    reportId: second.id,
    checkpointId: checkpoint.id,
    activeReservationId: reservationPayload.reservation.reservationId
  });
  expect(JSON.stringify(blocked)).not.toContain('taskScores');
  expect(JSON.stringify(blocked)).not.toContain('moduleScores');

  const beforeCompletion = await cloudHistory(page, token);
  expect(beforeCompletion.reports.filter(report => report.id === second.id)).toHaveLength(0);
  expect(beforeCompletion.adoptions.filter(receipt => receipt.reportId === second.id)).toHaveLength(0);

  const coordinatedResponse = await postCoordinatedReport(
    page,
    token,
    userId,
    reservationPayload.reservation,
    new Date().toISOString()
  );
  expect(coordinatedResponse.ok(), await coordinatedResponse.text()).toBe(true);

  const adoptedSecondResponse = await postAdoption(page, token, second);
  expect(adoptedSecondResponse.ok(), await adoptedSecondResponse.text()).toBe(true);
  const adoptedSecond = adoptionPayload(await json(adoptedSecondResponse));
  expect(adoptedSecond.replayed).toBe(false);
  expect(adoptedSecond.receipt).toMatchObject({
    reportId: second.id,
    provisionalAttemptNumber: 2,
    canonicalAttemptNumber: 3
  });
  expect(adoptedSecond.report).toMatchObject({
    coordination: 'adopted',
    attemptNumber: 3,
    provisionalAttemptNumber: 2,
    canonicalAttemptNumber: 3,
    completedAt: second.completedAt,
    score: second.score
  });

  const secondContext: BrowserContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const secondSession = await loginPage(secondPage, auth.username, auth.password);
  const secondToken = String(secondSession.token);
  const converged = await cloudHistory(secondPage, secondToken);
  const adoptedReports = converged.reports.filter(report => report.coordination === 'adopted');
  expect(adoptedReports.map(report => report.id).sort()).toEqual([first.id, second.id].sort());
  expect(new Set(adoptedReports.map(report => report.id)).size).toBe(2);
  expect(converged.adoptions.map(receipt => receipt.reportId).sort()).toEqual([first.id, second.id].sort());
  expect(adoptedReports.find(report => report.id === second.id)?.attemptNumber).toBe(3);
  expect(adoptedReports.find(report => report.id === second.id)?.completedAt).toBe(second.completedAt);
  await secondContext.close();
});
