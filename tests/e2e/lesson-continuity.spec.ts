import { expect, test } from '@playwright/test';
import { curriculumLessons } from '../../src/data/complete-curriculum';
import { lessonChecks } from '../../src/data/lesson-checks';
import { lessonTransitions } from '../../src/data/lesson-bridges';
import { OPEN_DEFERRED_FEATURE_EVENT } from '../../src/lib/deferred-features';
import { authenticatePage } from './auth-helper';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

async function seedLessonsThrough(page: import('@playwright/test').Page, lessonId: string) {
  const finalIndex = curriculumLessons.findIndex(lesson => lesson.id === lessonId);
  const lessons = curriculumLessons.slice(0, finalIndex + 1);
  const answeredAt = new Date().toISOString();
  const payload = {
    lessonIds: lessons.map(lesson => lesson.id),
    sectionIds: lessons.flatMap(lesson => lesson.sections.map(section => section.id)),
    answers: Object.fromEntries(lessons.flatMap(lesson => lessonChecks(lesson).map(check => [check.id, {
      optionIndex: check.correctIndex,
      correct: true,
      answeredAt
    }]))),
    bookmark: {
      lessonId,
      sectionId: lessons.at(-1)?.sections[0]?.id || '',
      updatedAt: answeredAt
    },
    updatedAt: answeredAt
  };

  await page.evaluate(progress => {
    const session = JSON.parse(localStorage.getItem('sql-academy-auth-session-v2') || 'null') as {
      userId?: string;
      username?: string;
    } | null;
    const ownerId = session?.userId || session?.username || 'local';
    localStorage.setItem(`sql-academy-curriculum-progress-v1:${ownerId}`, JSON.stringify({
      version: 1,
      completedSections: progress.sectionIds,
      completedLessons: progress.lessonIds,
      completedProjects: [],
      answers: progress.answers,
      projectDrafts: {},
      bookmark: progress.bookmark,
      updatedAt: progress.updatedAt
    }));
    window.dispatchEvent(new CustomEvent('sql-academy-curriculum-progress-changed'));
  }, payload);
}

async function openCurriculumLesson(page: import('@playwright/test').Page, lessonId: string) {
  await page.evaluate(({ eventName, id }) => {
    const params = new URLSearchParams();
    params.set('lesson', id);
    history.replaceState(null, '', `${location.pathname}${location.search}#${params.toString()}`);
    window.dispatchEvent(new CustomEvent(eventName, { detail: { feature: 'curriculum' } }));
  }, { eventName: OPEN_DEFERRED_FEATURE_EVENT, id: lessonId });
}

test('desktop curriculum explains why each lesson follows and routes phase boundaries through checkpoints', async ({ page }, testInfo) => {
  await authenticatePage(page, 'lesson-continuity');
  await page.goto('./');
  await page.getByTestId('curriculum-trigger').click();

  const firstLesson = curriculumLessons[0];
  const secondLesson = curriculumLessons[1];
  const studio = page.getByTestId('curriculum-studio');
  await expect(studio).toBeVisible();
  await expect(studio.getByRole('heading', { name: firstLesson.title, exact: true })).toBeVisible();

  const companion = studio.getByTestId('curriculum-continuity-companion');
  await expect(companion).toBeVisible();
  const toggle = companion.getByRole('button', { name: /Связь урока/i });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(companion.getByTestId('lesson-continuity-entry')).toBeVisible();
  await expect(companion.getByTestId('lesson-continuity-outgoing')).toContainText(secondLesson.title);

  await companion.getByRole('button', { name: /Перейти к уроку/i }).click();
  await expect(studio.getByRole('heading', { name: secondLesson.title, exact: true })).toBeVisible();
  await expect(companion.getByTestId('lesson-continuity-incoming')).toContainText(firstLesson.title);
  await expect(companion.getByTestId('lesson-continuity-incoming')).toContainText(/Что сохраняем/i);
  await expect(companion.getByTestId('lesson-continuity-incoming')).toContainText(/Почему идём дальше/i);
  await expect(companion.getByTestId('lesson-continuity-incoming')).toContainText(/Новая модель/i);

  const phaseTransition = lessonTransitions.find(transition => transition.kind === 'phase');
  expect(phaseTransition).toBeTruthy();
  await seedLessonsThrough(page, phaseTransition!.fromLessonId);
  await openCurriculumLesson(page, phaseTransition!.fromLessonId);
  const phaseLesson = curriculumLessons.find(lesson => lesson.id === phaseTransition!.fromLessonId)!;
  await expect(studio.getByRole('heading', { name: phaseLesson.title, exact: true })).toBeVisible();
  const phaseOutgoing = companion.getByTestId('lesson-continuity-outgoing');
  await expect(phaseOutgoing).toContainText(/Сначала checkpoint фазы/i);
  await expect(phaseOutgoing).toContainText(phaseTransition!.evidencePrompt);
  await expect(phaseOutgoing.getByRole('button', { name: /Перейти к уроку/i })).toHaveCount(0);
  await expect(phaseOutgoing.getByRole('button', { name: /Практика:/i })).toHaveCount(0);

  await phaseOutgoing.getByRole('button', { name: /Открыть checkpoint/i }).click();
  await expect(page.getByTestId('checkpoint-landing')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-lesson-continuity.png'), fullPage: true });
});

test('mobile curriculum keeps the continuity companion compact and readable', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobile-lesson-continuity');
  await page.goto('./');
  await page.getByTestId('curriculum-mobile-trigger').click();

  const studio = page.getByTestId('curriculum-studio');
  const companion = studio.getByTestId('curriculum-continuity-companion');
  await expect(companion).toBeVisible();
  const toggle = companion.getByRole('button', { name: /Связь урока/i });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expectNoHorizontalOverflow(page);

  await toggle.click();
  await expect(companion.getByTestId('lesson-continuity-entry')).toBeVisible();
  await expect(companion.getByTestId('lesson-continuity-outgoing')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-lesson-continuity.png'), fullPage: true });
});
