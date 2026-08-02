import { expect, test } from '@playwright/test';
import { authenticatePage } from './auth-helper';

async function completeDeferredOnboarding(page: import('@playwright/test').Page) {
  const dialog = page.getByTestId('onboarding-portal');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Полная академия/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await dialog.getByRole('radio', { name: /25/ }).click();
  await dialog.getByRole('button', { name: /Устойчивый/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await dialog.getByRole('button', { name: /С нуля/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await dialog.getByTestId('defer-placement').click();
  await dialog.getByTestId('complete-onboarding').click();
  await dialog.getByRole('button', { name: 'Закрыть стартовый план' }).click();
}

test('desktop guided journey turns a first goal into one canonical primary action', async ({ page }) => {
  await authenticatePage(page, 'guided');
  await page.goto('./');

  await expect(page.getByTestId('guided-first-run')).toBeVisible();
  await page.getByRole('button', { name: 'Настроить мой маршрут' }).click();
  await expect(page.getByTestId('onboarding-portal')).toBeVisible();
  await completeDeferredOnboarding(page);

  await expect(page.getByTestId('guided-today')).toBeVisible();
  const journeyAction = page.getByTestId('guided-journey-action');
  await expect(journeyAction).toHaveAttribute('data-stage', 'lesson');
  await expect(journeyAction).not.toHaveAttribute('aria-busy', 'true');
  await expect(journeyAction.getByRole('button', { name: /Открыть урок/ })).toHaveCount(1);
  await expect(journeyAction).toContainText(/Надёжная база/i);
  await expect(journeyAction).toContainText(/SQL-мышление/i);
  await expect(page.locator('.sidebar nav > button, .sidebar nav > .onboarding-nav-slot')).toHaveCount(5);
  await expect(page.locator('.nav-more')).not.toHaveAttribute('open', '');

  await journeyAction.getByRole('button', { name: /Открыть урок/ }).click();
  const curriculum = page.getByTestId('curriculum-studio');
  await expect(curriculum).toBeVisible();
  await expect(curriculum.getByText('Урок 01 / 44')).toBeVisible();
  await expect(curriculum.getByRole('heading', { name: 'SQL-мышление', exact: true })).toBeVisible();
  await expect(curriculum).toContainText(/Как читать схему и превращать вопрос в запрос/i);
  await page.getByRole('button', { name: 'Закрыть Curriculum Studio' }).click();

  await page.locator('.nav-more > summary').click();
  await expect(page.getByRole('button', { name: 'Каталог задач' })).toBeVisible();
  await expect(page.getByTestId('checkpoint-trigger')).toBeVisible();
  await expect(page.getByTestId('learning-analytics-trigger')).toBeVisible();
});

test('mobile guided journey presents one clear first-run choice without overflow', async ({ page }) => {
  await authenticatePage(page, 'mobileguided');
  await page.goto('./');
  await expect(page.getByTestId('guided-first-run')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Настроить мой маршрут' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.getByRole('button', { name: 'Настроить мой маршрут' }).click();
  await expect(page.getByTestId('onboarding-portal')).toBeVisible();
});
