import { AxeBuilder } from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { authenticatePage, loginPage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

const SQLITE_NULL_ORDERING = `SELECT ticket_id, resolved_at
FROM tickets
ORDER BY (resolved_at IS NULL) ASC, resolved_at ASC, ticket_id ASC;`;

const POSTGRES_NULL_ORDERING = `SELECT ticket_id, resolved_at
FROM tickets
ORDER BY resolved_at ASC NULLS LAST, ticket_id ASC;`;

const SQLITE_DATE_BOUNDARY = `SELECT ticket_id, opened_at,
  CASE
    WHEN date(opened_at) = date('now') THEN 'today'
    WHEN date(opened_at) = date('now', '-1 day') THEN 'yesterday'
    ELSE 'older'
  END AS bucket
FROM tickets
ORDER BY ticket_id;`;

const MYSQL_OPTIMISTIC_UPDATE = `UPDATE tickets
SET status = 'closed', version = version + 1
WHERE ticket_id = 101 AND version = 3;`;

async function openDialectLab(page: Page, mobile = false) {
  await page.goto('./');
  await openAdvancedTool(page, 'syllabus-open');
  await page.getByRole('tab', { name: 'Диалекты' }).click();
  if (mobile) await page.getByRole('button', { name: /NULL ordering across engines/i }).click();
  await expect(page.getByTestId('dialect-executable-lab')).toBeVisible();
}

async function replaceSql(page: Page, sql: string) {
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.locator('.view-lines').click({ position: { x: 16, y: 16 } });
  await expect(editor).toHaveClass(/focused/);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(sql);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
}

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .include('[data-testid="dialect-executable-lab"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test('desktop keeps SQLite evidence executable while PostgreSQL stays an honest CI reference preview across devices', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'dialectfree');
  await openDialectLab(page);
  await expect(page.locator('.dialect-free-boundary')).toContainText('Cloudflare Free boundary');
  await expect(page.getByTestId('dialect-hydration-state')).toHaveCount(0);

  await page.getByTestId('run-dialect-lab').click();
  const evidence = page.getByTestId('dialect-evidence-card');
  await expect(evidence).toContainText('Нужна коррекция');
  await expect(page.locator('.dialect-errors')).toContainText('semantic marker');

  await replaceSql(page, SQLITE_NULL_ORDERING);
  await page.getByTestId('run-dialect-lab').click();
  await expect(evidence).toContainText('Contract подтверждён');
  await expect(evidence).toContainText('local-sqlite');
  await expect(page.locator('.dialect-sync-message')).toContainText('Independent evidence синхронизирован между устройствами.');
  await expect(page.locator('.dialect-executable-hero')).toContainText('1/3');

  const remoteEvidence = await page.evaluate(async () => {
    const response = await fetch('/api/dialect-labs/progress');
    const body = await response.json();
    return { status: response.status, body };
  });
  expect(remoteEvidence.status).toBe(200);
  expect(JSON.stringify(remoteEvidence.body)).toContain('dialect-null-ordering:sqlite');
  expect(JSON.stringify(remoteEvidence.body)).toContain('"passed":true');

  await page.getByRole('button', { name: /PostgreSQL Server contract/i }).click();
  await replaceSql(page, POSTGRES_NULL_ORDERING);
  await page.getByTestId('run-dialect-lab').click();
  await expect(evidence).toContainText('CI reference preview');
  await expect(evidence).toContainText('not evidence eligible');
  await expect(evidence).toContainText('remote-sandbox');
  await expect(page.locator('.dialect-sync-message')).toContainText('CI reference preview не засчитан');
  await expect(page.locator('.dialect-executable-hero')).toContainText('1/3');
  await expect(page.getByRole('button', { name: /PostgreSQL Server contract/i }).locator('svg.passed')).toHaveCount(0);

  const storageKey = `sql-academy-dialect-lab-progress-v1:${String(auth.session.userId)}`;
  const storedProgress = await page.evaluate(key => localStorage.getItem(key) || '', storageKey);
  expect(storedProgress).toContain('fnv1a-');
  expect(storedProgress).toContain('"passed":false');
  expect(storedProgress).toContain('"evidenceEligible":false');
  expect(storedProgress.toUpperCase()).not.toContain('SELECT TICKET_ID');
  expect(storedProgress.toUpperCase()).not.toContain('NULLS LAST');

  await page.getByRole('button', { name: /Date\/time boundary semantics/i }).click();
  await page.getByRole('button', { name: /SQLite Local WASM/i }).click();
  await page.getByTestId('run-dialect-lab').click();
  await page.getByTestId('run-dialect-lab').click();
  const reveal = page.getByRole('button', { name: /Reference после 2 попыток/i });
  await expect(reveal).toBeEnabled();
  await reveal.click();
  await replaceSql(page, SQLITE_DATE_BOUNDARY);
  await page.getByTestId('run-dialect-lab').click();
  await expect(evidence).toContainText('Contract подтверждён');
  await expect(page.locator('.dialect-sync-message')).toContainText('guided');
  await expect(page.locator('.dialect-executable-hero')).toContainText('0/3');

  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-dialect-free-preview.png'), fullPage: true });
  await page.close();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username);
  await openDialectLab(secondPage);
  await expect(secondPage.getByTestId('dialect-hydration-state')).toHaveCount(0);
  await expect(secondPage.locator('.dialect-executable-hero')).toContainText('1/3');
  await expect(secondPage.getByRole('button', { name: /SQLite Local WASM/i }).locator('svg.passed')).toBeVisible();
  await expect(secondPage.getByRole('button', { name: /PostgreSQL Server contract/i }).locator('svg.passed')).toHaveCount(0);
  const secondStored = await secondPage.evaluate(key => localStorage.getItem(key) || '', storageKey);
  expect(secondStored.toUpperCase()).not.toContain('SELECT TICKET_ID');
  await expectAccessible(secondPage);
  await secondContext.close();
});

test('mobile blocks unsafe SQL and shows concurrency reference timeline without false MySQL mastery or overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'dialectmobilefree');
  let hydrationOutage = true;
  let failedHydrationRequests = 0;
  await page.route('**/api/dialect-labs/progress', async route => {
    if (route.request().method() === 'GET' && hydrationOutage) {
      failedHydrationRequests += 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporary test outage' }) });
      return;
    }
    await route.continue();
  });
  await openDialectLab(page, true);

  const hydration = page.getByTestId('dialect-hydration-state');
  await expect(hydration).toContainText('Cloud evidence не подтверждён', { timeout: 30_000 });
  expect(failedHydrationRequests).toBeGreaterThan(1);
  await expect(page.locator('.dialect-executable-hero')).toContainText('local evidence only');
  hydrationOutage = false;
  await hydration.getByRole('button', { name: /Повторить cloud hydration/i }).click();
  await expect(hydration).toHaveCount(0);

  await replaceSql(page, 'SELECT 1; DROP TABLE tickets;');
  await page.getByTestId('run-dialect-lab').click();
  const evidence = page.getByTestId('dialect-evidence-card');
  await expect(evidence).toContainText('Нужна коррекция');
  await expect(evidence).toContainText(/Statement не входит в allowlist|Запрещённая конструкция/);

  await page.getByRole('button', { name: /Lost update under two sessions/i }).click();
  await page.getByRole('button', { name: /MySQL Server contract/i }).click();
  await replaceSql(page, MYSQL_OPTIMISTIC_UPDATE);
  await page.getByTestId('run-dialect-lab').click();
  await expect(evidence).toContainText('CI reference preview');
  await expect(evidence).toContainText('not evidence eligible');
  await expect(page.locator('.dialect-timeline')).toContainText('B affects zero rows');
  await expect(page.locator('.dialect-result-table')).toContainText('conflict');
  await expect(page.locator('.dialect-executable-hero')).toContainText('0/3');
  await expect(page.getByRole('button', { name: /MySQL Server contract/i }).locator('svg.passed')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-dialect-free-concurrency-preview.png'), fullPage: true });
});