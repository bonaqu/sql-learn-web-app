import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { curriculumCheckpoints } from '../../src/data/complete-curriculum';
import { modules } from '../../src/data/course-catalog';
import { phaseDefinitions } from '../../src/data/learning-structure';
import { goalModuleRoute } from '../../src/lib/goal-aware-route';
import type { LearnerGoal } from '../../src/lib/learner-onboarding';
import { authenticatePage, loginPage } from './auth-helper';

const expectNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
};

function firstDifference(left: readonly string[], right: readonly string[]) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : length;
}

function moduleTitle(moduleId: string) {
  return modules.find(([id]) => id === moduleId)?.[1] || moduleId;
}

function checkpointForPhase(phaseId: string) {
  const phase = phaseDefinitions.find(item => item.id === phaseId);
  return phase
    ? curriculumCheckpoints.find(checkpoint => checkpoint.moduleIds.some(moduleId => phase.moduleIds.includes(moduleId))) || null
    : null;
}

function goalSwitchFixture(userId: string, currentGoal: LearnerGoal, proposedGoal: LearnerGoal) {
  const currentRoute = goalModuleRoute(currentGoal);
  const proposedRoute = goalModuleRoute(proposedGoal);
  const divergence = firstDifference(currentRoute, proposedRoute);
  if (divergence < 0) throw new Error(`${currentGoal} and ${proposedGoal} do not diverge.`);
  const strongModuleIds = currentRoute.slice(0, divergence);
  const fullyCoveredPhases = phaseDefinitions.filter(phase =>
    phase.moduleIds.every(moduleId => strongModuleIds.includes(moduleId))
  );
  const now = new Date().toISOString();
  return {
    profile: {
      version: 1,
      goal: currentGoal,
      experience: 'advanced',
      programmingExperience: 'professional',
      priorSqlExperience: 'work',
      dialect: 'postgresql',
      routePreference: 'full',
      dailyMinutes: 25,
      studyDays: ['MO', 'WE', 'FR'],
      pace: 'steady',
      placement: {
        status: 'completed',
        reportId: `goal-switch-${currentGoal}`,
        score: 95,
        level: 'advanced',
        recommendedTrack: currentGoal === 'analyst' ? 'analytics' : 'performance',
        strongModuleIds,
        focusModuleIds: ['filtering'],
        confidenceLow: 88,
        confidenceHigh: 100,
        decisionReason: 'Validated goal-switch browser fixture.',
        diagnosticTaskCount: 7,
        completedAt: now
      },
      firstWeekPlan: [],
      recoveryRule: 'Resume only the next prerequisite-safe frontier step.',
      completedAt: now,
      updatedAt: now
    },
    progress: {
      version: 4,
      completed: [],
      taskStats: {},
      xp: 0,
      streak: 0,
      history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }))
    },
    checkpointReports: fullyCoveredPhases.flatMap(phase => {
      const checkpoint = checkpointForPhase(phase.id);
      return checkpoint ? [{
        version: 1,
        id: `goal-switch-${phase.id}`,
        userId,
        checkpointId: checkpoint.id,
        status: 'completed',
        passed: true,
        score: 100,
        startedAt: now,
        completedAt: now,
        durationSeconds: 300,
        attemptNumber: 1,
        bestScore: 100,
        passingScore: checkpoint.passingScore,
        accuracy: 100,
        firstAttemptRate: 100,
        independence: 100,
        taskScores: [],
        moduleScores: phase.moduleIds.map(module => ({ module, title: moduleTitle(module), score: 100, correct: 1, total: 1 })),
        remediationModules: []
      }] : [];
    }),
    currentModuleId: currentRoute[divergence],
    proposedModuleId: proposedRoute[divergence],
    currentModuleTitle: moduleTitle(currentRoute[divergence]),
    proposedModuleTitle: moduleTitle(proposedRoute[divergence])
  };
}

async function seedGoalSwitch(page: Page, userId: string, currentGoal: LearnerGoal, proposedGoal: LearnerGoal) {
  const fixture = goalSwitchFixture(userId, currentGoal, proposedGoal);
  await page.goto('./');
  await page.evaluate(({ id, value }) => {
    localStorage.setItem(`sql-academy-onboarding-v1:${id}`, JSON.stringify(value.profile));
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify(value.progress));
    localStorage.setItem(`sql-academy-checkpoint-reports-v1:${id}`, JSON.stringify(value.checkpointReports));
  }, { id: userId, value: fixture });
  await page.reload();
  return fixture;
}

async function expectGoalSwitchAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .include('[data-testid="goal-switch-panel"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test('desktop adaptive learning path shares the canonical beginner frontier and readiness evidence', async ({ page }, testInfo) => {
  await authenticatePage(page, 'desktop-path');
  await page.route('**/api/mentor', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answer: 'Персональный план\n• Разбери модель темы\n• Выполни связанную практику\n• Заверши контрольным этапом' })
    });
  });

  await page.goto('./');
  await page.getByTestId('learning-path-trigger').click();
  const learningPath = page.getByTestId('learning-path');
  await expect(learningPath).toBeVisible();
  await expect(learningPath.locator('.path-brand')).toContainText('Адаптивный учебный маршрут');
  await expect(learningPath.getByRole('heading', { name: /Доказуемый путь к рабочему SQL/ })).toBeVisible();
  await expect(learningPath.locator('.readiness-ring')).toContainText('готовность по результатам');
  await expect(learningPath.locator('.path-metrics')).toContainText('Контрольные этапы');
  await expect(learningPath.locator('.phase-card')).toHaveCount(8);
  const sessionItems = learningPath.locator('.session-list > button');
  const sessionCount = await sessionItems.count();
  expect(sessionCount).toBeGreaterThanOrEqual(1);
  expect(sessionCount).toBeLessThanOrEqual(3);
  await expect(sessionItems.first()).toHaveAttribute('data-stage', 'lesson');
  await expect(sessionItems.first()).toContainText(/Мысленная модель и проверка понимания/i);
  await expect(sessionItems.first()).toContainText(/SQL-мышление/i);
  await expect(learningPath.locator('.readiness-ring strong')).toHaveText('0%');

  await learningPath.getByRole('button', { name: 'AI-план', exact: true }).click();
  await expect(learningPath.locator('.path-ai-answer')).toContainText('Персональный план');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-learning-path.png') });

  await learningPath.locator('.roadmap-section').scrollIntoViewIfNeeded();
  await expect(learningPath.getByRole('heading', { name: 'Карта навыков и результатов' })).toBeVisible();
  await expect(learningPath.getByTestId('goal-route-legend')).toContainText('обязательные темы пройдены');
  await expect(learningPath.getByTestId('goal-route-legend')).not.toContainText(/prerequisite|evidence|locked/i);
  expect(await learningPath.locator('.module-node').count()).toBeGreaterThanOrEqual(6);

  const explainer = learningPath.getByTestId('readiness-explainer');
  await expect(explainer).toBeVisible();
  await explainer.getByRole('button', { name: /Как считается готовность/i }).click();
  await expect(explainer.getByText(/Просроченные и прерванные попытки/)).toBeVisible();
  await expect(explainer.locator('.readiness-evidence-grid article')).toHaveCount(5);
  await expect(explainer.getByText(/вес 55/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-readiness-explainer.png') });

  await sessionItems.first().click();
  await expect(learningPath).toBeHidden();
  const curriculum = page.getByTestId('curriculum-studio');
  await expect(curriculum).toBeVisible();
  await expect(curriculum.getByText('Урок 01 / 44')).toBeVisible();
  await expect(curriculum.getByRole('heading', { name: 'SQL-мышление', exact: true })).toBeVisible();
  await expect(curriculum).toContainText(/Как читать схему и превращать вопрос в запрос/i);
});

test('desktop goal preview cancels without writes and applies only future Analyst to Backend choices', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'goal-switch');
  const fixture = await seedGoalSwitch(page, String(auth.session.userId), 'analyst', 'backend');
  expect(fixture.currentModuleId).not.toBe(fixture.proposedModuleId);

  await page.evaluate(() => {
    (window as Window & { __goalSwitchEvents?: number }).__goalSwitchEvents = 0;
    window.addEventListener('sql-academy-onboarding-changed', () => {
      const target = window as Window & { __goalSwitchEvents?: number };
      target.__goalSwitchEvents = (target.__goalSwitchEvents || 0) + 1;
    });
  });
  const before = await page.evaluate(id => localStorage.getItem(`sql-academy-onboarding-v1:${id}`), String(auth.session.userId));
  const placementBefore = JSON.parse(before || '{}').placement;

  await page.getByTestId('learning-path-trigger').click();
  const learningPath = page.getByTestId('learning-path');
  await expect(learningPath.locator('.session-list > button').first()).toContainText(fixture.currentModuleTitle);
  await learningPath.getByTestId('goal-switch-trigger').click();
  const panel = learningPath.getByTestId('goal-switch-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('goal-switch-option-data-engineering')).toContainText(/Data engineering/i);
  await panel.getByTestId('goal-switch-option-backend').click();
  await expect(panel.getByTestId('goal-switch-current-action')).toContainText(fixture.currentModuleTitle);
  await expect(panel.getByTestId('goal-switch-proposed-action')).toContainText(fixture.proposedModuleTitle);
  await expect(panel.getByTestId('goal-switch-impact')).toContainText(/Следующий шаг изменится/i);
  await expectGoalSwitchAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-goal-switch-preview.png'), fullPage: true });

  await panel.getByTestId('goal-switch-cancel').click();
  await expect(panel).toBeHidden();
  const afterCancel = await page.evaluate(id => localStorage.getItem(`sql-academy-onboarding-v1:${id}`), String(auth.session.userId));
  expect(afterCancel).toBe(before);
  expect(await page.evaluate(() => (window as Window & { __goalSwitchEvents?: number }).__goalSwitchEvents || 0)).toBe(0);

  await learningPath.getByTestId('goal-switch-trigger').click();
  await learningPath.getByTestId('goal-switch-option-backend').click();
  await learningPath.getByTestId('goal-switch-apply').click();
  await expect(learningPath.getByRole('status')).toContainText(/сохранена|изменена|синхрониз/i);
  await expect.poll(async () => page.evaluate(id => {
    const raw = localStorage.getItem(`sql-academy-onboarding-v1:${id}`);
    return raw ? JSON.parse(raw).goal : null;
  }, String(auth.session.userId))).toBe('backend');
  const afterApply = await page.evaluate(id => JSON.parse(localStorage.getItem(`sql-academy-onboarding-v1:${id}`) || '{}'), String(auth.session.userId));
  expect(afterApply.placement).toEqual(placementBefore);
  expect(afterApply.completedAt).toBe(JSON.parse(before || '{}').completedAt);
  expect(await page.evaluate(() => (window as Window & { __goalSwitchEvents?: number }).__goalSwitchEvents || 0)).toBe(1);

  await learningPath.getByTestId('goal-switch-cancel').click();
  await expect(learningPath.locator('.session-list > button').first()).toContainText(fixture.proposedModuleTitle);
  await page.reload();
  await page.getByTestId('learning-path-trigger').click();
  await expect(page.getByTestId('learning-path').locator('.session-list > button').first()).toContainText(fixture.proposedModuleTitle);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username, auth.password);
  await secondPage.goto('./');
  await secondPage.waitForTimeout(1200);
  await secondPage.getByTestId('learning-path-trigger').click();
  await expect(secondPage.getByTestId('learning-path').locator('.roadmap-heading .path-eyebrow')).toContainText(/SQL для бэкенда/i);
  await expect(secondPage.getByTestId('learning-path').locator('.session-list > button').first()).toContainText(/Checkpoint · Надёжная база/i);
  await secondContext.close();
});

test('mobile adaptive learning path keeps the same lesson frontier and readiness explanation responsive', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobile-path');
  await page.goto('./');
  await page.getByTestId('learning-path-mobile-trigger').click();
  const learningPath = page.getByTestId('learning-path');
  await expect(learningPath).toBeVisible();
  await expect(learningPath.locator('.readiness-ring')).toBeVisible();
  await expect(learningPath.locator('.phase-card')).toHaveCount(8);
  const firstSessionItem = learningPath.locator('.session-list > button').first();
  await expect(firstSessionItem).toBeVisible();
  await expect(firstSessionItem).toHaveAttribute('data-stage', 'lesson');
  await expect(firstSessionItem).toContainText(/SQL-мышление/i);

  await learningPath.locator('.path-top-actions select').selectOption('15');
  await expect(learningPath.getByRole('heading', { name: /Сессия на/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-learning-path.png') });

  await learningPath.locator('.roadmap-section').scrollIntoViewIfNeeded();
  await expect(learningPath.getByRole('heading', { name: 'Карта навыков и результатов' })).toBeVisible();
  const explainer = learningPath.getByTestId('readiness-explainer');
  await explainer.getByRole('button', { name: /Как считается готовность/i }).click();
  await expect(explainer.locator('.readiness-evidence-grid article')).toHaveCount(5);
  await expect(explainer.getByText(/Неприменимый итоговый проект/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-readiness-explainer.png'), fullPage: true });

  await learningPath.getByRole('button', { name: 'Закрыть учебный путь' }).click();
  await expect(learningPath).toBeHidden();
});

test('mobile goal preview is accessible, responsive and cancel-only', async ({ page }, testInfo) => {
  const auth = await authenticatePage(page, 'mobile-goal-switch');
  const fixture = await seedGoalSwitch(page, String(auth.session.userId), 'analyst', 'backend');
  const before = await page.evaluate(id => localStorage.getItem(`sql-academy-onboarding-v1:${id}`), String(auth.session.userId));

  await page.getByTestId('learning-path-mobile-trigger').click();
  const learningPath = page.getByTestId('learning-path');
  await learningPath.getByTestId('goal-switch-trigger').click();
  const panel = learningPath.getByTestId('goal-switch-panel');
  await panel.getByTestId('goal-switch-option-backend').click();
  await expect(panel.getByTestId('goal-switch-proposed-action')).toContainText(fixture.proposedModuleTitle);
  await expectGoalSwitchAccessible(page);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-goal-switch-preview.png'), fullPage: true });

  await panel.getByTestId('goal-switch-cancel').click();
  await expect(panel).toBeHidden();
  const after = await page.evaluate(id => localStorage.getItem(`sql-academy-onboarding-v1:${id}`), String(auth.session.userId));
  expect(after).toBe(before);
});
