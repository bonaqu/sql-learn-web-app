import type { Page } from '@playwright/test';
import { curriculumLessons } from '../../src/data/complete-curriculum';
import { lessonChecks } from '../../src/data/lesson-checks';

const advancedToolNames: Record<string, RegExp> = {
  'assessment-trigger': /Экзамены/i,
  'checkpoint-trigger': /Контрольные этапы/i,
  'curriculum-trigger': /Учиться/i,
  'learning-path-trigger': /Мой план/i,
  'onboarding-trigger': /Настроить маршрут/i,
  'syllabus-open': /Диалекты и карта курса/i,
  'syllabus-trigger': /Диалекты и карта курса/i
};

const NAVIGATION_ATTEMPTS = 6;
const NAVIGATION_STEP_TIMEOUT_MS = 2_500;

function navigationError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export async function openAllTools(page: Page) {
  let lastError = new Error('All tools navigation did not become stable');

  for (let attempt = 0; attempt < NAVIGATION_ATTEMPTS; attempt += 1) {
    if (page.isClosed()) throw new Error('Page closed while opening all tools');
    try {
      const sidebar = page.locator('.sidebar');
      await sidebar.waitFor({ state: 'attached', timeout: NAVIGATION_STEP_TIMEOUT_MS });
      const sidebarOpen = await sidebar.evaluate(element => element.classList.contains('open'));
      const mobileMore = page.getByRole('button', { name: 'Ещё', exact: true });
      const mobileMenu = page.getByRole('button', { name: 'Открыть меню' });
      const mobileMoreVisible = await mobileMore.isVisible().catch(() => false);
      const mobileMenuVisible = await mobileMenu.isVisible().catch(() => false);

      if (!sidebarOpen && (mobileMoreVisible || mobileMenuVisible)) {
        const opener = mobileMoreVisible ? mobileMore : mobileMenu;
        await opener.click({ timeout: NAVIGATION_STEP_TIMEOUT_MS });
        await page.waitForFunction(
          () => document.querySelector('.sidebar')?.classList.contains('open') === true,
          undefined,
          { timeout: NAVIGATION_STEP_TIMEOUT_MS }
        );
      }

      const tools = page.locator('.sidebar .nav-more');
      await tools.waitFor({ state: 'visible', timeout: NAVIGATION_STEP_TIMEOUT_MS });
      const open = await tools.evaluate(element => (element as HTMLDetailsElement).open);
      if (!open) {
        await tools.locator('summary').click({ timeout: NAVIGATION_STEP_TIMEOUT_MS });
      }
      await page.waitForFunction(
        () => document.querySelector<HTMLDetailsElement>('.sidebar .nav-more')?.open === true,
        undefined,
        { timeout: NAVIGATION_STEP_TIMEOUT_MS }
      );
      return;
    } catch (error) {
      lastError = navigationError(error);
      if (attempt + 1 < NAVIGATION_ATTEMPTS) await page.waitForTimeout(75);
    }
  }

  throw lastError;
}

export async function openAdvancedTool(page: Page, testId: string) {
  let lastError = new Error(`Navigation target ${testId} did not become stable`);

  for (let attempt = 0; attempt < NAVIGATION_ATTEMPTS; attempt += 1) {
    if (page.isClosed()) throw new Error(`Page closed while opening ${testId}`);
    try {
      await openAllTools(page);
      const testIdTarget = page.getByTestId(testId);
      await testIdTarget.waitFor({ state: 'visible', timeout: NAVIGATION_STEP_TIMEOUT_MS });
      await testIdTarget.click({ timeout: NAVIGATION_STEP_TIMEOUT_MS });
      return;
    } catch (error) {
      lastError = navigationError(error);
      if (attempt + 1 < NAVIGATION_ATTEMPTS) await page.waitForTimeout(75);
    }
  }

  const accessibleName = advancedToolNames[testId];
  if (!accessibleName) throw lastError;
  await openAllTools(page);
  const fallback = page.getByRole('button', { name: accessibleName });
  await fallback.waitFor({ state: 'visible', timeout: NAVIGATION_STEP_TIMEOUT_MS });
  await fallback.click({ timeout: NAVIGATION_STEP_TIMEOUT_MS });
}

export function guidedHome(page: Page) {
  return page.locator('[data-testid="guided-first-run"], [data-testid="guided-today"]');
}

async function waitForCurriculumSyncCycle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const eventName = 'sql-academy-curriculum-sync-status';
    const timeout = window.setTimeout(() => {
      window.removeEventListener(eventName, onStatus as EventListener);
      reject(new Error('Curriculum sync did not settle before fixture seeding'));
    }, 15_000);
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      window.removeEventListener(eventName, onStatus as EventListener);
      if (error) reject(error);
      else resolve();
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: string; message?: string }>).detail;
      if (detail?.status === 'synced' || detail?.status === 'offline') finish();
      if (detail?.status === 'error') finish(new Error(detail.message || 'Curriculum sync failed'));
    };
    window.addEventListener(eventName, onStatus as EventListener);
    window.dispatchEvent(new Event('online'));
  }));
}

export async function seedFirstLessonEvidence(page: Page) {
  const lesson = curriculumLessons[0];
  const answeredAt = new Date().toISOString();
  const evidence = {
    lessonId: lesson.id,
    sectionIds: lesson.sections.map(section => section.id),
    answers: Object.fromEntries(lessonChecks(lesson).map(check => [check.id, {
      optionIndex: check.correctIndex,
      correct: true,
      answeredAt
    }])),
    updatedAt: answeredAt
  };

  await waitForCurriculumSyncCycle(page);
  await page.evaluate(payload => {
    const session = JSON.parse(localStorage.getItem('sql-academy-auth-session-v2') || 'null') as {
      userId?: string;
      username?: string;
    } | null;
    const ownerId = session?.userId || session?.username || 'local';
    localStorage.setItem(`sql-academy-curriculum-progress-v1:${ownerId}`, JSON.stringify({
      version: 1,
      completedSections: payload.sectionIds,
      completedLessons: [payload.lessonId],
      completedProjects: [],
      answers: payload.answers,
      projectDrafts: {},
      bookmark: {
        lessonId: payload.lessonId,
        sectionId: payload.sectionIds[0] || '',
        updatedAt: payload.updatedAt
      },
      updatedAt: payload.updatedAt
    }));
    window.dispatchEvent(new CustomEvent('sql-academy-curriculum-progress-changed'));
  }, evidence);
}