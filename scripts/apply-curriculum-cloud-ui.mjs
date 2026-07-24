import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, before, after, label) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  writeFileSync(path, source.replace(before, after));
}

patch(
  'src/components/CurriculumPortal.tsx',
  "import { createPortal } from 'react-dom';\n",
  "import { createPortal } from 'react-dom';\nimport CurriculumSyncButton from './CurriculumSyncButton';\n",
  'Curriculum sync button import'
);
patch(
  'src/components/CurriculumPortal.tsx',
  '      <div className="curriculum-top-actions"><span><strong>{completion}%</strong><small>curriculum</small></span><button data-autofocus onClick={close} aria-label="Закрыть Curriculum Studio"><X /></button></div>',
  '      <div className="curriculum-top-actions"><CurriculumSyncButton onProgress={setProgress} /><span><strong>{completion}%</strong><small>curriculum</small></span><button data-autofocus onClick={close} aria-label="Закрыть Curriculum Studio"><X /></button></div>',
  'Curriculum sync button placement'
);

const cssPath = 'src/styles-curriculum.css';
const css = readFileSync(cssPath, 'utf8');
const marker = '@media (max-width: 980px) {';
const addition = `.curriculum-top-actions > .curriculum-sync-button {
  width: auto;
  min-width: 7.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .42rem;
  padding: .5rem .7rem;
  color: #d4d4d8;
  font: inherit;
  font-size: .7rem;
  font-weight: 850;
}
.curriculum-top-actions > .curriculum-sync-button svg { width: 1rem; }
.curriculum-top-actions > .curriculum-sync-button.synced { border-color: rgb(52 211 153 / 28%); color: #6ee7b7; }
.curriculum-top-actions > .curriculum-sync-button.offline { color: #fbbf24; }
.curriculum-top-actions > .curriculum-sync-button.error { border-color: rgb(244 63 94 / 30%); color: #fda4af; }
.curriculum-top-actions > .curriculum-sync-button:disabled { cursor: wait; opacity: .72; }

`;
const markerCount = css.split(marker).length - 1;
if (markerCount !== 1) throw new Error(`Curriculum sync CSS marker: expected 1, found ${markerCount}`);
writeFileSync(cssPath, css.replace(marker, `${addition}${marker}`));

patch(
  'tests/e2e/curriculum.spec.ts',
  "import { authenticatePage } from './auth-helper';",
  "import { authenticatePage, loginPage } from './auth-helper';",
  'Curriculum test login helper'
);
patch(
  'tests/e2e/curriculum.spec.ts',
  "test('desktop curriculum studio completes a lesson and persists project draft', async ({ page }, testInfo) => {\n  await authenticatePage(page, 'curriculum');",
  "test('desktop curriculum studio completes a lesson and syncs project draft across devices', async ({ page, browser }, testInfo) => {\n  const auth = await authenticatePage(page, 'curriculum');",
  'Curriculum desktop test signature'
);
patch(
  'tests/e2e/curriculum.spec.ts',
  "  await page.getByTestId('complete-project').click();\n  await expect(page.getByText('Проект завершён')).toBeVisible();\n\n  await expectNoSeriousAxeViolations(page);",
  "  await page.getByTestId('complete-project').click();\n  await expect(page.getByText('Проект завершён')).toBeVisible();\n  await page.getByTestId('curriculum-sync').click();\n  await expect(page.getByTestId('curriculum-sync')).toContainText('В облаке');\n\n  await expectNoSeriousAxeViolations(page);",
  'Curriculum explicit cloud sync'
);
patch(
  'tests/e2e/curriculum.spec.ts',
  "  await page.getByRole('button', { name: 'Закрыть Curriculum Studio' }).click();\n  await expect(trigger).toBeFocused();\n  await page.reload();\n  await page.getByTestId('curriculum-trigger').click();\n  await page.getByRole('tab', { name: /Project Lab/i }).click();\n  await expect(page.getByTestId('project-sql-draft')).toHaveValue(/WITH base/);",
  "  await page.getByRole('button', { name: 'Закрыть Curriculum Studio' }).click();\n  await expect(trigger).toBeFocused();\n\n  const secondContext = await browser.newContext();\n  const secondPage = await secondContext.newPage();\n  await loginPage(secondPage, auth.username, auth.password);\n  await secondPage.goto('./');\n  await secondPage.getByTestId('curriculum-trigger').click();\n  await secondPage.getByRole('tab', { name: /Project Lab/i }).click();\n  await expect(secondPage.getByTestId('project-sql-draft')).toHaveValue(/WITH base/);\n  await expect(secondPage.getByText('Проект завершён')).toBeVisible();\n  await secondContext.close();",
  'Curriculum cross-device assertion'
);

patch(
  'scripts/validate-curriculum.ts',
  "import { createRequire } from 'node:module';\n",
  "import { createRequire } from 'node:module';\nimport { readFileSync } from 'node:fs';\n",
  'Curriculum migration validator import'
);
patch(
  'scripts/validate-curriculum.ts',
  "const errors: string[] = [];\n",
  "const errors: string[] = [];\nconst curriculumMigration = readFileSync(new URL('../migrations/0010_curriculum_progress.sql', import.meta.url), 'utf8');\n",
  'Curriculum migration read'
);
patch(
  'scripts/validate-curriculum.ts',
  "assert(curriculumLessons.length === modules.length, `Expected ${modules.length} lessons, got ${curriculumLessons.length}`);",
  "assert(curriculumMigration.includes('CREATE TABLE IF NOT EXISTS curriculum_progress'), 'Curriculum D1 migration must create curriculum_progress');\nassert(curriculumMigration.includes('REFERENCES users(user_id) ON DELETE CASCADE'), 'Curriculum progress must cascade with the authenticated user');\nassert(curriculumLessons.length === modules.length, `Expected ${modules.length} lessons, got ${curriculumLessons.length}`);",
  'Curriculum migration assertions'
);

console.log('Curriculum cloud UI patch applied.');
