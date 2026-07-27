#!/usr/bin/env bash
set -euo pipefail

python - <<'PY'
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one marker, found {count}: {old[:100]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')

Path('tests/e2e/navigation-helper.ts').write_text("""import type { Page } from '@playwright/test';

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
""", encoding='utf-8')

replace_once(
    'tests/e2e/assessment.spec.ts',
    "  await page.getByTestId('assessment-mobile-trigger').click();",
    "  await openAdvancedTool(page, 'assessment-trigger');"
)
replace_once(
    'tests/e2e/accessibility-pwa.spec.ts',
    "import { guidedHome, openAllTools } from './navigation-helper';",
    "import { guidedHome, openAdvancedTool, openAllTools } from './navigation-helper';"
)
replace_once(
    'tests/e2e/accessibility-pwa.spec.ts',
    "  await page.getByTestId('assessment-mobile-trigger').click();",
    "  await openAdvancedTool(page, 'assessment-trigger');"
)
replace_once(
    'tests/e2e/guided-journey.spec.ts',
    "test('new learner is guided into one route and returning home exposes one primary action', async ({ page }) => {",
    "test('desktop guided journey turns a first goal into one primary action', async ({ page }) => {"
)

guided = Path('tests/e2e/guided-journey.spec.ts')
guided_source = guided.read_text(encoding='utf-8')
mobile_test = """

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
"""
if "mobile guided journey presents one clear first-run choice" in guided_source:
    raise SystemExit('guided mobile test already exists')
guided.write_text(guided_source.rstrip() + mobile_test, encoding='utf-8')

replace_once(
    'playwright.config.ts',
    "grep: /desktop academy|desktop password account|desktop password recovery|desktop adaptive learning|desktop assessment|desktop checkpoint|desktop accessibility|desktop curriculum|desktop syllabus|desktop mastery|desktop onboarding|desktop capstone|desktop dialect/",
    "grep: /desktop academy|desktop guided journey|desktop password account|desktop password recovery|desktop adaptive learning|desktop assessment|desktop checkpoint|desktop accessibility|desktop curriculum|desktop syllabus|desktop mastery|desktop onboarding|desktop capstone|desktop dialect/"
)
replace_once(
    'playwright.config.ts',
    "grep: /mobile task flow|mobile password registration|mobile adaptive learning|mobile assessment|mobile checkpoint|mobile accessibility|mobile curriculum|mobile syllabus|mobile mastery|mobile onboarding|mobile capstone|mobile dialect/",
    "grep: /mobile task flow|mobile guided journey|mobile password registration|mobile adaptive learning|mobile assessment|mobile checkpoint|mobile accessibility|mobile curriculum|mobile syllabus|mobile mastery|mobile onboarding|mobile capstone|mobile dialect/"
)
PY

rm scripts/materialize-guided-test-fixes-once.sh
git show origin/bonaqu_projects:.github/workflows/quality.yml > .github/workflows/quality.yml
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
git diff --cached --check
git commit -m "Harden mobile guided navigation tests"
git push origin "HEAD:${GITHUB_HEAD_REF}"
