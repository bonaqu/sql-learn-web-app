import type { Page } from '@playwright/test';
import { curriculumLessons } from '../../src/data/complete-curriculum';
import { lessonChecks } from '../../src/data/lesson-checks';

export async function openAllTools(page: Page) {
  const sidebar = page.locator('.sidebar');
  const sidebarOpen = await sidebar.evaluate(element => element.classList.contains('open'));
  const mobileMore = page.getByRole('button', { name: 'Ещё', exact: true });
  const mobileMenu = page.getByRole('button', { name: 'Открыть меню' });
  const mobileMoreVisible = await mobileMore.isVisible();
  const mobileMenuVisible = await mobileMenu.isVisible();

  if (!sidebarOpen && (mobileMoreVisible || mobileMenuVisible)) {
    if (mobileMoreVisible) {
      await mobileMore.click();
    } else {
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