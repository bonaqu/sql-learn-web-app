import type { Page } from '@playwright/test';

export async function openAllTools(page: Page) {
  const mobileMenu = page.getByRole('button', { name: 'Открыть меню' });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  const tools = page.locator('.nav-more');
  if (!(await tools.evaluate(element => (element as HTMLDetailsElement).open))) {
    await tools.locator('summary').click();
  }
}

export async function openAdvancedTool(page: Page, testId: string) {
  await openAllTools(page);
  await page.getByTestId(testId).click();
}

export function guidedHome(page: Page) {
  return page.locator('[data-testid="guided-first-run"], [data-testid="guided-today"]');
}
