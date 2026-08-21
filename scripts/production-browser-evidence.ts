import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { assertPerformanceBudget, performanceBudgets, type PerformanceMetric } from './performance-budgets';

type TraceMetrics = Record<PerformanceMetric, number> & {
  responseStatus: number;
  resourceCount: number;
  horizontalOverflowPx: number;
  topResources: Array<{ name: string; transferKiB: number; decodedKiB: number; durationMs: number }>;
};

const targetUrl = new URL(process.env.PRODUCTION_BROWSER_URL || 'https://bonaqu.github.io/sql-learn-web-app/').href;
const outputDirectory = resolve(process.env.PRODUCTION_BROWSER_OUTPUT || 'test-results/production-browser-evidence');
const profiles = [
  { id: 'desktop-light', viewport: { width: 1440, height: 1000 }, colorScheme: 'light' as const },
  { id: 'desktop-dark', viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' as const },
  { id: 'mobile-light', viewport: { width: 390, height: 844 }, colorScheme: 'light' as const },
  { id: 'mobile-dark', viewport: { width: 390, height: 844 }, colorScheme: 'dark' as const }
];

const observerScript = () => {
  const state = { lcpMs: 0, cls: 0, longTasks: [] as number[] };
  (globalThis as typeof globalThis & { __productionEvidence?: typeof state }).__productionEvidence = state;
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

async function metrics(page: Page, responseStatus: number): Promise<TraceMetrics> {
  await page.waitForTimeout(750);
  return page.evaluate(status => {
    const state = (globalThis as typeof globalThis & {
      __productionEvidence?: { lcpMs: number; cls: number; longTasks: number[] };
    }).__productionEvidence || { lcpMs: 0, cls: 0, longTasks: [] };
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const ordered = resources.map(entry => ({
      name: new URL(entry.name).pathname.split('/').pop() || entry.name,
      transferKiB: Math.round(entry.transferSize / 1024 * 10) / 10,
      decodedKiB: Math.round(entry.decodedBodySize / 1024 * 10) / 10,
      durationMs: Math.round(entry.duration)
    })).sort((left, right) => right.transferKiB - left.transferKiB || right.durationMs - left.durationMs);
    return {
      lcpMs: Math.round(state.lcpMs),
      cls: Math.round(state.cls * 10_000) / 10_000,
      tbtMs: Math.round(state.longTasks.reduce((total, duration) => total + Math.max(0, duration - 50), 0)),
      transferKiB: Math.round((resources.reduce((total, entry) => total + entry.transferSize, 0) + (navigation?.transferSize || 0)) / 1024 * 10) / 10,
      decodedKiB: Math.round((resources.reduce((total, entry) => total + entry.decodedBodySize, 0) + (navigation?.decodedBodySize || 0)) / 1024 * 10) / 10,
      actionMs: Math.round(navigation?.loadEventEnd || 0),
      responseStatus: status,
      resourceCount: resources.length,
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      topResources: ordered.slice(0, 12)
    };
  }, responseStatus);
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const evidence: Array<{ id: string; metrics: TraceMetrics; consoleErrors: string[]; screenshot: string }> = [];

try {
  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: profile.viewport,
      colorScheme: profile.colorScheme,
      serviceWorkers: 'block'
    });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.addInitScript(observerScript);
    const response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 45_000 });
    if (!response?.ok()) throw new Error(`${profile.id} returned HTTP ${response?.status() || 0}`);
    await page.getByTestId('account-reason').waitFor({ state: 'visible' });
    await page.getByText('Онлайн', { exact: true }).waitFor({ state: 'visible' });
    const pwaNotice = page.getByTestId('pwa-registration-notice');
    if (await pwaNotice.isVisible()) {
      const noticeText = await pwaNotice.innerText();
      if (!noticeText.includes('Онлайн-обучение продолжает работать') || /Cannot read|undefined|waiting/i.test(noticeText)) {
        throw new Error(`${profile.id} exposed an unsafe PWA fallback: ${noticeText}`);
      }
      await pwaNotice.getByRole('button', { name: 'Закрыть уведомление' }).click();
      await pwaNotice.waitFor({ state: 'hidden' });
    }
    const measured = await metrics(page, response.status());
    if (measured.lcpMs <= 0) throw new Error(`${profile.id} did not report LCP`);
    if (measured.horizontalOverflowPx !== 0) throw new Error(`${profile.id} has ${measured.horizontalOverflowPx}px horizontal overflow`);
    if (consoleErrors.length) throw new Error(`${profile.id} console/page errors: ${consoleErrors.join(' | ')}`);
    assertPerformanceBudget('firstVisit', measured);
    const screenshot = resolve(outputDirectory, `${profile.id}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    evidence.push({ id: profile.id, metrics: measured, consoleErrors, screenshot });
    await context.close();
  }
} finally {
  await browser.close();
}

const report = {
  version: 1,
  targetUrl,
  capturedAt: new Date().toISOString(),
  budgets: performanceBudgets.firstVisit,
  profiles: evidence
};
const reportPath = resolve(outputDirectory, 'production-browser-evidence.json');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`Production browser evidence passed: ${evidence.map(item => `${item.id} LCP=${item.metrics.lcpMs}ms transfer=${item.metrics.transferKiB}KiB CLS=${item.metrics.cls} TBT=${item.metrics.tbtMs}ms`).join('; ')}; report=${reportPath}\n`);
