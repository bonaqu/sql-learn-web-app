import { expect, test } from '@playwright/test';
import { authenticatePage } from './auth-helper';

const expectNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
};

test('desktop adaptive learning path shares the canonical beginner frontier and readiness evidence', async ({ page }, testInfo) => {
  await authenticatePage(page, 'desktop-path');
  await page.route('**/api/mentor', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answer: 'Персональный план\n• Изучи mental model\n• Выполни связанную практику\n• Заверши контрольной точкой' })
    });
  });

  await page.goto('./');
  await page.getByTestId('learning-path-trigger').click();
  const learningPath = page.getByTestId('learning-path');
  await expect(learningPath).toBeVisible();
  await expect(learningPath.getByRole('heading', { name: /Доказуемый путь к рабочему SQL/ })).toBeVisible();
  await expect(learningPath.locator('.phase-card')).toHaveCount(8);
  const sessionItems = learningPath.locator('.session-list > button');
  const sessionCount = await sessionItems.count();
  expect(sessionCount).toBeGreaterThanOrEqual(1);
  expect(sessionCount).toBeLessThanOrEqual(3);
  await expect(sessionItems.first()).toHaveAttribute('data-stage', 'lesson');
  await expect(sessionItems.first()).toContainText(/Mental model/i);
  await expect(sessionItems.first()).toContainText(/SQL-мышление/i);
  await expect(learningPath.locator('.readiness-ring strong')).toHaveText('0%');

  await learningPath.getByRole('button', { name: 'AI-план', exact: true }).click();
  await expect(learningPath.locator('.path-ai-answer')).toContainText('Персональный план');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-learning-path.png') });

  await learningPath.locator('.roadmap-section').scrollIntoViewIfNeeded();
  await expect(learningPath.getByRole('heading', { name: 'Карта доказательств' })).toBeVisible();
  expect(await learningPath.locator('.module-node').count()).toBeGreaterThanOrEqual(6);

  const explainer = learningPath.getByTestId('readiness-explainer');
  await expect(explainer).toBeVisible();
  await explainer.getByRole('button', { name: /Как считается readiness/i }).click();
  await expect(explainer.getByText(/Expired и abandoned attempts/)).toBeVisible();
  await expect(explainer.locator('.readiness-evidence-grid article')).toHaveCount(5);
  await expect(explainer.getByText(/вес 55/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-readiness-explainer.png') });

  await sessionItems.first().click();
  await expect(learningPath).toBeHidden();
  const curriculum = page.getByTestId('curriculum-studio');
  await expect(curriculum).toBeVisible();
  await expect(curriculum.getByText('Урок 01 / 44')).toBeVisible();
  await expect(curriculum.getByRole('heading', { name: 'SQL-мышление', exact: true })).toBeVisible();
  await expect(curriculum).toContainText(/Как читать схему и превращать вопрос в запрос/i);
});

test('mobile adaptive learning path keeps the same lesson frontier and readiness explanation responsive', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobile-path');
  await page.goto('./');
  await page.getByTestId('learning-path-mobile-trigger').click();
  const learningPath = page.getByTestId('learning-path');
  await expect(learningPath).toBeVisible();
  await expect(learningPath.locator('.readiness-ring')).toBeVisible();
  await expect(learningPath.locator('.phase-card')).toHaveCount(8);
  const firstSessionItem = learningPath.locator('.session-list > button').first();
  await expect(firstSessionItem).toBeVisible();
  await expect(firstSessionItem).toHaveAttribute('data-stage', 'lesson');
  await expect(firstSessionItem).toContainText(/SQL-мышление/i);

  await learningPath.locator('.path-top-actions select').selectOption('15');
  await expect(learningPath.getByRole('heading', { name: /Сессия на/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-learning-path.png') });

  await learningPath.locator('.roadmap-section').scrollIntoViewIfNeeded();
  await expect(learningPath.getByRole('heading', { name: 'Карта доказательств' })).toBeVisible();
  const explainer = learningPath.getByTestId('readiness-explainer');
  await explainer.getByRole('button', { name: /Как считается readiness/i }).click();
  await expect(explainer.locator('.readiness-evidence-grid article')).toHaveCount(5);
  await expect(explainer.getByText(/Неприменимый capstone/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-readiness-explainer.png'), fullPage: true });

  await learningPath.getByRole('button', { name: 'Закрыть учебный путь' }).click();
  await expect(learningPath).toBeHidden();
});
