import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { curriculumCheckpoints, curriculumLessons } from '../../src/data/complete-curriculum';
import { tasks } from '../../src/data/course-catalog';
import { lessonChecks } from '../../src/data/lesson-checks';
import { phaseDefinitions } from '../../src/data/learning-structure';
import { foundationTasksForModule } from '../../src/lib/learning-journey';
import { authenticatePage } from './auth-helper';

const CHECKPOINT_EVENT = 'sql-academy-checkpoint-reports-changed';
const PROGRESS_EVENT = 'sql-academy-progress-changed';

function phaseCheckpointFixture() {
  const result = phaseDefinitions.flatMap(phase => {
    const phaseModules = new Set<string>(phase.moduleIds);
    const checkpoint = curriculumCheckpoints.find(item => {
      const checkpointModules = new Set<string>(item.moduleIds);
      return checkpointModules.size === phaseModules.size
        && phase.moduleIds.every(moduleId => checkpointModules.has(moduleId));
    });
    return checkpoint ? [{ phase, checkpoint }] : [];
  })[0];
  if (!result) throw new Error('Expected one checkpoint covering a complete canonical phase.');
  return result;
}

function fixture(userId: string) {
  const { phase, checkpoint } = phaseCheckpointFixture();
  const checkpointModules = new Set<string>(checkpoint.moduleIds);
  const phaseLessons = curriculumLessons.filter(lesson => checkpointModules.has(lesson.module));
  const foundationTasks = checkpoint.moduleIds.flatMap(moduleId => foundationTasksForModule(moduleId));
  const failedAt = new Date(Date.now() - 45_000).toISOString();
  const beforeFailure = new Date(Date.parse(failedAt) - 60_000).toISOString();
  const weakTasks = checkpoint.taskIds.flatMap(taskId => {
    const task = tasks.find(item => item.id === taskId);
    return task ? [task] : [];
  });
  const weakModules = Array.from(new Set(weakTasks.map(task => task.module))).slice(0, 2);
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
    lastAttemptAt: beforeFailure
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
    completedSections: phaseLessons.flatMap(lesson => lesson.sections.map(section => section.id)),
    completedLessons: phaseLessons.map(lesson => lesson.id),
    completedProjects: [],
    answers: Object.fromEntries(phaseLessons.flatMap(lesson => lessonChecks(lesson).map(check => [check.id, {
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
      strongModuleIds: [...checkpoint.moduleIds],
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
  return {
    phase,
    checkpoint,
    profile,
    progress,
    curriculum,
    failedReport,
    targetedTaskIds: targetedTasks.map(task => task.id),
    weakestModule: weakModules[0],
    weakestTaskTitle: targetedTasks[0]?.title || '',
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
    localStorage.setItem(`sql-academy-checkpoint-reports-v1:${id}`, JSON.stringify([state.failedReport]));
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

async function repairTargetedTasks(page: Page, userId: string, value: ReturnType<typeof fixture>) {
  const repairedAt = new Date(Date.parse(value.failedAt) + 30_000).toISOString();
  await page.evaluate(({ ids, when, eventName }) => {
    const raw = localStorage.getItem('sql-academy-progress-v4');
    const progress = raw ? JSON.parse(raw) : null;
    if (!progress) throw new Error('Missing progress fixture.');
    for (const taskId of ids) {
      const previous = progress.taskStats[taskId] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
      progress.taskStats[taskId] = {
        ...previous,
        attempts: previous.attempts + 1,
        solutionViews: 0,
        independentPasses: Math.max(1, previous.independentPasses || 0) + 1,
        lastIndependentAt: when,
        completedAt: previous.completedAt || when,
        lastAttemptAt: when
      };
      if (!progress.completed.includes(taskId)) progress.completed.push(taskId);
    }
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify(progress));
    window.dispatchEvent(new CustomEvent(eventName, { detail: progress }));
  }, { id: userId, ids: value.targetedTaskIds, when: repairedAt, eventName: PROGRESS_EVENT });
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
  await expect(todayAction).toContainText(value.weakestTaskTitle);

  await page.getByTestId('learning-path-trigger').click();
  const path = page.getByTestId('learning-path');
  const banner = path.getByTestId('checkpoint-remediation-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('52%');
  await expect(path.locator('.session-list > button').first()).toContainText(value.weakestTaskTitle);
  await expectRemediationAccessible(page);
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-checkpoint-remediation.png'), fullPage: true });

  await path.getByTestId('goal-switch-trigger').click();
  const switchPanel = path.getByTestId('goal-switch-panel');
  await switchPanel.getByTestId('goal-switch-option-backend').click();
  await expect(switchPanel.getByTestId('goal-switch-current-action')).toContainText(value.weakestTaskTitle);
  await expect(switchPanel.getByTestId('goal-switch-proposed-action')).toContainText(value.weakestTaskTitle);
  await expect(switchPanel.getByTestId('goal-switch-impact')).toContainText(/Текущий обязательный шаг не изменится/i);
  await switchPanel.getByTestId('goal-switch-cancel').click();

  await repairTargetedTasks(page, String(auth.session.userId), value);
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
  await expect(path.locator('.session-list > button').first()).toContainText(value.weakestTaskTitle);
  await expectRemediationAccessible(page);
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-checkpoint-remediation.png'), fullPage: true });
});
