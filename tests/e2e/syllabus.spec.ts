import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { evaluationContractForTask } from '../../src/data/foundation-evaluation-contracts';
import {
  FOUNDATION_EVIDENCE_CONTRACT_VERSION,
  TASK_EVALUATION_CONTRACT_VERSION
} from '../../src/lib/task-evaluation-types';
import { authenticatePage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

const PROGRESS_KEY = 'sql-academy-progress-v4';

function oneTopicEvidence() {
  const contract = evaluationContractForTask('task-001');
  if (!contract) throw new Error('Expected a foundation evaluation contract for task-001.');
  return {
    version: 4,
    completed: ['task-001'],
    taskStats: {
      'task-001': {
        attempts: 1,
        incorrect: 0,
        hintsUsed: 0,
        independentPasses: 1,
        lastIndependentAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:00.000Z',
        lastAttemptAt: '2026-01-01T00:00:00.000Z',
        evidenceContractVersion: FOUNDATION_EVIDENCE_CONTRACT_VERSION,
        evaluationContractId: contract.id,
        evaluationContractVersion: TASK_EVALUATION_CONTRACT_VERSION,
        validatedFixtureIds: contract.fixtures.map(fixture => fixture.id),
        hiddenFixtureIds: contract.fixtures
          .filter(fixture => fixture.visibility !== 'public')
          .map(fixture => fixture.id)
      }
    },
    xp: 60,
    streak: 1,
    history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 })),
    lastTask: 'task-001',
    lastStudyDate: '2026-01-01'
  };
}

async function seedOneTopic(page: import('@playwright/test').Page) {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: PROGRESS_KEY,
    value: oneTopicEvidence()
  });
}

async function expectAccessible(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

test('desktop syllabus exposes tracks evidence-gated review tools executable dialects and graded exams', async ({ page }, testInfo) => {
  await authenticatePage(page, 'syllabus');
  await seedOneTopic(page);
  await page.goto('./');
  await openAdvancedTool(page, 'syllabus-trigger');

  const dialog = page.getByRole('dialog', { name: /SQL Syllabus Center/i });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('syllabus-map')).toBeVisible();
  await expect(page.getByRole('button', { name: /SQL Fundamentals/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Модули маршрута' })).toBeVisible();

  await page.getByRole('tab', { name: /Повторение/i }).click();
  const review = page.getByTestId('spaced-review');
  await expect(review).toBeVisible();
  await expect(review).toContainText('1');
  await expect(review).toContainText('открыто по evidence');
  await expect(review).toContainText('31');
  await expect(review).toContainText('тем ещё не изучено');
  await expect(review).toContainText('independent SQL evidence');
  await page.getByTestId('reveal-review-answer').click();
  await expect(page.locator('.review-answer')).toBeVisible();
  await page.getByTestId('review-grade-good').click();
  await expect(page.locator('.review-empty')).toContainText('Карточки на сегодня закончились');

  await page.getByRole('tab', { name: /Инструменты/i }).click();
  await expect(page.getByTestId('learning-tools')).toBeVisible();
  await expect(page.getByTestId('schema-explorer')).toBeVisible();
  await page.getByRole('button', { name: /ticket_events/i }).click();
  await expect(page.getByRole('heading', { name: 'ticket_events' })).toBeVisible();
  await page.getByRole('tab', { name: 'Errors' }).click();
  await expect(page.getByTestId('error-atlas')).toBeVisible();
  await page.getByRole('tab', { name: /Performance/i }).click();
  await expect(page.getByRole('heading', { name: /Полный scan вместо индекса/i })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('tab', { name: /Диалекты/i }).click();
  const dialectLab = page.getByTestId('dialect-executable-lab');
  await expect(dialectLab).toBeVisible();
  await expect(page.getByRole('heading', { name: 'NULL ordering across engines' })).toBeVisible();
  await expect(page.getByRole('button', { name: /SQLite Local WASM/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /PostgreSQL Server contract/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /MySQL Server contract/i })).toBeVisible();
  await expect(page.locator('.dialect-free-boundary')).toContainText('Cloudflare Free boundary');
  await page.getByText(/Reference-only syntax matrix/i).click();
  await expect(page.locator('.dialect-reference-matrix article').filter({ hasText: 'SQL Server' })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('tab', { name: /Экзамены/i }).click();
  await expect(page.getByTestId('syllabus-exams')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Diagnostic SQL Check' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Production SQL Exam' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SQL Academy Final' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Сначала prerequisites/i }).first()).toBeDisabled();

  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('syllabus-center-desktop.png'), fullPage: true });
});

test('mobile syllabus and executable dialect lab remain usable without overflow', async ({ page }, testInfo) => {
  await authenticatePage(page, 'syllabusmobile');
  await seedOneTopic(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await openAdvancedTool(page, 'syllabus-trigger');

  await expect(page.getByRole('dialog', { name: /SQL Syllabus Center/i })).toBeVisible();
  await page.getByRole('tab', { name: /Повторение/i }).click();
  await expect(page.getByTestId('spaced-review')).toBeVisible();
  await expect(page.getByTestId('spaced-review')).toContainText('31');
  await page.getByTestId('reveal-review-answer').click();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: /Инструменты/i }).click();
  await page.getByRole('tab', { name: 'Errors' }).click();
  await expect(page.getByTestId('error-atlas')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: /Диалекты/i }).click();
  await expect(page.getByTestId('dialect-executable-lab')).toBeVisible();
  await expect(page.locator('.dialect-free-boundary')).toBeVisible();
  await expect(page.getByTestId('dialect-evidence-card')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('syllabus-dialect-mobile.png'), fullPage: true });
});
