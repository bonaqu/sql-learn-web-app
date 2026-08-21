import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { tasks } from '../../src/data/course-catalog';
import { assertPerformanceBudget, performanceBudgets, type PerformanceMetric } from '../../scripts/performance-budgets';
import { authenticatePage } from './auth-helper';
import { guidedHome, seedFirstLessonEvidence } from './navigation-helper';

type BrowserMetrics = Record<PerformanceMetric, number> & {
  resources: Array<{ name: string; initiator: string; transferKiB: number; decodedKiB: number; durationMs: number }>;
};

const observerScript = () => {
  const state = { lcpMs: 0, cls: 0, longTasks: [] as number[] };
  (globalThis as typeof globalThis & { __sqlAcademyPerformance?: typeof state }).__sqlAcademyPerformance = state;
  new PerformanceObserver(list => {
    const entry = list.getEntries().at(-1);
    if (entry) state.lcpMs = entry.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver(list => {
    for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
      if (!entry.hadRecentInput) state.cls += entry.value || 0;
    }
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
  }).observe({ type: 'longtask', buffered: true });
};

async function installPerformanceObservers(page: Page) {
  await page.addInitScript(observerScript);
}

async function resetActionMetrics(page: Page) {
  await page.evaluate(() => {
    performance.clearResourceTimings();
    const state = (globalThis as typeof globalThis & { __sqlAcademyPerformance?: { longTasks: number[] } }).__sqlAcademyPerformance;
    if (state) state.longTasks = [];
  });
}

async function browserMetrics(page: Page, actionMs = 0): Promise<BrowserMetrics> {
  await page.waitForTimeout(250);
  return page.evaluate(measuredActionMs => {
    const state = (globalThis as typeof globalThis & {
      __sqlAcademyPerformance?: { lcpMs: number; cls: number; longTasks: number[] };
    }).__sqlAcademyPerformance || { lcpMs: 0, cls: 0, longTasks: [] };
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return {
      lcpMs: Math.round(state.lcpMs),
      cls: Math.round(state.cls * 10_000) / 10_000,
      tbtMs: Math.round(state.longTasks.reduce((total, duration) => total + Math.max(0, duration - 50), 0)),
      transferKiB: Math.round(resources.reduce((total, entry) => total + entry.transferSize, 0) / 1024 * 10) / 10,
      decodedKiB: Math.round(resources.reduce((total, entry) => total + entry.decodedBodySize, 0) / 1024 * 10) / 10,
      actionMs: Math.round(measuredActionMs),
      resources: resources.map(entry => ({
        name: entry.name.split('/').pop() || entry.name,
        initiator: entry.initiatorType,
        transferKiB: Math.round(entry.transferSize / 1024 * 10) / 10,
        decodedKiB: Math.round(entry.decodedBodySize / 1024 * 10) / 10,
        durationMs: Math.round(entry.duration)
      }))
    };
  }, actionMs);
}

function medianMetrics(samples: BrowserMetrics[]): BrowserMetrics {
  const median = (metric: PerformanceMetric) => {
    const values = samples.map(sample => sample[metric]).sort((left, right) => left - right);
    return values[Math.floor(values.length / 2)];
  };
  return {
    lcpMs: median('lcpMs'), cls: median('cls'), tbtMs: median('tbtMs'),
    transferKiB: median('transferKiB'), decodedKiB: median('decodedKiB'), actionMs: median('actionMs'),
    resources: samples[1]?.resources || samples[0].resources
  };
}

function assertWithin(journey: keyof typeof performanceBudgets, metrics: BrowserMetrics) {
  expect(() => assertPerformanceBudget(journey, metrics)).not.toThrow();
}

test('desktop performance traces first visit route editor and first query', async ({ browser, page }, testInfo) => {
  test.setTimeout(180_000);
  const firstVisitSamples: BrowserMetrics[] = [];
  for (let run = 0; run < 3; run += 1) {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, serviceWorkers: 'block' });
    const samplePage = await context.newPage();
    await installPerformanceObservers(samplePage);
    await samplePage.goto('./', { waitUntil: 'networkidle' });
    await expect(samplePage.getByTestId('account-reason')).toBeVisible();
    if (run === 1) await samplePage.screenshot({ path: testInfo.outputPath('first-visit-mobile.png'), fullPage: true });
    firstVisitSamples.push(await browserMetrics(samplePage));
    await context.close();
  }

  const firstVisit = medianMetrics(firstVisitSamples);
  assertWithin('firstVisit', firstVisit);
  expect(firstVisit.resources.map(resource => resource.name).join('\n')).not.toMatch(/AuthenticatedAcademy|course-catalog|progress-|SqlEditor|monaco-|sql-wasm/i);

  await installPerformanceObservers(page);
  await authenticatePage(page, 'performance');
  await page.goto('./', { waitUntil: 'networkidle' });
  await expect(guidedHome(page)).toBeVisible();
  const authenticatedHome = await browserMetrics(page);
  assertWithin('authenticatedHome', authenticatedHome);
  expect(authenticatedHome.resources.map(resource => resource.name).join('\n')).not.toMatch(/SqlEditor|monaco-|sql-wasm/i);

  await resetActionMetrics(page);
  const routeStarted = performance.now();
  await page.getByTestId('learning-path-trigger').click();
  const routeDialog = page.getByRole('dialog', { name: /Доказуемый путь к рабочему SQL/i });
  await expect(routeDialog).toBeVisible();
  await expect(routeDialog.getByRole('button', { name: 'Начать сессию' })).toBeVisible();
  await expect(routeDialog.locator('.path-secondary-actions')).not.toHaveAttribute('open', '');
  await expect(routeDialog.getByTestId('goal-switch-trigger')).toBeHidden();
  const routeOpen = await browserMetrics(page, performance.now() - routeStarted);
  assertWithin('routeOpen', routeOpen);
  await page.keyboard.press('Escape');

  await seedFirstLessonEvidence(page);
  await resetActionMetrics(page);
  const practiceStarted = performance.now();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Практика' }).click();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByText('SQLite готов. Выполни запрос.')).toBeVisible();
  const practiceEditor = await browserMetrics(page, performance.now() - practiceStarted);
  assertWithin('practiceEditor', practiceEditor);
  await expect(page.locator('.task-row')).toHaveCount(12);
  await expect(page.getByTestId('practice-focused-disclosure')).toBeVisible();
  await expect(page.locator('.lesson-card')).not.toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: /Проверить SQL/ })).toBeVisible();

  await page.locator('.task-row').first().click();
  const editor = page.locator('.monaco-editor');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(tasks[0].solution);
  await resetActionMetrics(page);
  const queryStarted = performance.now();
  await page.getByRole('button', { name: /Проверить SQL/ }).click();
  await expect(page.locator('.feedback.success')).toContainText('Верно');
  const firstQuery = await browserMetrics(page, performance.now() - queryStarted);
  assertWithin('firstQuery', firstQuery);

  const report = { budgets: performanceBudgets, firstVisitSamples, firstVisit, authenticatedHome, routeOpen, practiceEditor, firstQuery };
  await writeFile(testInfo.outputPath('phase-12-performance-waterfall.json'), JSON.stringify(report, null, 2), 'utf8');
  await testInfo.attach('phase-12-performance-waterfall.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json'
  });
});
