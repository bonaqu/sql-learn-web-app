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

test('new learner is guided into one route and returning home exposes one primary action', async ({ page }) => {
  await authenticatePage(page, 'guided');
  await page.goto('./');

  await expect(page.getByTestId('guided-first-run')).toBeVisible();
  await page.getByRole('button', { name: 'Настроить мой маршрут' }).click();
  await expect(page.getByTestId('onboarding-portal')).toBeVisible();
  await completeDeferredOnboarding(page);

  await expect(page.getByTestId('guided-today')).toBeVisible();
  await expect(page.getByTestId('guided-today').getByRole('button', { name: /Начать сессию|Начать повторение/ })).toHaveCount(1);
  await expect(page.locator('.sidebar nav > button, .sidebar nav > .onboarding-nav-slot')).toHaveCount(5);
  await expect(page.locator('.nav-more')).not.toHaveAttribute('open', '');

  await page.locator('.nav-more > summary').click();
  await expect(page.getByRole('button', { name: 'Каталог задач' })).toBeVisible();
  await expect(page.getByTestId('checkpoint-trigger')).toBeVisible();
  await expect(page.getByTestId('learning-analytics-trigger')).toBeVisible();
});
