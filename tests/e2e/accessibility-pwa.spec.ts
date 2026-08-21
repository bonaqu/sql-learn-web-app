import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { authenticatePage } from './auth-helper';
import { guidedHome, openAdvancedTool, openAllTools } from './navigation-helper';

async function expectNoSeriousAxeViolations(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function resourceNames(page: import('@playwright/test').Page) {
  return page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
}

test('desktop accessibility and PWA resilience preserve keyboard work', async ({ page, context }, testInfo) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Войти в академию/i })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await authenticatePage(page, 'a11ypwa');
  await page.goto('./');
  await expect(guidedHome(page)).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  const initialResources = await resourceNames(page);
  expect(initialResources.some(name => /assessment-|learning-path-|sqlite-|SqlEditor-/i.test(name))).toBe(false);

  const profileTrigger = page.getByTestId('profile-trigger');
  await profileTrigger.click();
  const profileDialog = page.getByRole('dialog', { name: /Настройки профиля/i });
  await expect(profileDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(profileDialog).toBeHidden();
  await expect(profileTrigger).toBeFocused();

  const pathTrigger = page.getByTestId('learning-path-trigger');
  await pathTrigger.click();
  await expect(page.getByRole('dialog', { name: /Доказуемый путь к рабочему SQL/i })).toBeVisible();
  await expect.poll(async () => (await resourceNames(page)).some(name => /learning-path-/i.test(name))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(pathTrigger).toBeFocused();

  await openAllTools(page);
  const assessmentTrigger = page.getByTestId('assessment-trigger');
  await assessmentTrigger.click();
  const assessmentDialog = page.getByRole('dialog', { name: /Assessment Center/i });
  await expect(assessmentDialog).toBeVisible();
  await expect.poll(async () => (await resourceNames(page)).some(name => /assessment-/i.test(name))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(assessmentTrigger).toBeFocused();

  await page.getByRole('button', { name: 'Практика' }).click();
  await expect(page.getByText('SQLite готов. Выполни запрос.')).toBeVisible();
  await expect.poll(async () => (await resourceNames(page)).some(name => /sqlite-/i.test(name))).toBe(true);
  await expect.poll(async () => (await resourceNames(page)).some(name => /SqlEditor-/i.test(name))).toBe(true);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('sql-academy-dirty-state', { detail: { dirty: true } }));
    window.dispatchEvent(new Event('sql-academy-pwa-update-available'));
  });
  const updateNotice = page.getByTestId('pwa-update-notice');
  await expect(updateNotice).toBeVisible();
  await updateNotice.getByRole('button', { name: 'Обновить сейчас' }).click();
  await expect(updateNotice.getByText(/активная или изменённая работа/i)).toBeVisible();
  await updateNotice.getByRole('button', { name: 'Позже' }).click();

  await context.setOffline(true);
  await expect(page.getByTestId('offline-notice')).toBeVisible();
  await expect(page.getByTestId('network-status')).toContainText('Офлайн');
  await context.setOffline(false);
  await expect(page.getByTestId('network-status')).toContainText('Онлайн');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const transitionSeconds = await page.locator('.skip-link').evaluate(element => parseFloat(getComputedStyle(element).transitionDuration) || 0);
  expect(transitionSeconds).toBeLessThanOrEqual(0.001);

  await expectNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-accessibility-pwa.png'), fullPage: true });
});

test('desktop accessibility exposes slow loading and recoverable auth error states', async ({ page }) => {
  await page.route('**/api/auth/login', async route => {
    await new Promise(resolve => setTimeout(resolve, 650));
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Сервис входа временно недоступен. Повтори попытку.' })
    });
  });
  await page.goto('./');
  await page.getByTestId('auth-username').fill('slow_network_probe');
  await page.getByTestId('auth-password').fill('Not-a-production-password-2026');
  const submit = page.getByTestId('auth-submit');
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(submit.locator('.spin')).toBeVisible();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Сервис входа временно недоступен');
  await expect(submit).toBeEnabled();
  await expectNoSeriousAxeViolations(page);
});

test('desktop accessibility keeps a service worker registration error non-blocking and natural', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('account-reason')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sql-academy-pwa-registration-error', {
    detail: { error: "Cannot read properties of undefined (reading 'waiting')" }
  })));
  const notice = page.getByTestId('pwa-registration-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Офлайн-режим недоступен');
  await expect(notice).toContainText('Онлайн-обучение продолжает работать');
  await expect(notice).not.toContainText(/Cannot read|undefined|waiting/i);
  await notice.getByRole('button', { name: 'Закрыть уведомление' }).click();
  await expect(notice).toBeHidden();
  await expectNoSeriousAxeViolations(page);
});

test('desktop accessibility account entry honors the persisted application theme before authentication', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sql-theme', 'light'));
  await page.goto('./');
  await expect(page.getByTestId('account-reason')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expectNoSeriousAxeViolations(page);
});

test('mobile accessibility keeps Assessment Center within Pixel 7 focus boundary', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobilea11y');
  await page.goto('./');
  await openAdvancedTool(page, 'assessment-trigger');
  const dialog = page.getByRole('dialog', { name: /Assessment Center/i });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  const focusInside = await page.evaluate(() => {
    const center = document.querySelector('[data-testid="assessment-center"]');
    return Boolean(center && center.contains(document.activeElement));
  });
  expect(focusInside).toBe(true);
  await expectNoSeriousAxeViolations(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('mobile-accessibility-assessment.png'), fullPage: true });
});

test('mobile accessibility keeps navigation inert focus-restored and Practice compact', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('./');
  await expect(page.getByTestId('account-reason')).toContainText(/платформа бесплатна/i);
  await expectNoSeriousAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  const authTargets = await page.locator('.auth-tabs button, .password-field button, .auth-primary').evaluateAll(elements =>
    elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
  );
  expect(authTargets.every(target => target.width >= 44 && target.height >= 44)).toBe(true);

  await authenticatePage(page, 'mobilephase12');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('./');
  await expect(guidedHome(page)).toBeVisible();

  const drawer = page.locator('#mobile-navigation-drawer');
  await expect(drawer).toHaveAttribute('aria-hidden', 'true');
  expect(await drawer.evaluate(element => (element as HTMLElement).inert)).toBe(true);

  const moreTrigger = page.getByTestId('mobile-more-trigger');
  await moreTrigger.click();
  await expect(page.getByRole('button', { name: 'Закрыть меню' })).toBeFocused();
  await expect(drawer).not.toHaveAttribute('aria-hidden', 'true');
  expect(await page.locator('#main-content').evaluate(element => (element as HTMLElement).inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(moreTrigger).toBeFocused();
  await expect(drawer).toHaveAttribute('aria-hidden', 'true');

  const mobileTargets = await page.locator('.mobile-menu, .close-mobile, .mobile-bottom-nav button').evaluateAll(elements =>
    elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
  );
  expect(mobileTargets.every(target => target.width >= 44 && target.height >= 44), JSON.stringify(mobileTargets)).toBe(true);

  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await drawer.getByRole('button', { name: 'Практика' }).click();
  await expect(page.getByRole('heading', { name: 'Практика' })).toBeVisible();
  await expect(page.locator('.task-row')).toHaveCount(12);
  await expect(page.getByTestId('practice-focused-disclosure')).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);

  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectNoSeriousAxeViolations(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-phase12-light-practice.png'), fullPage: true });
});
