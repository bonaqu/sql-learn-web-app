import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { checkpointTaskById } from '../../src/data/checkpoint-task-bank';
import { curriculumCheckpoints, curriculumLessons } from '../../src/data/complete-curriculum';
import { tasks } from '../../src/data/course-catalog';
import { evaluationContractForTask } from '../../src/data/foundation-evaluation-contracts';
import { lessonChecks } from '../../src/data/lesson-checks';
import { phaseDefinitions } from '../../src/data/learning-structure';
import { checkpointRemediationsFromReports } from '../../src/lib/checkpoint-remediation';
import { foundationTasksForModule } from '../../src/lib/learning-journey';
import {
  FOUNDATION_EVIDENCE_CONTRACT_VERSION,
  TASK_EVALUATION_CONTRACT_VERSION
} from '../../src/lib/task-evaluation-types';
import { authenticatePage } from './auth-helper';

const CHECKPOINT_EVENT = 'sql-academy-checkpoint-reports-changed';
const PROGRESS_EVENT = 'sql-academy-progress-changed';

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

function phaseCheckpointFixture() {
  const result = phaseDefinitions.flatMap((phase, phaseIndex) => {
    const phaseModules = new Set<string>(phase.moduleIds);
    const checkpointIndex = curriculumCheckpoints.findIndex(item => {
      const checkpointModules = new Set<string>(item.moduleIds);
      return checkpointModules.size === phaseModules.size
        && phase.moduleIds.every(moduleId => checkpointModules.has(moduleId));
    });
    const checkpoint = checkpointIndex >= 0 ? curriculumCheckpoints[checkpointIndex] : null;
    return checkpoint ? [{ phase, phaseIndex, checkpoint, checkpointIndex }] : [];
  })[0];
  if (!result) throw new Error('Expected one checkpoint covering a complete canonical phase.');
  return result;
}

function checkpointReport(
  userId: string,
  checkpoint: typeof curriculumCheckpoints[number],
  id: string,
  completedAt: string,
  attemptNumber: number
) {
  const score = Math.min(100, checkpoint.passingScore + 10);
  return {
    version: 1,
    id,
    userId,
    checkpointId: checkpoint.id,
    status: 'completed',
    startedAt: new Date(Date.parse(completedAt) - 300_000).toISOString(),
    completedAt,
    durationSeconds: 300,
    attemptNumber,
    score,
    bestScore: score,
    passingScore: checkpoint.passingScore,
    passed: true,
    accuracy: 100,
    firstAttemptRate: 100,
    independence: 100,
    taskScores: checkpoint.taskIds.map(taskId => {
      const task = checkpointTaskById(taskId) || tasks.find(item => item.id === taskId);
      return {
        taskId,
        title: task?.title || taskId,
        module: task?.module || checkpoint.moduleIds[0],
        correct: true,
        skipped: false,
        attempts: 1,
        elapsedSeconds: 60,
        score
      };
    }),
    moduleScores: checkpoint.moduleIds.map(module => ({
      module,
      title: module,
      score,
      correct: 1,
      total: 1
    })),
    remediationModules: []
  };
}

function fixture(userId: string) {
  const { phase, phaseIndex, checkpoint, checkpointIndex } = phaseCheckpointFixture();
  const checkpointModules = new Set<string>(checkpoint.moduleIds);
  const prerequisiteModuleIds = phaseDefinitions
    .slice(0, phaseIndex + 1)
    .flatMap(item => [...item.moduleIds]);
  const prerequisiteModuleSet = new Set<string>(prerequisiteModuleIds);
  const prerequisiteLessons = curriculumLessons.filter(lesson => prerequisiteModuleSet.has(lesson.module));
  const foundationTasks = prerequisiteModuleIds.flatMap(moduleId => foundationTasksForModule(moduleId));
  const failedAt = new Date(Date.now() - 45_000).toISOString();
  const beforeFailure = new Date(Date.parse(failedAt) - 60_000).toISOString();
  const weakTasks = checkpoint.taskIds.flatMap(taskId => {
    const task = checkpointTaskById(taskId) || tasks.find(item => item.id === taskId);
    return task ? [task] : [];
  });
  const weakModules = Array.from(new Set(weakTasks.map(task => task.module))).slice(0, 1);
  const weakModuleSet = new Set<string>(weakModules);
  const targetedTasks = weakTasks.filter(task => weakModuleSet.has(task.module));
  const taskStats = Object.fromEntries(foundationTasks.map(task => [task.id, {
    attempts: 1,
    incorrect: 0,
    hintsUsed: 0,
    solutionViews: 0,
    independentPasses: 1,
    lastIndependentAt: beforeFailure,
    completedAt: beforeFailure,
    lastAttemptAt: beforeFailure,
    ...foundationEvidence(task.id)
  }]));
  const progress = {
    version: 4,
    completed: foundationTasks.map(task => task.id),
    taskStats,
    xp: foundationTasks.reduce((sum, task) => sum + task.xp, 0),
    streak: 1,
    history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 })),
    lastStudyDate: failedAt.slice(0, 10)
  };
  const curriculum = {
    version: 1,
    completedSections: prerequisiteLessons.flatMap(lesson => lesson.sections.map(section => section.id)),
    completedLessons: prerequisiteLessons.map(lesson => lesson.id),
    completedProjects: [],
    answers: Object.fromEntries(prerequisiteLessons.flatMap(lesson => lessonChecks(lesson).map(check => [check.id, {
      optionIndex: check.correctIndex,
      correct: true,
      answeredAt: beforeFailure
    }]))),
    projectDrafts: {},
    bookmark: null,
    updatedAt: beforeFailure
  };
  const profile = {
    version: 1,
    goal: 'analyst',
    experience: 'advanced',
    dailyMinutes: 25,
    studyDays: ['MO', 'WE', 'FR'],
    pace: 'steady',
    placement: {
      status: 'completed',
      reportId: 'checkpoint-remediation-placement',
      score: 95,
      level: 'advanced',
      recommendedTrack: 'analytics',
      strongModuleIds: [...prerequisiteModuleIds],
      focusModuleIds: [],
      completedAt: beforeFailure
    },
    firstWeekPlan: [],
    recoveryRule: 'Resume only the next prerequisite-safe frontier step.',
    completedAt: beforeFailure,
    updatedAt: beforeFailure
  };
  const failedReport = {
    version: 1,
    id: 'checkpoint-remediation-failed',
    userId,
    checkpointId: checkpoint.id,
    status: 'completed',
    startedAt: new Date(Date.parse(failedAt) - 300_000).toISOString(),
    completedAt: failedAt,
    durationSeconds: 300,
    attemptNumber: 2,
    score: 52,
    bestScore: 68,
    passingScore: checkpoint.passingScore,
    passed: false,
    accuracy: 50,
    firstAttemptRate: 40,
    independence: 60,
    taskScores: targetedTasks.map((task, index) => ({
      taskId: task.id,
      title: task.title,
      module: task.module,
      correct: false,
      skipped: index === 0,
      attempts: 2,
      elapsedSeconds: 90,
      score: 25 + index * 8
    })),
    moduleScores: weakModules.map((module, index) => ({
      module,
      title: module,
      score: 32 + index * 18,
      correct: 0,
      total: 1
    })),
    remediationModules: [...weakModules]
  };
  const priorPassedReports = curriculumCheckpoints
    .slice(0, checkpointIndex)
    .map((item, index) => checkpointReport(
      userId,
      item,
      `checkpoint-remediation-prior-${item.id}`,
      new Date(Date.parse(beforeFailure) - (checkpointIndex - index) * 120_000).toISOString(),
      1
    ));
  const remediation = checkpointRemediationsFromReports([failedReport], userId)[0];
  if (!remediation?.modules.length) throw new Error('Expected failed checkpoint remediation fixture.');
  const weakest = remediation.modules[0];
  const discriminatingTask = tasks.find(task => task.id === weakest.discriminatingTaskId);
  const transferTask = tasks.find(task => task.id === weakest.transferTaskId);
  if (!discriminatingTask || !transferTask) throw new Error('Expected complete remediation task pair.');
  return {
    phase,
    checkpoint,
    profile,
    progress,
    curriculum,
    failedReport,
    reports: [...priorPassedReports, failedReport],
    failedTaskTitles: targetedTasks.map(task => task.title),
    weakestModule: weakest.moduleId,
    discriminatingTaskId: discriminatingTask.id,
    discriminatingTaskTitle: discriminatingTask.title,
    transferTaskId: transferTask.id,
    transferTaskTitle: transferTask.title,
    transferStage: transferTask.mode === 'puzzle' ? 'puzzle' : 'interview',
    failedAt
  };
}

async function seed(page: Page, userId: string) {
  const value = fixture(userId);
  await page.goto('./');
  await page.evaluate(({ id, state }) => {
    localStorage.setItem(`sql-academy-onboarding-v1:${id}`, JSON.stringify(state.profile));
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify(state.progress));
    localStorage.setItem(`sql-academy-curriculum-progress-v1:${id}`, JSON.stringify(state.curriculum));
    localStorage.setItem(`sql-academy-checkpoint-reports-v1:${id}`, JSON.stringify(state.reports));
  }, { id: userId, state: value });
  await page.reload();
  return value;
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
}

async function expectRemediationAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .include('[data-testid="checkpoint-remediation-banner"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function completeRemediationTask(page: Page, taskId: string, when: string) {
  const evidence = foundationEvidence(taskId);
  await page.evaluate(({ id, contractEvidence, completedAt, eventName }) => {
    const raw = localStorage.getItem('sql-academy-progress-v4');
    const progress = raw ? JSON.parse(raw) : null;
    if (!progress) throw new Error('Missing progress fixture.');
    const previous = progress.taskStats[id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
    progress.taskStats[id] = {
      ...previous,
      attempts: previous.attempts + 1,
      hintsUsed: 0,
      solutionViews: 0,
      solutionViewedAt: undefined,
      independentPasses: Math.max(1, previous.independentPasses || 0) + 1,
      lastIndependentAt: completedAt,
      completedAt: previous.completedAt || completedAt,
      lastAttemptAt: completedAt,
      ...contractEvidence
    };
    if (!progress.completed.includes(id)) progress.completed.push(id);
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify(progress));
    window.dispatchEvent(new CustomEvent(eventName, { detail: progress }));
  }, { id: taskId, contractEvidence: evidence, completedAt: when, eventName: PROGRESS_EVENT });
}

async function appendPassedReport(page: Page, userId: string, value: ReturnType<typeof fixture>) {
  const passedAt = new Date(Date.parse(value.failedAt) + 60_000).toISOString();
  await page.evaluate(({ id, report, when, eventName }) => {
    const key = `sql-academy-checkpoint-reports-v1:${id}`;
    const reports = JSON.parse(localStorage.getItem(key) || '[]');
    reports.push({
      ...report,
      id: 'checkpoint-remediation-passed',
      completedAt: when,
      attemptNumber: 3,
      score: 91,
      bestScore: 91,
      passed: true,
      remediationModules: []
    });
    localStorage.setItem(key, JSON.stringify(reports));
    window.dispatchEvent(new CustomEvent(eventName, { detail: reports }));
  }, { id: userId, report: value.failedReport, when: passedAt, eventName: CHECKPOINT_EVENT });
}

test('desktop failed checkpoint controls Today, Learning Path, goal preview and explicit retry', async ({ page }, testInfo) => {
  const auth = await authenticatePage(page, 'checkpoint-remediation');
  const value = await seed(page, String(auth.session.userId));

  const todayBanner = page.getByTestId('guided-checkpoint-remediation');
  await expect(todayBanner).toBeVisible();
  await expect(todayBanner).toContainText('52%');
  await expect(todayBanner).toContainText(value.checkpoint.title);
  const todayAction = page.getByTestId('guided-journey-action');
  await expect(todayAction).toHaveAttribute('data-route-reason', 'checkpoint-remediation');
  await expect(todayAction).toHaveAttribute('data-stage', 'practice');
  await expect(todayAction).toContainText(value.discriminatingTaskTitle);
  for (const failedTitle of value.failedTaskTitles) await expect(todayAction).not.toContainText(failedTitle);

  await page.getByTestId('learning-path-trigger').click();
  const path = page.getByTestId('learning-path');
  const banner = path.getByTestId('checkpoint-remediation-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('52%');
  await expect(path.locator('.session-list > button').first()).toContainText(value.discriminatingTaskTitle);
  await expectRemediationAccessible(page);
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-checkpoint-remediation.png'), fullPage: true });

  await path.getByText('Настройки маршрута', { exact: true }).click();
  await path.getByTestId('goal-switch-trigger').click();
  const switchPanel = path.getByTestId('goal-switch-panel');
  await switchPanel.getByTestId('goal-switch-option-backend').click();
  await expect(switchPanel.getByTestId('goal-switch-current-action')).toContainText(value.discriminatingTaskTitle);
  await expect(switchPanel.getByTestId('goal-switch-proposed-action')).toContainText(value.discriminatingTaskTitle);
  await expect(switchPanel.getByTestId('goal-switch-impact')).toContainText(/Текущий обязательный шаг не изменится/i);
  await switchPanel.getByTestId('goal-switch-cancel').click();

  await completeRemediationTask(
    page,
    value.transferTaskId,
    new Date(Date.parse(value.failedAt) + 15_000).toISOString()
  );
  await page.reload();
  const outOfOrder = page.getByTestId('guided-journey-action');
  await expect(outOfOrder).toHaveAttribute('data-stage', 'practice');
  await expect(outOfOrder).toContainText(value.discriminatingTaskTitle);

  await completeRemediationTask(
    page,
    value.discriminatingTaskId,
    new Date(Date.parse(value.failedAt) + 30_000).toISOString()
  );
  await page.reload();
  const transfer = page.getByTestId('guided-journey-action');
  await expect(transfer).toHaveAttribute('data-route-reason', 'checkpoint-remediation');
  await expect(transfer).toHaveAttribute('data-stage', value.transferStage);
  await expect(transfer).toContainText(value.transferTaskTitle);
  await expect(transfer).not.toContainText(value.discriminatingTaskTitle);

  await completeRemediationTask(
    page,
    value.transferTaskId,
    new Date(Date.parse(value.failedAt) + 45_000).toISOString()
  );
  await page.reload();
  await expect(page.getByTestId('guided-checkpoint-remediation')).toBeVisible();
  const retry = page.getByTestId('guided-journey-action');
  await expect(retry).toHaveAttribute('data-route-reason', 'checkpoint-remediation');
  await expect(retry).toHaveAttribute('data-stage', 'checkpoint');
  await expect(retry).toContainText(value.checkpoint.title);
  await expect(retry).not.toContainText(/Interview|Puzzle/i);

  await appendPassedReport(page, String(auth.session.userId), value);
  await page.reload();
  await expect(page.getByTestId('guided-checkpoint-remediation')).toBeHidden();
  await expect(page.getByTestId('guided-journey-action')).not.toHaveAttribute('data-route-reason', 'checkpoint-remediation');
});

test('mobile failed checkpoint remediation remains readable and accessible', async ({ page }, testInfo) => {
  const auth = await authenticatePage(page, 'mobile-checkpoint-remediation');
  const value = await seed(page, String(auth.session.userId));
  await expect(page.getByTestId('guided-checkpoint-remediation')).toContainText(value.checkpoint.title);
  await page.getByTestId('learning-path-mobile-trigger').click();
  const path = page.getByTestId('learning-path');
  await expect(path.getByTestId('checkpoint-remediation-banner')).toContainText('52%');
  await expect(path.locator('.session-list > button').first()).toContainText(value.discriminatingTaskTitle);
  for (const failedTitle of value.failedTaskTitles) {
    await expect(path.locator('.session-list > button').first()).not.toContainText(failedTitle);
  }
  await expectRemediationAccessible(page);
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-checkpoint-remediation.png'), fullPage: true });
});
