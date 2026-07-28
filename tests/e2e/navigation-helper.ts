import type { Page } from '@playwright/test';

export async function openAllTools(page: Page) {
  const sidebar = page.locator('.sidebar');
  const sidebarOpen = await sidebar.evaluate(element => element.classList.contains('open'));

  if (!sidebarOpen) {
    const mobileMore = page.getByRole('button', { name: 'Ещё', exact: true });
    const mobileMenu = page.getByRole('button', { name: 'Открыть меню' });

    if (await mobileMore.isVisible()) {
      await mobileMore.click();
    } else if (await mobileMenu.isVisible()) {
      await mobileMenu.click();
    }

    await page.waitForFunction(() => document.querySelector('.sidebar')?.classList.contains('open'));
  }

  const tools = sidebar.locator('.nav-more');
  await tools.scrollIntoViewIfNeeded();
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
