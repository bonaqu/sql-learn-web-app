import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { capstoneContract } from '../../src/data/capstone-contracts';
import { authenticatePage, loginPage } from './auth-helper';

const PROJECT_ID = 'project-incident-command';
const contract = capstoneContract(PROJECT_ID);
if (!contract) throw new Error('Missing capstone contract for E2E');

const reflection = `Гранулярность результата — одна строка на одно обращение. Знаменатель breach rate включает только closed обращения, а open tickets остаются backlog и не получают ложное resolution time. Tie-breaker и финальный порядок делают рейтинг детерминированным. Hidden edge cases проверяют NULL, дубли и одинаковые значения риска. Эти ограничения нужно сохранить при использовании результата в operating review.`;

async function expectNoSeriousAxeViolations(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function openProjectLab(page: import('@playwright/test').Page, mobile = false) {
  await page.getByTestId(mobile ? 'curriculum-mobile-trigger' : 'curriculum-trigger').click();
  const studio = page.getByRole('dialog', { name: /Curriculum Studio/i });
  await expect(studio).toBeVisible();
  await studio.getByRole('tab', { name: /Project Lab/i }).click();
  await expect(page.getByTestId('project-lab')).toBeVisible();
  await expect(page.getByTestId('open-capstone-evaluator')).toBeVisible();
  return studio;
}

async function openEvaluator(page: import('@playwright/test').Page) {
  await page.getByTestId('open-capstone-evaluator').click();
  const evaluator = page.getByRole('dialog', { name: /Incident Command Dashboard/i });
  await expect(evaluator).toBeVisible();
  await expect(evaluator.getByTestId('capstone-sql-editor')).toBeVisible();
  return evaluator;
}

async function fillReferenceSubmission(evaluator: import('@playwright/test').Locator) {
  for (const file of contract.files) {
    await evaluator.locator('.capstone-files button').filter({ hasText: file.title }).click();
    const solution = file.kind === 'schema' ? file.starterSql : file.referenceSql || file.starterSql;
    await evaluator.getByTestId('capstone-sql-editor').fill(solution);
  }
  await evaluator.getByTestId('capstone-reflection').fill(reflection);
}

test('desktop capstone creates immutable report, exports portfolio and hydrates a second device', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'capstone');
  await page.goto('./');
  const studio = await openProjectLab(page);
  const evaluator = await openEvaluator(page);

  await expect(evaluator).toContainText('Passed report required');
  await fillReferenceSubmission(evaluator);
  await evaluator.getByTestId('submit-capstone').click();
  const report = evaluator.getByTestId('capstone-report');
  await expect(report).toContainText('Capstone passed', { timeout: 60_000 });
  await expect(report).toContainText('100%');
  await expect(report).toContainText('independence');
  await expect(evaluator.getByTestId('capstone-portfolio')).toBeVisible();
  await expect(evaluator).toContainText('Immutable attempt history');
  await expectNoSeriousAxeViolations(page);

  const markdownPromise = page.waitForEvent('download');
  await evaluator.getByRole('button', { name: 'Markdown' }).click();
  const markdown = await markdownPromise;
  expect(markdown.suggestedFilename()).toMatch(/portfolio\.md$/);

  const sqlPromise = page.waitForEvent('download');
  await evaluator.getByRole('button', { name: /SQL bundle/i }).click();
  const sql = await sqlPromise;
  expect(sql.suggestedFilename()).toMatch(/verified\.sql$/);

  await page.screenshot({ path: testInfo.outputPath('desktop-capstone-passed.png'), fullPage: true });
  await evaluator.getByRole('button', { name: 'Закрыть executable capstone' }).click();
  await studio.getByTestId('curriculum-sync').click();
  await expect(studio.getByTestId('curriculum-sync')).toContainText('В облаке');

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username, auth.password);
  await secondPage.goto('./');
  const secondStudio = await openProjectLab(secondPage);
  await secondStudio.getByTestId('curriculum-sync').click();
  await expect(secondStudio.getByTestId('curriculum-sync')).toContainText('В облаке');
  const secondEvaluator = await openEvaluator(secondPage);
  await expect(secondEvaluator).toContainText('100%');
  await expect(secondEvaluator.getByTestId('capstone-portfolio')).toBeVisible();
  await expect(secondEvaluator.getByTestId('capstone-sql-editor')).toHaveValue(/engineer_name/);
  await secondContext.close();
});

test('mobile capstone reports failed invariants without horizontal overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'capstonemobile');
  await page.goto('./');
  await openProjectLab(page, true);
  const evaluator = await openEvaluator(page);

  await evaluator.getByTestId('capstone-reflection').fill('Короткая заметка без полного контракта.');
  await evaluator.getByTestId('submit-capstone').click();
  const report = evaluator.getByTestId('capstone-report');
  await expect(report).toContainText('Remediation report', { timeout: 60_000 });
  await expect(report).toContainText(/Hidden dataset|result contract|Нужно не менее/i);
  await expect(evaluator).toContainText('FAILED');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await expectNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-capstone-remediation.png'), fullPage: true });
});
