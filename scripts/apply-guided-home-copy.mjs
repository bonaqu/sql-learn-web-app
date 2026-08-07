import { readFileSync, writeFileSync } from 'node:fs';

function edit(path, transform) {
  const before = readFileSync(path, 'utf8');
  let source = before;
  const replaceOne = (needle, replacement) => {
    const count = source.split(needle).length - 1;
    if (count !== 1) throw new Error(`${path}: expected one occurrence, found ${count}: ${needle}`);
    source = source.replace(needle, replacement);
  };
  transform(replaceOne);
  if (source === before) throw new Error(`${path}: migration produced no change`);
  writeFileSync(path, source);
}

edit('src/components/GuidedHome.tsx', replaceOne => {
  replaceOne(
    "  onboardingReady,\n  studyDayLabels,\n  type WeekPlanItem",
    "  onboardingReady,\n  studyDayLabels,\n  weekPlanKindLabels,\n  type WeekPlanItem"
  );
  replaceOne(
    "function nextPlanItem(items: WeekPlanItem[]): WeekPlanItem | null {",
    "const journeyStageLabels: Record<JourneyFrontier['action']['stage'], string> = {\n  lesson: 'Урок',\n  guided: 'Практика с подсказками',\n  practice: 'Самостоятельная практика',\n  review: 'Повторение',\n  checkpoint: 'Контрольный этап',\n  interview: 'Интервью',\n  puzzle: 'SQL-головоломка',\n  assessment: 'Итоговая проверка',\n  project: 'Итоговый проект',\n  complete: 'Маршрут завершён'\n};\n\nfunction nextPlanItem(items: WeekPlanItem[]): WeekPlanItem | null {"
  );
  replaceOne(
    'Академия построит один понятный маршрут: общая база, цель, подтверждённый стартовый уровень и следующий prerequisite-safe шаг.',
    'Академия построит один понятный маршрут: общая база, выбранная цель, подтверждённый стартовый уровень и следующий доступный шаг.'
  );
  replaceOne('Работа, аналитика, backend, интервью или полный путь.', 'Поддержка, аналитика, бэкенд, интервью или полный путь.');
  replaceOne('Диагностика пропускает только непрерывный подтверждённый prefix.', 'Диагностика позволяет пропустить только непрерывную цепочку подтверждённых базовых тем.');
  replaceOne('<strong>Следуй frontier</strong><p>На главной и во всех режимах используется одно рекомендуемое действие.</p>', '<strong>Следуй следующему шагу</strong><p>На главной и во всех режимах используется одно рекомендуемое действие.</p>');
  replaceOne(
    "'Сверяю prerequisites, уроки, independent evidence, checkpoints и выбранную цель.'",
    "'Сверяю обязательные темы, уроки, самостоятельные результаты, контрольные этапы и выбранную цель.'"
  );
  replaceOne('aria-label={`Восстановление после checkpoint ${remediation.checkpointTitle}`}', 'aria-label={`Восстановление после контрольного этапа ${remediation.checkpointTitle}`}');
  replaceOne("'Сначала закрой уже назревшее retrieval-повторение, затем маршрут вернётся к восстановлению.'", "'Сначала закрой уже назревшее повторение по памяти, затем маршрут вернётся к восстановлению.'");
  replaceOne("'Новые independent-попытки подтверждены — повтори checkpoint; transfer пока закрыт.'", "'Новые самостоятельные попытки подтверждены — повтори контрольный этап; перенос навыка в новые режимы пока закрыт.'");
  replaceOne("? 'Приоритет на сегодня · retrieval review'", "? 'Приоритет на сегодня · повторение по памяти'");
  replaceOne("? `${nextStep.phaseTitle || 'Итоговый этап'}${nextStep.moduleTitle ? ` · ${nextStep.moduleTitle}` : ''} · ${nextStep.stage}`", "? `${nextStep.phaseTitle || 'Итоговый этап'}${nextStep.moduleTitle ? ` · ${nextStep.moduleTitle}` : ''} · ${journeyStageLabels[nextStep.stage]}`");
  replaceOne(": 'Синхронизация evidence-графа'", ": 'Синхронизация учебных результатов'");
  replaceOne("'Загружаю компактную сводку прогресса и goal-aware frontier.'", "'Загружаю компактную сводку прогресса и следующий шаг выбранного маршрута.'");
  replaceOne('<small>Общая база и специализация без пропуска prerequisites</small>', '<small>Общая база и специализация без пропуска обязательных тем</small>');
  replaceOne('{item.minutes} мин · {item.kind}', '{item.minutes} мин · {weekPlanKindLabels[item.kind]}');
  replaceOne('<small>Lesson → practice → checkpoint → transfer</small>', '<small>Урок → практика → контроль → перенос навыка</small>');
});

edit('scripts/validate-learning-journey.ts', replaceOne => {
  replaceOne(
    "assert.match(guidedHomeSource, /JOURNEY_EVIDENCE_EVENTS/,\n  'The Today page must react to shared curriculum/checkpoint/assessment evidence events.');",
    "assert.match(guidedHomeSource, /JOURNEY_EVIDENCE_EVENTS/,\n  'The Today page must react to shared curriculum/checkpoint/assessment evidence events.');\nfor (const forbiddenCopy of [\n  'prerequisite-safe шаг',\n  'подтверждённый prefix',\n  'Следуй frontier',\n  'аналитика, backend',\n  'independent evidence',\n  'retrieval-повторение',\n  'Новые independent-попытки',\n  'retrieval review',\n  'Синхронизация evidence-графа',\n  'goal-aware frontier',\n  'пропуска prerequisites',\n  'Lesson → practice → checkpoint → transfer',\n  '{item.kind}',\n  '${nextStep.stage}'\n]) {\n  assert.ok(!guidedHomeSource.includes(forbiddenCopy), `Today UI retained internal learner copy: ${forbiddenCopy}`);\n}\nfor (const requiredCopy of [\n  \"const journeyStageLabels: Record<JourneyFrontier['action']['stage'], string>\",\n  'journeyStageLabels[nextStep.stage]',\n  'weekPlanKindLabels[item.kind]',\n  'Следуй следующему шагу',\n  'повторение по памяти',\n  'Урок → практика → контроль → перенос навыка'\n]) {\n  assert.ok(guidedHomeSource.includes(requiredCopy), `Today UI is missing localized route copy: ${requiredCopy}`);\n}"
  );
});

edit('tests/e2e/guided-journey.spec.ts', replaceOne => {
  replaceOne(
    "  await expect(page.getByTestId('guided-first-run')).toBeVisible();\n  await page.getByRole('button', { name: 'Настроить мой маршрут' }).click();",
    "  const firstRun = page.getByTestId('guided-first-run');\n  await expect(firstRun).toBeVisible();\n  await expect(firstRun).not.toContainText(/prerequisite-safe|prefix|frontier|backend/i);\n  await page.getByRole('button', { name: 'Настроить мой маршрут' }).click();"
  );
  replaceOne(
    "  await expect(journeyAction).toContainText(/SQL-мышление/i);",
    "  await expect(journeyAction).toContainText(/SQL-мышление/i);\n  await expect(journeyAction).toContainText(/Урок/i);\n  await expect(journeyAction).not.toContainText(/evidence|frontier|retrieval review/i);\n  await expect(page.locator('.guided-progress-card')).toContainText('Урок → практика → контроль → перенос навыка');"
  );
});

console.log('Guided Today copy localized without changing route IDs or diagnostic attributes.');
