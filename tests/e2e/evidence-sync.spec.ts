import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { authenticatePage } from './auth-helper';

const WORKER_URL = process.env.PLAYWRIGHT_WORKER_URL || 'http://127.0.0.1:8787';
const PROGRESS_KEY = 'sql-academy-progress-v4';

type Progress = {
  version: 4;
  completed: string[];
  taskStats: Record<string, {
    attempts: number;
    incorrect: number;
    hintsUsed: number;
    independentPasses?: number;
    lastIndependentAt?: string;
    lastAttemptAt?: string;
    completedAt?: string;
  }>;
  xp: number;
  streak: number;
  history: Array<{ day: string; solved: number }>;
  lastTask?: string;
  lastStudyDate?: string;
};

const blankHistory = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }));

function progressFor(taskId: string, at: string): Progress {
  return {
    version: 4,
    completed: [taskId],
    taskStats: {
      [taskId]: {
        attempts: 1,
        incorrect: 0,
        hintsUsed: 0,
        independentPasses: 1,
        lastIndependentAt: at,
        lastAttemptAt: at,
        completedAt: at
      }
    },
    xp: 60,
    streak: 1,
    history: blankHistory,
    lastTask: taskId,
    lastStudyDate: at.slice(0, 10)
  };
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
  const deviceA = progressFor('task-001', '2026-07-25T10:00:00.000Z');
  const deviceB = progressFor('task-002', '2026-07-25T11:00:00.000Z');
  const headers = { authorization: `Bearer ${token}` };
  const timeline: Array<{ device: string; method: string; baseRevision?: number; status: number; revision?: number }> = [];

  const firstWrite = await page.request.put(`${WORKER_URL}/api/mastery/progress`, {
    headers,
    data: { progress: deviceA, baseRevision: 0 }
  });
  const firstBody = await firstWrite.json() as { revision?: number };
  timeline.push({ device: 'A', method: 'PUT', baseRevision: 0, status: firstWrite.status(), revision: firstBody.revision });
  expect(firstWrite.ok(), JSON.stringify(firstBody)).toBe(true);
  expect(firstBody.revision).toBe(1);

  const staleWrite = await page.request.put(`${WORKER_URL}/api/mastery/progress`, {
    headers,
    data: { progress: deviceB, baseRevision: 0 }
  });
  const staleBody = await staleWrite.json() as { revision?: number };
  timeline.push({ device: 'B', method: 'PUT', baseRevision: 0, status: staleWrite.status(), revision: staleBody.revision });
  expect(staleWrite.status()).toBe(409);
  expect(staleBody.revision).toBe(1);

  const reread = await page.request.get(`${WORKER_URL}/api/mastery/progress`, { headers });
  const rereadBody = await reread.json() as { revision: number; progress: Progress };
  timeline.push({ device: 'B', method: 'GET', status: reread.status(), revision: rereadBody.revision });
  expect(reread.ok(), JSON.stringify(rereadBody)).toBe(true);
  const merged: Progress = {
    ...rereadBody.progress,
    completed: [...new Set([...rereadBody.progress.completed, ...deviceB.completed])].sort(),
    taskStats: { ...rereadBody.progress.taskStats, ...deviceB.taskStats },
    xp: rereadBody.progress.xp + deviceB.xp,
    streak: Math.max(rereadBody.progress.streak, deviceB.streak),
    lastTask: deviceB.lastTask,
    lastStudyDate: deviceB.lastStudyDate
  };
  const mergedWrite = await page.request.put(`${WORKER_URL}/api/mastery/progress`, {
    headers,
    data: { progress: merged, baseRevision: rereadBody.revision }
  });
  const mergedBody = await mergedWrite.json() as { revision: number; progress: Progress };
  timeline.push({ device: 'B', method: 'PUT', baseRevision: rereadBody.revision, status: mergedWrite.status(), revision: mergedBody.revision });
  expect(mergedWrite.ok(), JSON.stringify(mergedBody)).toBe(true);
  expect(mergedBody.revision).toBe(2);
  expect(mergedBody.progress.completed).toEqual(['task-001', 'task-002']);

  const canonicalResponse = await page.request.get(`${WORKER_URL}/api/mastery/progress`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(canonicalResponse.ok(), await canonicalResponse.text()).toBe(true);
  const canonical = await canonicalResponse.json() as { revision: number; progress: Progress };
  expect(canonical.revision).toBe(2);
  expect(canonical.progress.completed).toEqual(['task-001', 'task-002']);
  expect(canonical.progress.taskStats['task-001']?.independentPasses).toBe(1);
  expect(canonical.progress.taskStats['task-002']?.independentPasses).toBe(1);

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
  expect(afterReload.completed).toEqual(['task-001', 'task-002']);

  const beforeNetworkFailure = await page.evaluate(key => localStorage.getItem(key), PROGRESS_KEY);
  await page.route('**/api/mastery/progress', route => route.abort('failed'));
  await syncButton.click();
  await expect(syncButton.locator('.lucide-wifi-off')).toBeVisible();
  const afterNetworkFailure = await page.evaluate(key => localStorage.getItem(key), PROGRESS_KEY);
  expect(afterNetworkFailure).toBe(beforeNetworkFailure);
  await page.unroute('**/api/mastery/progress');

  await testInfo.attach('evidence-sync-timeline.json', {
    body: Buffer.from(JSON.stringify({ timeline, canonicalRevision: canonical.revision, completed: canonical.progress.completed, cachedClient }, null, 2)),
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
