import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { curriculumLessons } from '../../src/data/complete-curriculum';
import { tasks } from '../../src/data/course-catalog';
import { lessonChecks } from '../../src/data/lesson-checks';
import { lessonTransitions } from '../../src/data/lesson-bridges';
import { OPEN_DEFERRED_FEATURE_EVENT } from '../../src/lib/deferred-features';
import { authenticatePage } from './auth-helper';
import { openAdvancedTool } from './navigation-helper';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

async function expectNoSeriousAxeViolations(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page }).include('[data-testid="beginner-lesson-loop"]').analyze();
  const violations = result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

function lessonReaderHeading(
  studio: import('@playwright/test').Locator,
  title: string
) {
  return studio
    .getByTestId('curriculum-reader')
    .getByRole('heading', { level: 1, name: title, exact: true });
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

async function seedCompleteTaskEvidence(page: import('@playwright/test').Page) {
  const completedAt = new Date().toISOString();
  const payload = {
    completedAt,
    xp: tasks.reduce((total, task) => total + task.xp, 0),
    tasks: tasks.map(task => ({
      id: task.id,
      evaluationContractId: task.evaluationContractId || null
    }))
  };

  await page.evaluate(seed => {
    const taskStats = Object.fromEntries(seed.tasks.map(task => [task.id, {
      attempts: 1,
      incorrect: 0,
      hintsUsed: 0,
      independentPasses: 1,
      completedAt: seed.completedAt,
      lastAttemptAt: seed.completedAt,
      lastIndependentAt: seed.completedAt,
      ...(task.evaluationContractId ? {
        evidenceContractVersion: 'foundation-evidence-v1',
        evaluationContractVersion: 'task-evaluation-v1',
        evaluationContractId: task.evaluationContractId,
        validatedFixtureIds: ['public', 'hidden-a', 'hidden-b'],
        hiddenFixtureIds: ['hidden-a', 'hidden-b']
      } : {})
    }]));
    const progress = {
      version: 4,
      completed: seed.tasks.map(task => task.id),
      taskStats,
      xp: seed.xp,
      streak: 1,
      history: [
        { day: 'Пн', solved: seed.tasks.length },
        { day: 'Вт', solved: 0 }, { day: 'Ср', solved: 0 }, { day: 'Чт', solved: 0 },
        { day: 'Пт', solved: 0 }, { day: 'Сб', solved: 0 }, { day: 'Вс', solved: 0 }
      ],
      lastTask: seed.tasks.at(-1)?.id,
      lastStudyDate: seed.completedAt.slice(0, 10)
    };
    localStorage.setItem('sql-academy-progress-v4', JSON.stringify(progress));
    window.dispatchEvent(new CustomEvent('sql-academy-progress-changed', { detail: progress }));
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

test('desktop curriculum beginner loop reaches offline SQL and an independent next task without guessing', async ({ page }, testInfo) => {
  await authenticatePage(page, 'beginner-loop');
  await page.goto('./');
  await openAdvancedTool(page, 'curriculum-trigger');

  const studio = page.getByTestId('curriculum-studio');
  const loop = studio.getByTestId('beginner-lesson-loop');
  await expect(loop).toBeVisible();
  await expect(loop.getByTestId('worked-example-locked')).toBeVisible();
  await expect(loop.getByTestId('beginner-worked-example')).toHaveCount(0);
  await expect(studio.getByRole('button', { name: /Отметить раздел изученным/i })).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);

  const prediction = loop.getByTestId('beginner-prediction');
  const radios = prediction.getByRole('radio');
  await radios.first().focus();
  await page.keyboard.press('ArrowDown');
  await prediction.getByRole('button', { name: 'Проверить прогноз' }).click();
  await expect(prediction).toContainText('Верно');
  await expect(loop.getByTestId('beginner-worked-example')).toBeVisible();

  await expect(loop.getByRole('button', { name: 'Выполнить пример' })).toBeEnabled();
  await page.evaluate(() => navigator.serviceWorker?.ready);
  await page.context().setOffline(true);
  await loop.getByRole('button', { name: 'Выполнить пример' }).click();
  await expect(loop.getByTestId('beginner-example-result')).toBeVisible();
  await expect(loop.getByText(/Готово: 14 строк/)).toBeVisible();

  const faded = loop.getByTestId('beginner-faded-practice');
  await faded.getByRole('textbox', { name: /SQL с пропуском/i }).fill("SELECT 'ticket_id resolution_minutes from tickets';");
  await faded.getByRole('button', { name: 'Проверить мой SQL' }).click();
  await expect(faded.locator('.beginner-loop-feedback')).toHaveClass(/error/);
  await expect(faded).toContainText('Неверные столбцы');
  await faded.getByRole('textbox', { name: /SQL с пропуском/i }).fill('SELECT ticket_id, resolution_minutes\nFROM tickets\nORDER BY ticket_id;');
  await faded.getByRole('button', { name: 'Проверить мой SQL' }).click();
  await expect(faded.locator('.beginner-loop-feedback')).toHaveClass(/success/);
  await expect(faded).toContainText('неизвестное время осталось NULL');
  await expect(faded.getByTestId('beginner-faded-result')).toBeVisible();
  await page.context().setOffline(false);

  await loop.getByRole('button', { name: 'Решить самостоятельно' }).click();
  await expect(page.getByRole('button', { name: /006 Puzzle · Объясни гранулярность приоритета сервиса/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-beginner-lesson-loop.png'), fullPage: true });
});

test('mobile mastery beginner loop explains a wrong prediction and stays readable', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobile-beginner-loop');
  await page.goto('./');
  await openAdvancedTool(page, 'curriculum-trigger');

  const loop = page.getByTestId('beginner-lesson-loop');
  const prediction = loop.getByTestId('beginner-prediction');
  await prediction.getByRole('radio').first().check();
  await prediction.getByRole('button', { name: 'Проверить прогноз' }).click();
  await expect(prediction).toContainText('Есть расхождение');
  await expect(prediction).toContainText('источник tickets содержит обращения');
  await expect(loop.getByTestId('beginner-worked-example')).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-beginner-lesson-loop.png'), fullPage: true });
});

test('desktop curriculum exposes 44 gated lesson cycles and an advanced semantic transfer', async ({ page }, testInfo) => {
  await authenticatePage(page, 'complete-lesson-loop');
  await page.goto('./');
  await openAdvancedTool(page, 'curriculum-trigger');

  const studio = page.getByTestId('curriculum-studio');
  await expect(studio.getByTestId('curriculum-sync')).toContainText(/В облаке|Офлайн/, { timeout: 25_000 });
  await seedLessonsThrough(page, curriculumLessons.at(-1)!.id);
  await seedCompleteTaskEvidence(page);
  for (const lesson of curriculumLessons) {
    await openCurriculumLesson(page, lesson.id);
    await expect(lessonReaderHeading(studio, lesson.title)).toBeVisible();
    const loop = studio.getByTestId('beginner-lesson-loop');
    await expect(loop).toBeVisible();
    await expect(loop.getByTestId('worked-example-locked')).toBeVisible();
    await expect(loop.getByTestId('independent-transfer-locked')).toBeVisible();
    await expect(studio.getByRole('button', { name: /Отметить раздел изученным/i })).toHaveCount(0);
  }

  const advancedLesson = curriculumLessons.find(lesson => lesson.id === 'lesson-dml-foundation')!;
  const cycle = advancedLesson.beginnerCycle!;
  const fadedTask = tasks.find(task => task.id === cycle.fadedPractice.evaluationTaskId)!;
  await openCurriculumLesson(page, advancedLesson.id);
  const loop = studio.getByTestId('beginner-lesson-loop');
  const prediction = loop.getByTestId('beginner-prediction');
  await prediction.getByRole('radio').nth(cycle.prediction.correctIndex).check();
  await prediction.getByRole('button', { name: 'Проверить прогноз' }).click();
  await expect(loop.getByTestId('faded-practice-locked')).toBeVisible();
  const runExample = loop.getByRole('button', { name: 'Выполнить пример' });
  await expect(runExample).toBeEnabled();
  await runExample.click();
  await expect(loop.getByTestId('beginner-example-result')).toBeVisible();

  const faded = loop.getByTestId('beginner-faded-practice');
  await expect(faded.getByRole('textbox', { name: /SQL с пропуском/i })).toHaveValue(/___/);
  await faded.getByRole('textbox', { name: /SQL с пропуском/i }).fill(fadedTask.solution);
  await faded.getByRole('button', { name: 'Проверить мой SQL' }).click();
  await expect(faded.locator('.beginner-loop-feedback')).toHaveClass(/success/);
  await expect(loop.getByTestId('beginner-transfer')).toBeVisible();
  await expect(loop.getByTestId('independent-transfer-locked')).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-complete-lesson-loop.png'), fullPage: true });

  await loop.getByRole('button', { name: 'Решить самостоятельно' }).click();
  await expect(page.getByRole('button', { name: /125 Puzzle · Откати только рискованный шаг/ })).toBeVisible();
});

test('desktop curriculum explains why each lesson follows and routes phase boundaries through checkpoints', async ({ page }, testInfo) => {
  await authenticatePage(page, 'lesson-continuity');
  await page.goto('./');
  await openAdvancedTool(page, 'curriculum-trigger');

  const firstLesson = curriculumLessons[0];
  const secondLesson = curriculumLessons[1];
  const studio = page.getByTestId('curriculum-studio');
  await expect(studio).toBeVisible();
  await expect(lessonReaderHeading(studio, firstLesson.title)).toBeVisible();

  const companion = studio.getByTestId('curriculum-continuity-companion');
  await expect(companion).toBeVisible();
  const toggle = companion.getByRole('button', { name: /Связь урока/i });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(companion.getByTestId('lesson-continuity-entry')).toBeVisible();
  await expect(companion.getByTestId('lesson-continuity-outgoing')).toContainText(secondLesson.title);

  await companion.getByRole('button', { name: /Перейти к уроку/i }).click();
  await expect(lessonReaderHeading(studio, secondLesson.title)).toBeVisible();
  await expect(companion.getByTestId('lesson-continuity-incoming')).toContainText(firstLesson.title);
  await expect(companion.getByTestId('lesson-continuity-incoming')).toContainText(/Что сохраняем/i);
  await expect(companion.getByTestId('lesson-continuity-incoming')).toContainText(/Почему идём дальше/i);
  await expect(companion.getByTestId('lesson-continuity-incoming')).toContainText(/Новая модель/i);

  const phaseTransition = lessonTransitions.find(transition => transition.kind === 'phase');
  expect(phaseTransition).toBeTruthy();
  await seedLessonsThrough(page, phaseTransition!.fromLessonId);
  await openCurriculumLesson(page, phaseTransition!.fromLessonId);
  const phaseLesson = curriculumLessons.find(lesson => lesson.id === phaseTransition!.fromLessonId)!;
  await expect(lessonReaderHeading(studio, phaseLesson.title)).toBeVisible();
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

test('mobile mastery curriculum keeps the continuity companion compact and readable', async ({ page }, testInfo) => {
  await authenticatePage(page, 'mobile-lesson-continuity');
  await page.goto('./');
  await openAdvancedTool(page, 'curriculum-trigger');

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
