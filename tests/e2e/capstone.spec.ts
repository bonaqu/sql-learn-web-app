import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { capstoneContract } from '../../src/data/capstone-contracts';
import { capstoneProjects } from '../../src/data/complete-curriculum';
import { authenticatePage, loginPage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

const PROJECT_ID = 'project-incident-command';
const contract = capstoneContract(PROJECT_ID);
if (!contract) throw new Error('Missing capstone contract for E2E');

const reflection = `Гранулярность результата — одна строка на одно обращение. Знаменатель breach rate включает только closed обращения, а open tickets остаются backlog и не получают ложное resolution time. История событий агрегируется без умножения обращений. Tie-breaker и финальный порядок делают рейтинг детерминированным. Hidden edge cases проверяют NULL, дубли и одинаковые значения риска. Эти ограничения нужно сохранить при использовании результата в operating review.`;

async function expectNoSeriousAxeViolations(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function openProjectLab(page: import('@playwright/test').Page) {
  await openAdvancedTool(page, 'curriculum-trigger');
  const studio = page.getByRole('dialog', { name: /Учебная программа/i });
  await expect(studio).toBeVisible();
  await studio.getByRole('tab', { name: /Project Lab/i }).click();
  await expect(page.getByTestId('project-lab')).toBeVisible();
  await expect(page.getByTestId('open-capstone-evaluator')).toBeVisible();
  return studio;
}

async function openEvaluator(page: import('@playwright/test').Page, name: RegExp = /Incident Command Dashboard/i) {
  await page.getByTestId('open-capstone-evaluator').click();
  const evaluator = page.getByRole('dialog', { name });
  await expect(evaluator).toBeVisible();
  await expect(evaluator.getByTestId('capstone-sql-editor')).toBeVisible();
  return evaluator;
}

function reflectionFor(activeContract: NonNullable<ReturnType<typeof capstoneContract>>) {
  const ideas = activeContract.reflection.requiredIdeas.map(idea => idea.keywords[0]).join('. ');
  const sentence = `${ideas}. Public и hidden fixtures проверяют edge cases, порядок и ограничения результата; evidence отделено от гипотезы. `;
  return sentence.repeat(Math.ceil((activeContract.reflection.minimumCharacters + 30) / sentence.length));
}

async function fillReferenceSubmission(evaluator: import('@playwright/test').Locator, activeContract = contract) {
  for (const file of activeContract.files) {
    await evaluator.locator('.capstone-files button').filter({ hasText: file.title }).click();
    const solution = file.kind === 'schema' ? file.starterSql : file.referenceSql || file.starterSql;
    await evaluator.getByTestId('capstone-sql-editor').fill(solution);
  }
  await evaluator.getByTestId('capstone-reflection').fill(activeContract === contract ? reflection : reflectionFor(activeContract));
}

test('desktop capstone traces failure, remediation and independent pass for every professional track', async ({ page }, testInfo) => {
  test.setTimeout(260_000);
  await authenticatePage(page, 'all-track-capstones');
  await page.goto('./');
  const studio = await openProjectLab(page);

  for (const project of capstoneProjects) {
    const activeContract = capstoneContract(project.id);
    if (!activeContract) throw new Error(`Missing contract for ${project.id}`);
    await studio.locator('.project-catalog > button').filter({ hasText: project.title }).click();
    await expect(studio.getByTestId('project-track-contract')).toContainText(project.portfolioOutcome);
    await expect(studio.getByTestId('project-originality')).toContainText(/синтетическ|оригинальн/i);
    const evaluator = await openEvaluator(page, new RegExp(project.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    await expect(evaluator.getByTestId('capstone-engine-evidence')).toContainText('SQLite limitation');

    await evaluator.getByTestId('capstone-reflection').fill('Недостаточное объяснение.');
    await evaluator.getByTestId('submit-capstone').click();
    await expect(evaluator.getByTestId('capstone-report')).toContainText('Remediation report', { timeout: 60_000 });
    await expect(evaluator.getByTestId('capstone-report')).toContainText(/Нужно не менее|Неверный result contract|SQLite/i);

    await fillReferenceSubmission(evaluator, activeContract);
    await evaluator.getByTestId('submit-capstone').click();
    const passed = evaluator.getByTestId('capstone-report');
    await expect(passed).toContainText('Capstone passed', { timeout: 60_000 });
    await expect(passed).toContainText('100%');
    await expect(passed).toContainText('independent');
    await expect(evaluator.locator('.capstone-status')).toContainText(/сохранён локально и в D1/i);
    if (project.trackId === 'backend') await expect(passed).toContainText(/final database state/i);
    if (project.id === capstoneProjects.at(-1)?.id) {
      await page.keyboard.press('Escape');
      await expect(evaluator).toBeHidden();
      await expect(studio.getByTestId('open-capstone-evaluator')).toBeFocused();
    } else {
      await evaluator.getByRole('button', { name: 'Закрыть executable capstone' }).click();
    }
  }

  await expectNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-all-track-capstones.png'), fullPage: true });
});

test('desktop capstone creates immutable report, exports portfolio and hydrates a second device', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'capstone');
  const userId = String(auth.session.userId || '');
  await page.goto('./');
  const studio = await openProjectLab(page);

  await studio.getByRole('button', { name: /Customer Data Trust Audit/i }).click();
  const trustEvaluator = await openEvaluator(page, /Customer Data Trust Audit/i);
  await trustEvaluator.getByRole('button', { name: 'Закрыть executable capstone' }).click();
  await expect(trustEvaluator).toBeHidden();
  await studio.getByRole('button', { name: /Incident Command Dashboard/i }).click();

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

  const popupPromise = page.waitForEvent('popup');
  await evaluator.getByRole('button', { name: /Печать \/ PDF/i }).click();
  const printPage = await popupPromise;
  await expect(printPage.getByRole('heading', { name: 'Incident Command Dashboard' })).toBeVisible();
  if (userId) await expect(printPage.locator('body')).not.toContainText(userId);
  await expect(printPage.locator('body')).toContainText('Engineering reflection');
  await printPage.close();

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
  await page.setViewportSize({ width: 360, height: 800 });
  await authenticatePage(page, 'capstonemobile');
  await page.goto('./');
  await openProjectLab(page);
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
