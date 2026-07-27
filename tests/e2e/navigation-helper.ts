import type { Page } from '@playwright/test';

export async function openAllTools(page: Page) {
  const sidebar = page.locator('.sidebar');
  const mobileMenu = page.getByRole('button', { name: 'Открыть меню' });
  const mobile = await mobileMenu.isVisible();
  const sidebarOpen = await sidebar.evaluate(element => element.classList.contains('open'));
  if (mobile && !sidebarOpen) await mobileMenu.click();

  const tools = sidebar.locator('.nav-more');
  if (mobile) await sidebar.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await tools.scrollIntoViewIfNeeded();
  if (!(await tools.evaluate(element => (element as HTMLDetailsElement).open))) {
    await tools.locator('summary').click({ force: mobile });
  }
}

export async function openAdvancedTool(page: Page, testId: string) {
  await openAllTools(page);
  await page.getByTestId(testId).click();
}

export function guidedHome(page: Page) {
  return page.locator('[data-testid="guided-first-run"], [data-testid="guided-today"]');
}
