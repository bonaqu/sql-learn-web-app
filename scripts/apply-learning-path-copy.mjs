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

edit('src/components/LearningPathPortal.tsx', replaceOne => {
  replaceOne(
    "import type { GoalSwitchEvidence } from '../lib/goal-switch';\nimport {",
    "import type { GoalSwitchEvidence } from '../lib/goal-switch';\nimport { journeyStageLabels } from '../lib/journey-display';\nimport {"
  );
  replaceOne(
    "function levelLabel(module: ModuleMastery) {\n  if (module.routeState === 'current') return 'Текущий goal-priority';\n  if (module.routeState === 'eligible') return 'Prerequisites готовы · позже по цели';\n  if (module.routeState === 'locked') return 'Prerequisites не закрыты';\n  if (module.level === 'mastered') return 'Освоено';\n  if (module.routeState === 'completed' && module.recommendedTask) return 'Foundation закрыт · transfer';\n  if (module.routeState === 'completed') return 'Foundation закрыт';\n  if (module.level === 'practice') return 'Закрепление';\n  if (module.level === 'learning') return 'В работе';\n  return 'Новый модуль';\n}",
    "function levelLabel(module: ModuleMastery) {\n  if (module.routeState === 'current') return 'Текущий приоритет цели';\n  if (module.routeState === 'eligible') return 'Обязательные темы пройдены · позже по цели';\n  if (module.routeState === 'locked') return 'Сначала пройди обязательные темы';\n  if (module.level === 'mastered') return 'Освоено';\n  if (module.routeState === 'completed' && module.recommendedTask) return 'База освоена · перенос навыка';\n  if (module.routeState === 'completed') return 'База освоена';\n  if (module.level === 'practice') return 'Закрепление';\n  if (module.level === 'learning') return 'В работе';\n  return 'Новый модуль';\n}"
  );
  replaceOne(
    "function evidenceActionLabel(action: ModuleSkillEvidence['recommendedAction']) {\n  if (action === 'lesson') return 'следующий урок';\n  if (action === 'practice') return 'практика';\n  if (action === 'checkpoint') return 'checkpoint';\n  if (action === 'assessment') return 'assessment';\n  if (action === 'project') return 'capstone';\n  return 'повторение';\n}",
    "function evidenceActionLabel(action: ModuleSkillEvidence['recommendedAction']) {\n  if (action === 'lesson') return 'следующий урок';\n  if (action === 'practice') return 'практика';\n  if (action === 'checkpoint') return 'контрольный этап';\n  if (action === 'assessment') return 'итоговая проверка';\n  if (action === 'project') return 'итоговый проект';\n  return 'повторение';\n}"
  );
  replaceOne(
    "• Главный фокус: ${weakest ? `${weakest.title} (${weakest.mastery}% mastery)` : 'закрепление пройденного'}",
    "• Главный фокус: ${weakest ? `${weakest.title} (${weakest.mastery}% освоения)` : 'закрепление пройденного'}"
  );
  replaceOne(
    ".map(module => ({\n          module: module.title,\n          readiness: module.readiness,\n          next: module.recommendedAction,\n          blockers: module.blockers\n        }));",
    ".map(module => ({\n          тема: module.title,\n          готовность: module.readiness,\n          следующийШаг: evidenceActionLabel(module.recommendedAction),\n          ограничения: module.blockers\n        }));"
  );
  replaceOne(
    "question: `Составь персональный учебный план на ${targetMinutes} минут. Не давай готовые SQL-решения. Учитывай пять видов evidence. Данные: ${JSON.stringify({ context, evidenceContext })}`,
",
    "question: `Составь персональный учебный план на ${targetMinutes} минут. Не давай готовые SQL-решения. Учитывай пять видов подтверждённых результатов. Данные: ${JSON.stringify({ context, evidenceContext })}`,
"
  );
  replaceOne(
    "task: 'Персональный маршрут SQL Academy по lesson, practice, checkpoint, assessment и project evidence.',",
    "task: 'Персональный маршрут SQL Academy: урок, практика, контрольный этап, итоговая проверка и проект.',"
  );
  replaceOne("topic: 'Adaptive Learning Path',", "topic: 'Адаптивный учебный маршрут',");
  replaceOne("lastFeedback: `Evidence readiness ${readiness}%.`,", "lastFeedback: `Готовность по подтверждённым результатам ${readiness}%.`,");
  replaceOne(
    "<div className=\"path-brand\"><div><Route /></div><span><strong>Adaptive Learning Path</strong><small>Единый evidence graph SQL Academy</small></span></div>",
    "<div className=\"path-brand\"><div><Route /></div><span><strong>Адаптивный учебный маршрут</strong><small>Единая карта учебных результатов SQL Academy</small></span></div>"
  );
  replaceOne(
    "<span className=\"path-kicker\"><Sparkles /> lesson + practice + checkpoint + assessment + project</span>",
    "<span className=\"path-kicker\"><Sparkles /> урок + практика + контроль + итоговая проверка + проект</span>"
  );
  replaceOne("<div><strong>{readiness}%</strong><span>evidence readiness</span></div>", "<div><strong>{readiness}%</strong><span>готовность по результатам</span></div>");
  replaceOne("<article><Flame /><span><small>Текущий streak</small>", "<article><Flame /><span><small>Серия занятий</small>");
  replaceOne("<article><Flag /><span><small>Checkpoints</small>", "<article><Flag /><span><small>Контрольные этапы</small>");
  replaceOne("<small>Failed checkpoint · попытка {activeRemediation.attemptNumber}</small>", "<small>Не пройден контрольный этап · попытка {activeRemediation.attemptNumber}</small>");
  replaceOne(
    "<p>Targeted remediation временно сильнее специализации. Слабые модули: {activeRemediation.modules.map(module => `${module.moduleTitle} (${module.score}%)`).join(', ')}.</p>",
    "<p>Точечное восстановление временно важнее специализации. Слабые модули: {activeRemediation.modules.map(module => `${module.moduleTitle} (${module.score}%)`).join(', ')}.</p>"
  );
  replaceOne(
    ": `Сначала завершится более приоритетный ${session.frontier.action.stage}; затем маршрут автоматически вернётся к remediation.`}",
    ": `Сначала завершится более приоритетный этап «${journeyStageLabels[session.frontier.action.stage]}»; затем маршрут автоматически вернётся к восстановлению.`}"
  );
  replaceOne(
    "<p>{session.focusModule.title}: mastery {session.focusModule.mastery}%, ошибок {session.focusModule.incorrect}, подсказок {session.focusModule.hints}.</p>",
    "<p>{session.focusModule.title}: освоение {session.focusModule.mastery}%, ошибок {session.focusModule.incorrect}, подсказок {session.focusModule.hints}.</p>"
  );
  replaceOne(
    "<div className=\"path-section-heading\"><div><span className=\"path-eyebrow\">AI Coach</span><h2>План следующего шага</h2><p>Основан на пяти видах evidence, а не случайном совете.</p></div><BrainCircuit /></div>",
    "<div className=\"path-section-heading\"><div><span className=\"path-eyebrow\">AI-наставник</span><h2>План следующего шага</h2><p>Основан на пяти видах подтверждённых результатов, а не случайном совете.</p></div><BrainCircuit /></div>"
  );
  replaceOne("{mentorLoading ? 'Анализирую evidence graph…' : mentorAnswer}", "{mentorLoading ? 'Анализирую карту учебных результатов…' : mentorAnswer}");
  replaceOne("<small><ShieldCheck /> Без имени, email и данных работодателя.</small>", "<small><ShieldCheck /> Без имени, адреса электронной почты и данных работодателя.</small>");
  replaceOne(
    "<div className=\"roadmap-heading\"><div><span className=\"path-eyebrow\">Skill graph · {currentGoalTitle}</span><h2>Карта доказательств и goal-route</h2><p>Readiness и порядок объясняются тем же frontier: общий foundation, текущий приоритет, eligible позже и обязательная expert-ширина.</p></div><Trophy /></div>",
    "<div className=\"roadmap-heading\"><div><span className=\"path-eyebrow\">Карта навыков · {currentGoalTitle}</span><h2>Карта навыков и результатов</h2><p>Готовность и порядок объясняются одним маршрутом: общая база, текущий приоритет, доступные позже темы и обязательная профессиональная широта.</p></div><Trophy /></div>"
  );
  replaceOne("<span className=\"eligible\"><i />prerequisites готовы · позже</span>", "<span className=\"eligible\"><i />обязательные темы пройдены · позже</span>");
  replaceOne("<span className=\"completed\"><i />completed evidence</span>", "<span className=\"completed\"><i />результат подтверждён</span>");
  replaceOne("<span className=\"locked\"><i />locked prerequisite</span>", "<span className=\"locked\"><i />сначала обязательные темы</span>");
  replaceOne("<small>{phaseReadiness}% evidence</small>", "<small>{phaseReadiness}% подтверждено</small>");
  replaceOne("{passed ? 'Пройден' : 'Checkpoint'}", "{passed ? 'Пройден' : 'Контроль'}");
  replaceOne(
    "<small>{levelLabel(module)} · next: {evidence ? evidenceActionLabel(evidence.recommendedAction) : 'practice'}</small>",
    "<small>{levelLabel(module)} · дальше: {evidence ? evidenceActionLabel(evidence.recommendedAction) : 'практика'}</small>"
  );
  replaceOne("<Flag /><span><strong>Исполняемая контрольная этапа</strong>", "<Flag /><span><strong>Контрольный этап с практическими задачами</strong>");
});

edit('src/components/ReadinessExplainer.tsx', replaceOne => {
  replaceOne("checkpoint: 'Checkpoint',", "checkpoint: 'Контроль',");
  replaceOne("assessment: 'Assessment',", "assessment: 'Итоговая проверка',");
  replaceOne("'checkpoint-report': 'completed checkpoint report',", "'checkpoint-report': 'завершённый отчёт контрольного этапа',");
  replaceOne("'legacy-checkpoint-task': 'migrated legacy evidence',", "'legacy-checkpoint-task': 'перенесённый результат из старой версии',");
  replaceOne("'assessment-report': 'completed assessment report',", "'assessment-report': 'завершённый отчёт итоговой проверки',");
  replaceOne("'capstone-report': 'immutable passed capstone report',", "'capstone-report': 'неизменяемый отчёт о пройденном итоговом проекте',");
  replaceOne("'project-progress': 'legacy project checkbox (не authoritative)'", "'project-progress': 'старая отметка проекта (не подтверждает навык)'");
  replaceOne("<span><strong>Как считается readiness?</strong><small>Только completed evidence и нормализованные применимые веса</small></span>", "<span><strong>Как считается готовность?</strong><small>Только подтверждённые результаты и нормализованные применимые веса</small></span>");
  replaceOne("Неприменимый capstone или checkpoint не уменьшает максимум модуля.", "Неприменимый итоговый проект или контрольный этап не уменьшает максимум модуля.");
  replaceOne("evidence.available ? `${evidence.score}%` : 'N/A'", "evidence.available ? `${evidence.score}%` : 'Не применяется'");
  replaceOne("evidence.available ? 'completed evidence пока отсутствует' : 'вес исключён из знаменателя'", "evidence.available ? 'подтверждённых результатов пока нет' : 'вес исключён из знаменателя'");
  replaceOne(
    "<aside><ShieldCheck /><span><strong>Integrity rule</strong><small>Expired и abandoned attempts остаются в истории, но не участвуют в readiness. Project evidence создаёт только immutable passed capstone report; legacy checkbox не участвует в сертификате.</small></span></aside>",
    "<aside><ShieldCheck /><span><strong>Правило целостности</strong><small>Просроченные и прерванные попытки остаются в истории, но не участвуют в готовности. Результат проекта создаёт только неизменяемый отчёт о пройденном итоговом проекте; старая отметка не участвует в сертификате.</small></span></aside>"
  );
});

edit('scripts/validate-learning-path.ts', replaceOne => {
  replaceOne(
    "import { curriculumCheckpoints, curriculumLessons } from '../src/data/complete-curriculum.ts';",
    "import { readFileSync } from 'node:fs';\nimport { curriculumCheckpoints, curriculumLessons } from '../src/data/complete-curriculum.ts';"
  );
  replaceOne(
    "import { nextJourneyAction, type JourneyAction } from '../src/lib/learning-journey.ts';",
    "import { journeyStageLabels } from '../src/lib/journey-display.ts';\nimport { nextJourneyAction, type JourneyAction } from '../src/lib/learning-journey.ts';"
  );
  replaceOne(
    "const failures: string[] = [];",
    "const failures: string[] = [];\nif (Object.keys(journeyStageLabels).length !== 10) failures.push('Every journey stage needs a learner-facing label');\nif (new Set(Object.values(journeyStageLabels)).size !== 10) failures.push('Journey stage labels must remain distinct');"
  );
  replaceOne(
    "if (failures.length) {",
    "const learningPathPortalSource = readFileSync(new URL('../src/components/LearningPathPortal.tsx', import.meta.url), 'utf8');\nfor (const forbidden of [\n  'Текущий goal-priority',\n  'Prerequisites готовы',\n  'Prerequisites не закрыты',\n  'Foundation закрыт',\n  'Adaptive Learning Path',\n  'Единый evidence graph',\n  'lesson + practice + checkpoint + assessment + project',\n  'evidence readiness',\n  'Текущий streak',\n  '<small>Checkpoints</small>',\n  'Failed checkpoint',\n  'Targeted remediation',\n  'AI Coach',\n  'пяти видах evidence',\n  'Анализирую evidence graph',\n  'Skill graph',\n  'goal-route',\n  'completed evidence',\n  'locked prerequisite',\n  '% evidence',\n  'next:',\n  'Исполняемая контрольная этапа',\n  \"topic: 'Adaptive Learning Path'\",\n  'Evidence readiness'\n]) {\n  if (learningPathPortalSource.includes(forbidden)) failures.push(`Learning Path retained internal learner copy: ${forbidden}`);\n}\nfor (const required of [\n  \"from '../lib/journey-display'\",\n  'journeyStageLabels[session.frontier.action.stage]',\n  'Адаптивный учебный маршрут',\n  'готовность по результатам',\n  'Контрольные этапы',\n  'AI-наставник',\n  'Карта навыков и результатов',\n  'дальше:',\n  'Контрольный этап с практическими задачами'\n]) {\n  if (!learningPathPortalSource.includes(required)) failures.push(`Learning Path is missing localized route copy: ${required}`);\n}\n\nconst readinessExplainerSource = readFileSync(new URL('../src/components/ReadinessExplainer.tsx', import.meta.url), 'utf8');\nfor (const forbidden of [\n  'Как считается readiness?',\n  'completed evidence',\n  'Неприменимый capstone',\n  'N/A',\n  'Integrity rule',\n  'Expired и abandoned attempts',\n  'Project evidence',\n  'immutable passed capstone report',\n  'legacy checkbox'\n]) {\n  if (readinessExplainerSource.includes(forbidden)) failures.push(`Readiness explainer retained internal learner copy: ${forbidden}`);\n}\nfor (const required of [\n  'Как считается готовность?',\n  'подтверждённые результаты',\n  'Неприменимый итоговый проект',\n  'Не применяется',\n  'Правило целостности',\n  'Просроченные и прерванные попытки'\n]) {\n  if (!readinessExplainerSource.includes(required)) failures.push(`Readiness explainer is missing localized copy: ${required}`);\n}\n\nif (failures.length) {"
  );
  replaceOne(
    "console.log(`Learning path validated: ${goals.length} goals, ${mastery.length} modules, ${phases.length} phases and one evidence-aware lesson/task/checkpoint/assessment/project frontier.`);",
    "console.log(`Learning path validated: ${goals.length} goals, ${mastery.length} modules, ${phases.length} phases, complete Russian stage labels and one canonical lesson/task/checkpoint/assessment/project frontier.`);"
  );
});

edit('tests/e2e/learning-path.spec.ts', replaceOne => {
  replaceOne(
    "body: JSON.stringify({ answer: 'Персональный план\\n• Изучи mental model\\n• Выполни связанную практику\\n• Заверши контрольной точкой' })",
    "body: JSON.stringify({ answer: 'Персональный план\\n• Разбери модель темы\\n• Выполни связанную практику\\n• Заверши контрольным этапом' })"
  );
  replaceOne(
    "  await expect(learningPath).toBeVisible();\n  await expect(learningPath.getByRole('heading', { name: /Доказуемый путь к рабочему SQL/ })).toBeVisible();",
    "  await expect(learningPath).toBeVisible();\n  await expect(learningPath.locator('.path-brand')).toContainText('Адаптивный учебный маршрут');\n  await expect(learningPath.getByRole('heading', { name: /Доказуемый путь к рабочему SQL/ })).toBeVisible();\n  await expect(learningPath.locator('.readiness-ring')).toContainText('готовность по результатам');\n  await expect(learningPath.locator('.path-metrics')).toContainText('Контрольные этапы');"
  );
  replaceOne(
    "  await expect(learningPath.getByRole('heading', { name: 'Карта доказательств' })).toBeVisible();",
    "  await expect(learningPath.getByRole('heading', { name: 'Карта навыков и результатов' })).toBeVisible();\n  await expect(learningPath.getByTestId('goal-route-legend')).toContainText('обязательные темы пройдены');\n  await expect(learningPath.getByTestId('goal-route-legend')).not.toContainText(/prerequisite|evidence|locked/i);"
  );
  replaceOne("await explainer.getByRole('button', { name: /Как считается readiness/i }).click();", "await explainer.getByRole('button', { name: /Как считается готовность/i }).click();");
  replaceOne("await expect(explainer.getByText(/Expired и abandoned attempts/)).toBeVisible();", "await expect(explainer.getByText(/Просроченные и прерванные попытки/)).toBeVisible();");
  replaceOne(
    "  await expect(learningPath.getByRole('heading', { name: 'Карта доказательств' })).toBeVisible();\n  const explainer = learningPath.getByTestId('readiness-explainer');",
    "  await expect(learningPath.getByRole('heading', { name: 'Карта навыков и результатов' })).toBeVisible();\n  const explainer = learningPath.getByTestId('readiness-explainer');"
  );
  replaceOne("await explainer.getByRole('button', { name: /Как считается readiness/i }).click();", "await explainer.getByRole('button', { name: /Как считается готовность/i }).click();");
  replaceOne("await expect(explainer.getByText(/Неприменимый capstone/)).toBeVisible();", "await expect(explainer.getByText(/Неприменимый итоговый проект/)).toBeVisible();");
});

console.log('Learning Path and readiness explanation localized without changing route or evidence IDs.');
