import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { authenticatePage, loginPage } from './auth-helper';

const SQLITE_NULL_ORDERING = `SELECT ticket_id, closed_at
FROM tickets
ORDER BY (closed_at IS NULL), closed_at, ticket_id;`;

const POSTGRES_NULL_ORDERING = `SELECT ticket_id, closed_at
FROM tickets
ORDER BY closed_at NULLS LAST, ticket_id;`;

const MYSQL_OPTIMISTIC_UPDATE = `UPDATE ticket_versions
SET priority = 'Critical', version = version + 1
WHERE ticket_id = 1002 AND version = 7;
SELECT ROW_COUNT() AS affected_rows;`;

async function openDialectLab(page: Page, mobile = false) {
  await page.goto('./');
  if (mobile) await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByTestId('syllabus-trigger').click();
  await page.getByRole('tab', { name: /Диалекты/i }).click();
  await expect(page.getByTestId('dialect-executable-lab')).toBeVisible();
}

async function replaceSql(page: Page, sql: string) {
  const editor = page.locator('.dialect-editor-card .monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sql);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test('desktop syllabus dialect lab executes SQLite and PostgreSQL evidence and hydrates a second device', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'dialect');
  await openDialectLab(page);

  await replaceSql(page, SQLITE_NULL_ORDERING);
  await page.getByTestId('run-dialect-lab').click();
  const evidence = page.getByTestId('dialect-evidence-card');
  await expect(evidence).toContainText('Contract подтверждён');
  await expect(evidence).toContainText('local-sqlite');
  await expect(page.locator('.dialect-sync-message')).toContainText(/Independent evidence синхронизирован|Cloud sync повторится/);

  await page.getByRole('button', { name: /PostgreSQL Remote sandbox/i }).click();
  await replaceSql(page, POSTGRES_NULL_ORDERING);
  await page.getByTestId('run-dialect-lab').click();
  await expect(evidence).toContainText('Contract подтверждён');
  await expect(evidence).toContainText('remote-sandbox');
  await expect(page.locator('.dialect-sync-message')).toContainText(/Independent evidence синхронизирован|Cloud sync повторится/);
  await expect(page.locator('.dialect-executable-hero')).toContainText('2/3');
  await page.screenshot({ path: testInfo.outputPath('desktop-dialect-evidence.png'), fullPage: true });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username);
  await openDialectLab(secondPage);
  await expect(secondPage.locator('.dialect-executable-hero')).toContainText('2/3');
  await expect(secondPage.getByRole('button', { name: /SQLite Local WASM/i }).locator('svg.passed')).toBeVisible();
  await expect(secondPage.getByRole('button', { name: /PostgreSQL Remote sandbox/i }).locator('svg.passed')).toBeVisible();
  await expectAccessible(secondPage);
  await secondContext.close();
});

test('mobile syllabus dialect lab blocks unsafe SQL and renders deterministic concurrency evidence without overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'dialectmobile');
  await openDialectLab(page, true);

  await replaceSql(page, 'SELECT 1; DROP TABLE tickets;');
  await page.getByTestId('run-dialect-lab').click();
  const evidence = page.getByTestId('dialect-evidence-card');
  await expect(evidence).toContainText('Нужна коррекция');
  await expect(evidence).toContainText(/Statement не входит в allowlist|Запрещённая конструкция/);

  await page.getByRole('button', { name: /Lost update under concurrent sessions/i }).click();
  await page.getByRole('button', { name: /MySQL Session simulator/i }).click();
  await replaceSql(page, MYSQL_OPTIMISTIC_UPDATE);
  await page.getByTestId('run-dialect-lab').click();
  await expect(evidence).toContainText('Contract подтверждён');
  await expect(evidence).toContainText('deterministic-simulation');
  await expect(page.locator('.dialect-timeline')).toContainText('B affected rows = 0');
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-dialect-simulation.png'), fullPage: true });
});
