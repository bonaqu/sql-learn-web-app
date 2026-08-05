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