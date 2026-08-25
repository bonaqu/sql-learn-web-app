import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { authenticatePage } from './auth-helper';
import { tasks } from '../../src/data/course-catalog';
import { diagnosticForKind } from '../../src/lib/attempt-diagnostics';
import { mergeProgress } from '../../src/lib/auth';
import {
  defaultProgress,
  migrateProgress,
  recordAttempt,
  recordHint,
  type Progress
} from '../../src/lib/progress';

const WORKER_URL = process.env.PLAYWRIGHT_WORKER_URL || `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT || '8792'}`;
const PROGRESS_KEY = 'sql-academy-progress-v4';

const blankHistory = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }));

function sharedBaseline(): Progress {
  return migrateProgress({
    ...defaultProgress,
    completed: ['task-001'],
    taskStats: {
      'task-001': {
        attempts: 5,
        incorrect: 2,
        hintsUsed: 1,
        independentPasses: 1,
        errorKinds: { syntax: 2 },
        lastIndependentAt: '2026-07-25T09:00:00.000Z',
        lastAttemptAt: '2026-07-25T09:00:00.000Z',
        completedAt: '2026-07-25T09:00:00.000Z'
      }
    },
    xp: tasks.find(task => task.id === 'task-001')!.xp,
    streak: 1,
    history: blankHistory,
    lastTask: 'task-001',
    lastStudyDate: '2026-07-25'
  });
}

async function expectNoSeriousAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test('desktop mastery evidence sync resolves a real D1 stale-device conflict without loss', async ({ page }, testInfo) => {
  const auth = await authenticatePage(page, 'evidence');
  const token = String(auth.session.token || '');
  const task = tasks.find(item => item.id === 'task-001')!;
  const baseline = sharedBaseline();
  let deviceA = recordHint(structuredClone(baseline), task.id, 'replica-device-a');
  deviceA = recordAttempt(deviceA, task, false, {
    diagnostic: diagnosticForKind('syntax'),
    replicaId: 'replica-device-a',
    at: '2026-07-25T10:00:00.000Z'
  });
  let deviceB = recordHint(structuredClone(baseline), task.id, 'replica-device-b');
  deviceB = recordAttempt(deviceB, task, true, {
    independent: true,
    replicaId: 'replica-device-b',
    at: '2026-07-25T11:00:00.000Z'
  });
  const headers = { authorization: `Bearer ${token}` };
  const timeline: Array<{ device: string; method: string; baseRevision?: number; status: number; revision?: number }> = [];

  const firstWrite = await page.request.put(`${WORKER_URL}/api/mastery/progress`, {
    headers,
    data: { progress: baseline, baseRevision: 0 }
  });
  const firstBody = await firstWrite.json() as { revision?: number };
  timeline.push({ device: 'A', method: 'PUT', baseRevision: 0, status: firstWrite.status(), revision: firstBody.revision });
  expect(firstWrite.ok(), JSON.stringify(firstBody)).toBe(true);
  expect(firstBody.revision).toBe(1);

  const deviceAWrite = await page.request.put(`${WORKER_URL}/api/mastery/progress`, {
    headers,
    data: { progress: deviceA, baseRevision: 1 }
  });
  const deviceABody = await deviceAWrite.json() as { revision?: number };
  timeline.push({ device: 'A', method: 'PUT', baseRevision: 1, status: deviceAWrite.status(), revision: deviceABody.revision });
  expect(deviceAWrite.ok(), JSON.stringify(deviceABody)).toBe(true);
  expect(deviceABody.revision).toBe(2);

  const staleWrite = await page.request.put(`${WORKER_URL}/api/mastery/progress`, {
    headers,
    data: { progress: deviceB, baseRevision: 1 }
  });
  const staleBody = await staleWrite.json() as { revision?: number };
  timeline.push({ device: 'B', method: 'PUT', baseRevision: 1, status: staleWrite.status(), revision: staleBody.revision });
  expect(staleWrite.status()).toBe(409);
  expect(staleBody.revision).toBe(2);

  const reread = await page.request.get(`${WORKER_URL}/api/mastery/progress`, { headers });
  const rereadBody = await reread.json() as { revision: number; progress: Progress };
  timeline.push({ device: 'B', method: 'GET', status: reread.status(), revision: rereadBody.revision });
  expect(reread.ok(), JSON.stringify(rereadBody)).toBe(true);
  const merged = mergeProgress(deviceB, rereadBody.progress);
  const mergedWrite = await page.request.put(`${WORKER_URL}/api/mastery/progress`, {
    headers,
    data: { progress: merged, baseRevision: rereadBody.revision }
  });
  const mergedBody = await mergedWrite.json() as { revision: number; progress: Progress };
  timeline.push({ device: 'B', method: 'PUT', baseRevision: rereadBody.revision, status: mergedWrite.status(), revision: mergedBody.revision });
  expect(mergedWrite.ok(), JSON.stringify(mergedBody)).toBe(true);
  expect(mergedBody.revision).toBe(3);
  expect(mergedBody.progress.completed).toEqual(['task-001']);

  const canonicalResponse = await page.request.get(`${WORKER_URL}/api/mastery/progress`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(canonicalResponse.ok(), await canonicalResponse.text()).toBe(true);
  const canonical = await canonicalResponse.json() as { revision: number; progress: Progress };
  expect(canonical.revision).toBe(3);
  expect(canonical.progress.completed).toEqual(['task-001']);
  expect(canonical.progress.taskStats['task-001']).toMatchObject({
    attempts: 7,
    incorrect: 3,
    hintsUsed: 3,
    independentPasses: 2,
    errorKinds: { syntax: 3 }
  });
  expect(Object.keys(canonical.progress.taskStats['task-001'].counterComponents || {}).sort()).toEqual([
    'legacy',
    'replica-device-a',
    'replica-device-b'
  ]);

  const downgraded = structuredClone(canonical.progress);
  delete downgraded.taskStats['task-001'].counterComponents;
  const downgradeWrite = await page.request.put(`${WORKER_URL}/api/mastery/progress`, {
    headers,
    data: { progress: downgraded, baseRevision: canonical.revision }
  });
  expect(downgradeWrite.status()).toBe(409);
  expect(await downgradeWrite.json()).toMatchObject({ code: 'PROGRESS_COUNTERS_STALE', revision: 3 });

  const afterDowngradeResponse = await page.request.get(`${WORKER_URL}/api/mastery/progress`, { headers });
  const afterDowngrade = await afterDowngradeResponse.json() as { revision: number; progress: Progress };
  expect(afterDowngrade.revision).toBe(3);
  expect(afterDowngrade.progress.taskStats['task-001'].attempts).toBe(7);

  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: PROGRESS_KEY,
    value: deviceB
  });
  await page.goto('./');
  const cachedClient = await page.evaluate(async destructive => {
    const before = localStorage.getItem('sql-academy-progress-v4');
    const response = await fetch('/api/progress', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(destructive)
    });
    return { status: response.status, body: await response.json(), before, after: localStorage.getItem('sql-academy-progress-v4') };
  }, { ...deviceB, completed: [], taskStats: {}, xp: 0 });
  expect(cachedClient.status).toBe(428);
  expect(cachedClient.body).toMatchObject({ code: 'PROGRESS_REVISION_REQUIRED' });
  expect(cachedClient.after).toBe(cachedClient.before);

  await page.reload();
  const syncButton = page.getByRole('button', { name: 'Синхронизировать прогресс' });
  await syncButton.click();
  await expect(syncButton.locator('.lucide-wifi')).toBeVisible();
  const afterReload = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null') as Progress, PROGRESS_KEY);
  expect(afterReload.completed).toEqual(['task-001']);
  expect(afterReload.taskStats['task-001'].attempts).toBe(7);

  const beforeNetworkFailure = await page.evaluate(key => localStorage.getItem(key), PROGRESS_KEY);
  await page.route('**/api/mastery/progress', route => route.abort('failed'));
  await syncButton.click();
  await expect(syncButton.locator('.lucide-wifi-off')).toBeVisible();
  const afterNetworkFailure = await page.evaluate(key => localStorage.getItem(key), PROGRESS_KEY);
  expect(afterNetworkFailure).toBe(beforeNetworkFailure);
  await page.unroute('**/api/mastery/progress');

  await testInfo.attach('evidence-sync-timeline.json', {
    body: Buffer.from(JSON.stringify({ timeline, canonicalRevision: afterDowngrade.revision, completed: afterDowngrade.progress.completed, cachedClient }, null, 2)),
    contentType: 'application/json'
  });

  const deleted = await page.request.delete(`${WORKER_URL}/api/profile`, {
    headers: { authorization: `Bearer ${token}` },
    data: { currentPassword: auth.password, recoveryCode: auth.recoveryCodes[0], confirm: 'DELETE' }
  });
  expect(deleted.ok(), await deleted.text()).toBe(true);
});

async function verifyEmptyReview(page: Page, testInfo: import('@playwright/test').TestInfo, screenshotName: string) {
  const before = await page.evaluate(key => localStorage.getItem(key), PROGRESS_KEY);
  const empty = page.getByTestId('review-empty-state');
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('heading', { name: 'На сегодня повторений нет' })).toBeVisible();
  await expect(empty.getByRole('button')).toHaveCount(1);
  await expect(empty.getByRole('button', { name: 'Продолжить обучение' })).toBeVisible();
  await expect(page.locator('.editor-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Проверить SQL|Следующая подсказка|Показать решение|Следующий шаг|Диагностика/i })).toHaveCount(0);
  await page.keyboard.press('Control+Enter');
  const after = await page.evaluate(key => localStorage.getItem(key), PROGRESS_KEY);
  expect(after).toBe(before);
  await expectNoSeriousAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath(screenshotName), fullPage: true });
}

test('desktop mastery Review renders one safe empty action and blocks stale workspace mutation', async ({ page }, testInfo) => {
  await authenticatePage(page, 'emptyreview');
  await page.goto('./');
  await page.getByRole('button', { name: 'Повторение', exact: true }).click();
  await verifyEmptyReview(page, testInfo, 'desktop-empty-review.png');
});

test('mobile mastery Review empty state remains keyboard-safe and accessible', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobileempty');
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('navigation', { name: 'Разделы академии' }).getByRole('button', { name: 'Повторение', exact: true }).click();
  await verifyEmptyReview(page, testInfo, 'mobile-empty-review.png');
});
