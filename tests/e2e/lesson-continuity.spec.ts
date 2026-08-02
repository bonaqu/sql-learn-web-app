import { expect, test } from '@playwright/test';
import { curriculumLessons } from '../../src/data/complete-curriculum';
import { lessonTransitions } from '../../src/data/lesson-bridges';
import { OPEN_DEFERRED_FEATURE_EVENT } from '../../src/lib/deferred-features';
import { authenticatePage } from './auth-helper';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
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

  const companion = page.getByTestId('curriculum-continuity-companion');
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
  await openCurriculumLesson(page, phaseTransition!.fromLessonId);
  const phaseLesson = curriculumLessons.find(lesson => lesson.id === phaseTransition!.fromLessonId)!;
  await expect(studio.getByRole('heading', { name: phaseLesson.title, exact: true })).toBeVisible();
  await expect(companion.getByTestId('lesson-continuity-outgoing')).toContainText(/Сначала checkpoint фазы/i);
  await expect(companion.getByTestId('lesson-continuity-outgoing')).toContainText(phaseTransition!.evidencePrompt);

  await companion.getByRole('button', { name: /Открыть checkpoint/i }).click();
  await expect(page.getByTestId('checkpoint-landing')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-lesson-continuity.png'), fullPage: true });
});

test('mobile curriculum keeps the continuity companion compact and readable', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobile-lesson-continuity');
  await page.goto('./');
  await page.getByTestId('curriculum-mobile-trigger').click();

  const companion = page.getByTestId('curriculum-continuity-companion');
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
