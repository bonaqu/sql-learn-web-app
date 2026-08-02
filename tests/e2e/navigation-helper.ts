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
      bookmark: { lessonId: payload.lessonId, sectionId: payload.sectionIds[0] || null },
      updatedAt: payload.updatedAt
    }));
    window.dispatchEvent(new CustomEvent('sql-academy-curriculum-progress-changed'));
  }, evidence);
}
