import { expect, test, type Locator } from '@playwright/test';
import { authenticatePage } from './auth-helper';
import { openAdvancedTool, seedFirstLessonEvidence } from './navigation-helper';

const FIRST_SOLUTION = "SELECT ticket_id, service, status FROM tickets WHERE service = 'VPN' ORDER BY ticket_id;";

async function replaceEditorSql(page: import('@playwright/test').Page, sql: string) {
  const editor = page.locator('.editor-panel .monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sql);
}

async function solveConceptCard(card: Locator) {
  const options = card.locator('label');
  for (let index = 0; index < await options.count(); index += 1) {
    await options.nth(index).click();
    await card.getByRole('button', { name: /Проверить reasoning|Проверить ещё раз/ }).click();
    if (await card.evaluate(element => element.classList.contains('correct'))) return;
  }
  throw new Error('No correct concept-check option found');
}

async function completeFirstLessonTheory(page: import('@playwright/test').Page) {
  await openAdvancedTool(page, 'curriculum-trigger');
  const studio = page.getByRole('dialog', { name: /Curriculum Studio/i });
  await expect(studio).toBeVisible();
  const sectionButtons = studio.getByRole('button', { name: /Отметить раздел изученным/i });
  while (await sectionButtons.count()) await sectionButtons.first().click();

  const conceptPanel = studio.getByTestId('concept-check-panel');
  const cards = conceptPanel.locator('.concept-check-card');
  await expect(cards).toHaveCount(3);
  for (let index = 0; index < await cards.count(); index += 1) await solveConceptCard(cards.nth(index));
  await expect(conceptPanel).toContainText('3/3');
  await expect(studio.getByTestId('lesson-mastery-loop')).toContainText('Реши связанную SQL-задачу');
  await studio.getByRole('button', { name: 'Закрыть Curriculum Studio' }).click();
}

test('desktop mastery loop distinguishes guided success, independent retry and retention evidence', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mastery');
  await page.goto('./');
  await completeFirstLessonTheory(page);

  await page.getByRole('button', { name: 'Практика', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Практика' })).toBeVisible();
  await replaceEditorSql(page, 'SELECT, FROM tickets;');
  await page.getByRole('button', { name: /Проверить SQL/i }).click();
  await expect(page.getByTestId('attempt-diagnostic')).toContainText('Синтаксис не разобран');
  await expect(page.getByTestId('attempt-diagnostic')).toContainText('минимального SELECT');

  await page.getByRole('button', { name: 'Следующая подсказка' }).click();
  await replaceEditorSql(page, FIRST_SOLUTION);
  await page.getByRole('button', { name: /Проверить SQL/i }).click();
  await expect(page.locator('.feedback.success')).toContainText('guided');
  await expect(page.locator('.feedback.success')).toContainText('Independent: 0');

  await page.getByRole('button', { name: /Контракт результата: LMS/ }).click();
  await page.getByRole('button', { name: /Контракт результата: VPN/ }).click();
  await replaceEditorSql(page, FIRST_SOLUTION);
  await page.getByRole('button', { name: /Проверить SQL/i }).click();
  await expect(page.locator('.feedback.success')).toContainText('Independent mastery подтверждён');
  await expect(page.locator('.feedback.success')).toContainText('Independent: 1');

  await openAdvancedTool(page, 'curriculum-trigger');
  const studio = page.getByRole('dialog', { name: /Curriculum Studio/i });
  await expect(studio.getByText('Applied mastery', { exact: true }).first()).toBeVisible();
  await expect(studio.getByTestId('lesson-mastery-loop')).toContainText('independent SQL evidence');
  const remediation = studio.getByTestId('lesson-remediation');
  await expect(remediation).toContainText('SQL начинается с синтаксиса');
  await expect(remediation).toContainText('Сначала запиши');
  await page.screenshot({ path: testInfo.outputPath('desktop-mastery-loop.png'), fullPage: true });
  await studio.getByRole('button', { name: 'Закрыть Curriculum Studio' }).click();

  await openAdvancedTool(page, 'syllabus-trigger');
  const syllabus = page.getByRole('dialog', { name: /SQL Syllabus Center/i });
  await syllabus.getByRole('tab', { name: /Повторение/i }).click();
  await expect(syllabus.getByTestId('spaced-review')).toContainText('открыто по evidence');
  await expect(syllabus.getByTestId('spaced-review')).toContainText('31');
  await expect(syllabus.getByTestId('spaced-review')).toContainText('тем ещё не изучено');
});

test('mobile mastery diagnostics remain readable without horizontal overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobilemastery');
  await page.goto('./');
  await page.getByRole('button', { name: 'Практика', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Практика' })).toBeVisible();
  await seedFirstLessonEvidence(page);
  const firstTask = page.getByRole('button', { name: /001 Контракт результата: VPN/ });
  await expect(firstTask).toContainText('Текущий шаг маршрута');
  await firstTask.click();
  await replaceEditorSql(page, 'SELECT missing_column FROM tickets;');
  const runButton = page.getByRole('button', { name: /Проверить SQL/i });
  await expect(runButton).toBeEnabled();
  await runButton.click();
  const diagnostic = page.getByTestId('attempt-diagnostic');
  await expect(diagnostic).toBeVisible();
  await expect(diagnostic).toContainText('Запрос не совпадает со схемой');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('mobile-mastery-diagnostic.png'), fullPage: true });
});
