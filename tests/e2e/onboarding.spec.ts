import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { curriculumCheckpoints } from '../../src/data/complete-curriculum';
import { modules, tasks } from '../../src/data/course-catalog';
import { evaluationContractForTask } from '../../src/data/foundation-evaluation-contracts';
import { phaseDefinitions } from '../../src/data/learning-structure';
import { goalModuleRoute, SHARED_FOUNDATION_MODULE_IDS } from '../../src/lib/goal-aware-route';
import type { LearnerGoal } from '../../src/lib/learner-onboarding';
import {
  FOUNDATION_EVIDENCE_CONTRACT_VERSION,
  TASK_EVALUATION_CONTRACT_VERSION
} from '../../src/lib/task-evaluation-types';
import { authenticatePage, loginPage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

const ASSESSMENT_REPORTS_CHANGED_EVENT = 'sql-academy-assessment-reports-changed';

function foundationEvidence(taskId: string) {
  const contract = evaluationContractForTask(taskId);
  return contract ? {
    evidenceContractVersion: FOUNDATION_EVIDENCE_CONTRACT_VERSION,
    evaluationContractId: contract.id,
    evaluationContractVersion: TASK_EVALUATION_CONTRACT_VERSION,
    validatedFixtureIds: contract.fixtures.map(fixture => fixture.id),
    hiddenFixtureIds: contract.fixtures
      .filter(fixture => fixture.visibility !== 'public')
      .map(fixture => fixture.id)
  } : {};
}

function firstRouteDifference(left: readonly string[], right: readonly string[]) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : length;
}

const ANALYST_ROUTE = goalModuleRoute('analyst');
const BACKEND_ROUTE = goalModuleRoute('backend');
const ANALYST_BACKEND_DIVERGENCE = firstRouteDifference(ANALYST_ROUTE, BACKEND_ROUTE);

function diagnosticReport(userId: string) {
  return {
    version: 1,
    id: `onboarding-diagnostic-${Date.now()}`,
    userId,
    mode: 'diagnostic',
    status: 'completed',
    startedAt: '2026-07-25T17:30:00.000Z',
    completedAt: '2026-07-25T18:00:00.000Z',
    durationSeconds: 1200,
    score: 78,
    grade: 'ready',
    accuracy: 78,
    firstAttemptRate: 72,
    independence: 84,
    readinessDelta: 3,
    taskScores: [],
    moduleScores: [
      { module: 'select', title: 'SELECT', score: 92, correct: 1, total: 1 },
      { module: 'filtering', title: 'Фильтрация', score: 84, correct: 1, total: 1 },
      { module: 'joins', title: 'JOIN', score: 58, correct: 0, total: 1 },
      { module: 'windows', title: 'Оконные функции', score: 42, correct: 0, total: 1 }
    ],
    strengths: ['SELECT', 'Фильтрация'],
    weaknesses: ['Оконные функции', 'JOIN'],
    localDebrief: 'Placement fixture for onboarding E2E.'
  };
}

async function openOnboarding(page: Page) {
  await openAdvancedTool(page, 'onboarding-trigger');
}

async function chooseCoreContract(page: Page) {
  const dialog = page.getByTestId('onboarding-portal');
  await dialog.getByRole('button', { name: /SQL для поддержки/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await expect(dialog.getByTestId('onboarding-schedule')).toBeVisible();
  await dialog.getByRole('radio', { name: /25/ }).click();
  await dialog.getByRole('button', { name: 'Вт', exact: true }).click();
  await dialog.getByRole('button', { name: /Устойчивый/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await expect(dialog.getByTestId('onboarding-experience')).toBeVisible();
  const noProgramming = dialog.getByRole('radio', { name: /Без опыта/i });
  await noProgramming.focus();
  await noProgramming.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: /Пишу код иногда/i })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('radio', { name: /Использую время от времени/i }).click();
  await dialog.getByRole('radio', { name: /PostgreSQL/i }).click();
  await dialog.getByRole('radio', { name: /Быстрый маршрут/i }).click();
  const accessibility = await new AxeBuilder({ page })
    .include('[data-testid="onboarding-experience"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await expect(dialog.getByTestId('onboarding-placement')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

async function expectGuidedTodayAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .include('[data-testid="guided-today"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function expectSharedFoundationToday(page: Page, goalLabel: RegExp) {
  const today = page.getByTestId('guided-today');
  await expect(today).toBeVisible();
  await expect(today).toContainText(goalLabel);
  const action = page.getByTestId('guided-journey-action');
  await expect(action).toHaveAttribute('data-route-reason', 'shared-foundation');
  await expect(action).toContainText(/Общая база обязательна|общей баз/i);
  await expectNoHorizontalOverflow(page);
  await expectGuidedTodayAccessible(page);
}

function checkpointForPhase(phaseId: string) {
  const phase = phaseDefinitions.find(item => item.id === phaseId);
  return phase
    ? curriculumCheckpoints.find(checkpoint => checkpoint.moduleIds.some(moduleId => phase.moduleIds.some(id => id === moduleId))) || null
    : null;
}

function advancedFrontierFixture(userId: string, goal: LearnerGoal, prefixLength: number) {
  const route = goalModuleRoute(goal);
  const safePrefixLength = Math.max(SHARED_FOUNDATION_MODULE_IDS.length, Math.min(prefixLength, route.length - 1));
  const strongModuleIds = route.slice(0, safePrefixLength);
  const completedDate = new Date(Date.now() - 5 * 60_000);
  const completedAt = completedDate.toISOString();
  const checkpointStartedAt = new Date(completedDate.getTime() - 10 * 60_000).toISOString();
  const lastStudyDate = completedAt.slice(0, 10);
  const fullyCoveredPhases = phaseDefinitions.filter(phase => phase.moduleIds.every(moduleId => strongModuleIds.includes(moduleId)));
  const checkpointReports = fullyCoveredPhases.flatMap(phase => {
    const checkpoint = checkpointForPhase(phase.id);
    return checkpoint ? [{
      version: 1,
      id: `checkpoint-${goal}-${phase.id}`,
      userId,
      checkpointId: checkpoint.id,
      status: 'completed',
      passed: true,
      score: 100,
      startedAt: checkpointStartedAt,
      completedAt,
      durationSeconds: 600,
      taskResults: []
    }] : [];
  });
  const openedPhaseIds = new Set(fullyCoveredPhases.map(phase => phase.id));
  const transferTasks = tasks.filter(task => {
    if (task.mode !== 'interview' && task.mode !== 'puzzle') return false;
    const phase = phaseDefinitions.find(item => item.moduleIds.some(moduleId => moduleId === task.module));
    return Boolean(phase && openedPhaseIds.has(phase.id) && strongModuleIds.includes(task.module));
  });
  const progress = {
    version: 4,
    completed: transferTasks.map(task => task.id),
    taskStats: Object.fromEntries(transferTasks.map(task => [task.id, {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      solutionViews: 0,
      independentPasses: 1,
      lastIndependentAt: completedAt,
      completedAt,
      lastAttemptAt: completedAt,
      ...foundationEvidence(task.id)
    }])),
    xp: transferTasks.reduce((sum, task) => sum + task.xp, 0),
    streak: 1,
    history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 })),
    lastStudyDate
  };
  const profile = {
    version: 1,
    goal,
    experience: 'advanced',
    dailyMinutes: 25,
    studyDays: ['MO', 'WE', 'FR'],
    pace: 'steady',
    placement: {
      status: 'completed',
      reportId: `advanced-${goal}`,
      score: 95,
      level: 'advanced',
      recommendedTrack: goal === 'analyst' ? 'analytics' : goal === 'backend' ? 'performance' : 'fundamentals',
      strongModuleIds,
      focusModuleIds: [],
      completedAt
    },
    firstWeekPlan: [],
    recoveryRule: 'Resume only the next prerequisite-safe frontier step.',
    completedAt,
    updatedAt: completedAt
  };
  return {
    profile,
    progress,
    checkpointReports,
    expectedModuleId: route[safePrefixLength],
    expectedModuleTitle: modules.find(([moduleId]) => moduleId === route[safePrefixLength])?.[1] || route[safePrefixLength]
  };
}

async function seedAdvancedFrontier(page: Page, userId: string, goal: LearnerGoal, prefixLength: number) {
  const fixture = advancedFrontierFixture(userId, goal, prefixLength);
  await page.goto('./');
  await page.evaluate(({ id, value }) => {
    localStorage.setItem(`sql-academy-onboarding-v1:${id}`, JSON.stringify(value.profile));
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify(value.progress));
    localStorage.setItem(`sql-academy-checkpoint-reports-v1:${id}`, JSON.stringify(value.checkpointReports));
  }, { id: userId, value: fixture });
  await page.reload();
  return fixture;
}

test('desktop onboarding uses executable placement and resumes one shared frontier on a second device', async ({ page, browser }, testInfo) => {
  const auth = await authenticatePage(page, 'onboarding');
  await page.goto('./');
  await openOnboarding(page);
  const dialog = page.getByTestId('onboarding-portal');
  await expect(dialog).toBeVisible();
  await chooseCoreContract(page);

  await dialog.getByTestId('start-placement').click();
  const assessment = page.getByRole('dialog', { name: /Assessment Center/i });
  await expect(assessment).toBeVisible();
  await expect(assessment.getByRole('heading', { name: 'Стартовая диагностика SQL' })).toBeVisible();
  await expect(assessment.getByTestId('assessment-mode-diagnostic')).toContainText('3–7 задач');
  await assessment.getByRole('button', { name: /Закрыть Assessment Center/i }).click();

  const report = diagnosticReport(String(auth.session.userId));
  await page.evaluate(({ userId, value, eventName }) => {
    localStorage.setItem(`sql-academy-assessment-reports-v1:${userId}`, JSON.stringify([value]));
    window.dispatchEvent(new CustomEvent(eventName, { detail: [value] }));
  }, { userId: String(auth.session.userId), value: report, eventName: ASSESSMENT_REPORTS_CHANGED_EVENT });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('onboarding-placement')).toContainText('78%');
  await expect(dialog.getByTestId('onboarding-placement')).toContainText('Поддержка и расследования');
  await expect(dialog.getByTestId('onboarding-placement')).toContainText('Оконные функции');
  await dialog.getByRole('button', { name: /Принять результат/i }).click();
  await expect(dialog.getByTestId('onboarding-plan')).toBeVisible();
  await expect(dialog.locator('.week-plan article')).toHaveCount(4);
  await expect(dialog).toContainText(/Общая база обязательна/i);
  await expect(dialog.getByText('Правило восстановления')).toBeVisible();
  await dialog.getByTestId('complete-onboarding').click();
  await expect(dialog.getByRole('status')).toContainText(/облаке|локально/i);
  const savedPreferences = await page.evaluate(userId => {
    const profile = JSON.parse(localStorage.getItem(`sql-academy-onboarding-v1:${userId}`) || 'null');
    return profile ? { dialect: profile.dialect, routePreference: profile.routePreference, programmingExperience: profile.programmingExperience } : null;
  }, String(auth.session.userId));
  expect(savedPreferences).toEqual({ dialect: 'postgresql', routePreference: 'fast', programmingExperience: 'some' });
  await page.screenshot({ path: testInfo.outputPath('desktop-onboarding-plan.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Закрыть стартовый план' }).click();

  await expect(page.getByTestId('onboarding-trigger')).toContainText('Мой учебный план');
  await expectSharedFoundationToday(page, /SQL для поддержки/i);
  await expect(page.getByTestId('guided-session-budget')).toContainText(/Новое|Повторение|Восстановление|Перенос/);
  await expect(page.getByTestId('guided-session-budget')).toContainText(/Почему|обязательна|цели/i);
  await page.reload();
  await expectSharedFoundationToday(page, /SQL для поддержки/i);
  await page.screenshot({ path: testInfo.outputPath('desktop-goal-aware-today.png'), fullPage: true });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginPage(secondPage, auth.username, auth.password);
  await secondPage.goto('./');
  await secondPage.waitForTimeout(1200);
  await openOnboarding(secondPage);
  const secondDialog = secondPage.getByTestId('onboarding-portal');
  await expect(secondDialog.getByTestId('onboarding-plan')).toBeVisible();
  await expect(secondDialog).toContainText('SQL для поддержки');
  await expect(secondDialog.locator('.week-plan article')).toHaveCount(4);
  await secondDialog.getByRole('button', { name: 'Закрыть стартовый план' }).click();
  await expectSharedFoundationToday(secondPage, /SQL для поддержки/i);
  await secondContext.close();
});

test('desktop onboarding advanced analyst and backend evidence resume different goal-priority frontiers', async ({ page, browser }, testInfo) => {
  expect(ANALYST_BACKEND_DIVERGENCE).toBeGreaterThanOrEqual(SHARED_FOUNDATION_MODULE_IDS.length);
  expect(ANALYST_ROUTE[ANALYST_BACKEND_DIVERGENCE]).not.toBe(BACKEND_ROUTE[ANALYST_BACKEND_DIVERGENCE]);

  const analystAuth = await authenticatePage(page, 'advancedanalyst');
  const analyst = await seedAdvancedFrontier(
    page,
    String(analystAuth.session.userId),
    'analyst',
    ANALYST_BACKEND_DIVERGENCE
  );
  const analystAction = page.getByTestId('guided-journey-action');
  await expect(analystAction).toHaveAttribute('data-route-reason', 'goal-priority');
  await expect(analystAction).toContainText(analyst.expectedModuleTitle);
  await expect(page.getByTestId('guided-today')).toContainText(/Аналитика/i);
  await expectGuidedTodayAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-analyst-frontier.png'), fullPage: true });

  const backendContext = await browser.newContext();
  const backendPage = await backendContext.newPage();
  const backendAuth = await authenticatePage(backendPage, 'advancedbackend');
  const backend = await seedAdvancedFrontier(
    backendPage,
    String(backendAuth.session.userId),
    'backend',
    ANALYST_BACKEND_DIVERGENCE
  );
  const backendAction = backendPage.getByTestId('guided-journey-action');
  await expect(backendAction).toHaveAttribute('data-route-reason', 'goal-priority');
  await expect(backendAction).toContainText(backend.expectedModuleTitle);
  await expect(backendPage.getByTestId('guided-today')).toContainText(/SQL для бэкенда/i);
  expect(backend.expectedModuleId).not.toBe(analyst.expectedModuleId);
  await expectNoHorizontalOverflow(backendPage);
  await backendPage.screenshot({ path: testInfo.outputPath('desktop-backend-frontier.png'), fullPage: true });
  await backendContext.close();
});

test('mobile onboarding deferred placement starts from zero and keeps the shared goal frontier accessible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await authenticatePage(page, 'mobileonboarding');
  await page.goto('./');
  await openOnboarding(page);
  const dialog = page.getByTestId('onboarding-portal');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: /Полная академия/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await dialog.getByRole('radio', { name: /15/ }).click();
  await dialog.getByRole('button', { name: /Мягкий/i }).click();
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await dialog.getByRole('radio', { name: /Без опыта/i }).click();
  await dialog.getByRole('radio', { name: /С нуля/i }).click();
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: /Продолжить/i }).click();
  await dialog.getByTestId('defer-placement').click();

  await expect(dialog.getByTestId('onboarding-plan')).toBeVisible();
  await expect(dialog).toContainText('базового уровня');
  await expect(dialog).toContainText(/Общая база обязательна/i);
  await expect(dialog.locator('.week-plan article')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await dialog.getByTestId('complete-onboarding').click();
  await dialog.getByRole('button', { name: 'Закрыть стартовый план' }).click();
  await expectSharedFoundationToday(page, /Полная академия/i);
  await page.reload();
  await expectSharedFoundationToday(page, /Полная академия/i);
  await page.screenshot({ path: testInfo.outputPath('mobile-goal-aware-today.png'), fullPage: true });
});
