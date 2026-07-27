import { expect, test } from '@playwright/test';
import { authenticatePage, loginPage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

const ASSESSMENT_REPORTS_CHANGED_EVENT = 'sql-academy-assessment-reports-changed';

function diagnosticReport(userId: string) {
  return {
    version: 1,
    id: `onboarding-diagnostic-${Date.now()}`,
    userId,
    mode: 'diagnostic',
    status: 'completed',
    startedAt: '2026-07-25T17:30:00.000Z',
    completedAt: '2026-07-25T18:00:00.000Z',
    durationSeconds: 1200,
    score: 78,
    grade: 'ready',
    accuracy: 78,
    firstAttemptRate: 72,
    independence: 84,
    readinessDelta: 3,
    taskScores: [],
    moduleScores: [
      { module: 'select', title: 'SELECT', score: 92, correct: 1, total: 1 },
      { module: 'filtering', title: 'Фильтрация', score: 84, correct: 1, total: 1 },
      { module: 'joins', title: 'JOIN', score: 58, correct: 0, total: 1 },
      { module: 'windows', title: 'Оконные функции', score: 42, correct: 0, total: 1 }
    ],
    strengths: ['SELECT', 'Фильтрация'],
    weaknesses: ['Оконные функции', 'JOIN'],
    localDebrief: 'Placement fixture for onboarding E2E.'
  };
}

async function openOnboarding(page: import('@playwright/test').Page) {
  await openAdvancedTool(page, 'onboarding-trigger');
}

async function chooseCoreContract(page: import('@playwright/test').Page) {
  const dialog = page.getByTestId('onboarding-portal');
  await dialog.getByRole('button', { name: /Support SQL/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await expect(dialog.getByTestId('onboarding-schedule')).toBeVisible();
  await dialog.getByRole('radio', { name: /25/ }).click();
  await dialog.getByRole('button', { name: 'Вт' }).click();
  await dialog.getByRole('button', { name: /Устойчивый/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await expect(dialog.getByTestId('onboarding-experience')).toBeVisible();
  await dialog.getByRole('button', { name: /Использую время от времени/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await expect(dialog.getByTestId('onboarding-placement')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

test('desktop onboarding uses executable placement and hydrates the accepted plan on a second device', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'onboarding');
  await page.goto('./');
  await openOnboarding(page);
  const dialog = page.getByTestId('onboarding-portal');
  await expect(dialog).toBeVisible();
  await chooseCoreContract(page);

  await dialog.getByTestId('start-placement').click();
  const assessment = page.getByRole('dialog', { name: /Assessment Center/i });
  await expect(assessment).toBeVisible();
  await expect(assessment.getByRole('heading', { name: 'Diagnostic SQL Check' })).toBeVisible();
  await assessment.getByRole('button', { name: /Закрыть Assessment Center/i }).click();

  const report = diagnosticReport(String(auth.session.userId));
  await page.evaluate(({ userId, value, eventName }) => {
    localStorage.setItem(`sql-academy-assessment-reports-v1:${userId}`, JSON.stringify([value]));
    window.dispatchEvent(new CustomEvent(eventName, { detail: [value] }));
  }, { userId: String(auth.session.userId), value: report, eventName: ASSESSMENT_REPORTS_CHANGED_EVENT });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('onboarding-placement')).toContainText('78%');
  await expect(dialog.getByTestId('onboarding-placement')).toContainText('support');
  await expect(dialog.getByTestId('onboarding-placement')).toContainText('Оконные функции');
  await dialog.getByRole('button', { name: /Принять результат/i }).click();
  await expect(dialog.getByTestId('onboarding-plan')).toBeVisible();
  await expect(dialog.locator('.week-plan article')).toHaveCount(4);
  await expect(dialog.getByText('Правило восстановления')).toBeVisible();
  await dialog.getByTestId('complete-onboarding').click();
  await expect(dialog.getByRole('status')).toContainText(/облаке|локально/i);
  await page.screenshot({ path: testInfo.outputPath('desktop-onboarding-plan.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Закрыть стартовый план' }).click();

  await expect(page.getByTestId('onboarding-trigger')).toContainText('Мой учебный план');

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username, auth.password);
  await secondPage.goto('./');
  await secondPage.waitForTimeout(1200);
  await openOnboarding(secondPage);
  const secondDialog = secondPage.getByTestId('onboarding-portal');
  await expect(secondDialog.getByTestId('onboarding-plan')).toBeVisible();
  await expect(secondDialog).toContainText('Support');
  await expect(secondDialog.locator('.week-plan article')).toHaveCount(4);
  await secondContext.close();
});

test('mobile onboarding supports a conservative deferred placement without horizontal overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobileonboarding');
  await page.goto('./');
  await openOnboarding(page);
  const dialog = page.getByTestId('onboarding-portal');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: /Полная академия/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await dialog.getByRole('radio', { name: /15/ }).click();
  await dialog.getByRole('button', { name: /Мягкий/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await dialog.getByRole('button', { name: /С нуля/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await dialog.getByTestId('defer-placement').click();

  await expect(dialog.getByTestId('onboarding-plan')).toBeVisible();
  await expect(dialog).toContainText('foundation');
  await expect(dialog.locator('.week-plan article')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await dialog.getByTestId('complete-onboarding').click();
  await page.screenshot({ path: testInfo.outputPath('mobile-onboarding-plan.png'), fullPage: true });
});
