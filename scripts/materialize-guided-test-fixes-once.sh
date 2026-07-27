#!/usr/bin/env bash
set -euo pipefail

cat > /tmp/guided-test-fixes.patch <<'PATCH'
diff --git a/tests/e2e/navigation-helper.ts b/tests/e2e/navigation-helper.ts
index 7da6e2b..3efe77e 100644
--- a/tests/e2e/navigation-helper.ts
+++ b/tests/e2e/navigation-helper.ts
@@ -1,12 +1,18 @@
 import type { Page } from '@playwright/test';
 
 export async function openAllTools(page: Page) {
+  const sidebar = page.locator('.sidebar');
   const mobileMenu = page.getByRole('button', { name: 'Открыть меню' });
-  if (await mobileMenu.isVisible()) await mobileMenu.click();
-  const tools = page.locator('.nav-more');
+  const mobile = await mobileMenu.isVisible();
+  const sidebarOpen = await sidebar.evaluate(element => element.classList.contains('open'));
+  if (mobile && !sidebarOpen) await mobileMenu.click();
+
+  const tools = sidebar.locator('.nav-more');
+  if (mobile) await sidebar.evaluate(element => { element.scrollTop = element.scrollHeight; });
+  await tools.scrollIntoViewIfNeeded();
   if (!(await tools.evaluate(element => (element as HTMLDetailsElement).open))) {
-    await tools.locator('summary').click();
+    await tools.locator('summary').click({ force: mobile });
   }
 }
 
 export async function openAdvancedTool(page: Page, testId: string) {
   await openAllTools(page);
   await page.getByTestId(testId).click();
 }
diff --git a/tests/e2e/assessment.spec.ts b/tests/e2e/assessment.spec.ts
index b9187de..bf5e4d1 100644
--- a/tests/e2e/assessment.spec.ts
+++ b/tests/e2e/assessment.spec.ts
@@ -216,7 +216,7 @@ test('mobile assessment landing, adaptive session and measurement panel fit Pixe
 test('mobile assessment landing, adaptive session and measurement panel fit Pixel 7', async ({ page }, testInfo) => {
   await authenticatePage(page, 'mobileassess');
   await page.goto('./');
-  await page.getByTestId('assessment-mobile-trigger').click();
+  await openAdvancedTool(page, 'assessment-trigger');
   await expect(page.getByTestId('assessment-landing')).toBeVisible();
   await expect(page.locator('.assessment-mode-card')).toHaveCount(6);
   await expect(page.getByTestId('assessment-calibration-summary')).toBeVisible();
diff --git a/tests/e2e/accessibility-pwa.spec.ts b/tests/e2e/accessibility-pwa.spec.ts
index e0731a9..60d8ba1 100644
--- a/tests/e2e/accessibility-pwa.spec.ts
+++ b/tests/e2e/accessibility-pwa.spec.ts
@@ -3,7 +3,7 @@ import AxeBuilder from '@axe-core/playwright';
 import { expect, test } from '@playwright/test';
 import { authenticatePage } from './auth-helper';
-import { guidedHome, openAllTools } from './navigation-helper';
+import { guidedHome, openAdvancedTool, openAllTools } from './navigation-helper';
@@ -90,7 +90,7 @@ test('mobile accessibility keeps Assessment Center within Pixel 7 focus boundary
 test('mobile accessibility keeps Assessment Center within Pixel 7 focus boundary', async ({ page }, testInfo) => {
   await authenticatePage(page, 'mobilea11y');
   await page.goto('./');
-  await page.getByTestId('assessment-mobile-trigger').click();
+  await openAdvancedTool(page, 'assessment-trigger');
   const dialog = page.getByRole('dialog', { name: /Assessment Center/i });
   await expect(dialog).toBeVisible();
   await page.keyboard.press('Tab');
diff --git a/tests/e2e/guided-journey.spec.ts b/tests/e2e/guided-journey.spec.ts
index a0d6693..58cfd32 100644
--- a/tests/e2e/guided-journey.spec.ts
+++ b/tests/e2e/guided-journey.spec.ts
@@ -18,7 +18,7 @@ async function completeDeferredOnboarding(page: import('@playwright/test').Page)
   await dialog.getByRole('button', { name: 'Закрыть стартовый план' }).click();
 }
 
-test('new learner is guided into one route and returning home exposes one primary action', async ({ page }) => {
+test('desktop guided journey turns a first goal into one primary action', async ({ page }) => {
   await authenticatePage(page, 'guided');
   await page.goto('./');
@@ -38,3 +38,13 @@ test('new learner is guided into one route and returning home exposes one primar
   await expect(page.getByTestId('checkpoint-trigger')).toBeVisible();
   await expect(page.getByTestId('learning-analytics-trigger')).toBeVisible();
 });
+
+test('mobile guided journey presents one clear first-run choice without overflow', async ({ page }) => {
+  await authenticatePage(page, 'mobileguided');
+  await page.goto('./');
+  await expect(page.getByTestId('guided-first-run')).toBeVisible();
+  await expect(page.getByRole('button', { name: 'Настроить мой маршрут' })).toBeVisible();
+  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
+  expect(overflow).toBe(false);
+  await page.getByRole('button', { name: 'Настроить мой маршрут' }).click();
+  await expect(page.getByTestId('onboarding-portal')).toBeVisible();
+});
diff --git a/playwright.config.ts b/playwright.config.ts
index 328bc02..a2e624b 100644
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -38,12 +38,12 @@ export default defineConfig({
   projects: [
     {
       name: 'desktop-chromium',
-      grep: /desktop academy|desktop password account|desktop password recovery|desktop adaptive learning|desktop assessment|desktop checkpoint|desktop accessibility|desktop curriculum|desktop syllabus|desktop mastery|desktop onboarding|desktop capstone|desktop dialect/,
+      grep: /desktop academy|desktop guided journey|desktop password account|desktop password recovery|desktop adaptive learning|desktop assessment|desktop checkpoint|desktop accessibility|desktop curriculum|desktop syllabus|desktop mastery|desktop onboarding|desktop capstone|desktop dialect/,
       use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } }
     },
     {
       name: 'mobile-chromium',
-      grep: /mobile task flow|mobile password registration|mobile adaptive learning|mobile assessment|mobile checkpoint|mobile accessibility|mobile curriculum|mobile syllabus|mobile mastery|mobile onboarding|mobile capstone|mobile dialect/,
+      grep: /mobile task flow|mobile guided journey|mobile password registration|mobile adaptive learning|mobile assessment|mobile checkpoint|mobile accessibility|mobile curriculum|mobile syllabus|mobile mastery|mobile onboarding|mobile capstone|mobile dialect/,
       use: { ...devices['Pixel 7'] }
     }
   ]
PATCH

git apply --check /tmp/guided-test-fixes.patch
git apply /tmp/guided-test-fixes.patch
rm scripts/materialize-guided-test-fixes-once.sh
git show origin/bonaqu_projects:.github/workflows/quality.yml > .github/workflows/quality.yml
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
git diff --cached --check
git commit -m "Harden mobile guided navigation tests"
git push origin "HEAD:${GITHUB_HEAD_REF}"
