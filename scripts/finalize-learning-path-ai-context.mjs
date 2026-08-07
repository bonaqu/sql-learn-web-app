import { readFileSync, writeFileSync } from 'node:fs';

function replaceOne(path, needle, replacement) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(needle).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one occurrence, found ${count}: ${needle}`);
  writeFileSync(path, source.replace(needle, replacement));
}

replaceOne(
  'src/components/LearningPathPortal.tsx',
  "function reasonIcon(reason: SessionItem['reason']) {",
  "const sessionReasonLabels: Record<SessionItem['reason'], string> = {\n  review: 'повторение по памяти',\n  weakness: 'восстановление слабой темы',\n  new: 'следующий шаг маршрута',\n  checkpoint: 'контрольный этап'\n};\n\nfunction reasonIcon(reason: SessionItem['reason']) {"
);

replaceOne(
  'src/components/LearningPathPortal.tsx',
  "      const response = await fetch('/api/mentor', {",
  "      const mentorContext = {\n        цель: currentGoalTitle,\n        причинаСледующегоШага: session.frontier.action.routeReason,\n        восстановление: activeRemediation\n          ? {\n              контрольныйЭтап: activeRemediation.checkpointTitle,\n              результат: `${activeRemediation.score}% из ${activeRemediation.passingScore}%`,\n              слабыеТемы: activeRemediation.modules.map(module => module.moduleTitle)\n            }\n          : null,\n        готовность: `${context.readiness}%`,\n        слабыеТемы: context.weakest.map(item => ({\n          тема: item.title,\n          освоение: `${item.mastery}%`,\n          ошибки: item.errors,\n          подсказки: item.hints\n        })),\n        сессия: context.session.map(item => ({\n          шаг: item.title,\n          причина: sessionReasonLabels[item.reason],\n          тема: item.topic\n        })),\n        выполнено: `${context.completed}/${context.total}`\n      };\n      const response = await fetch('/api/mentor', {"
);

const oldQuestion = "question: `Составь персональный учебный план на ${targetMinutes} минут. Не давай готовые SQL-решения. Учитывай пять видов подтверждённых результатов. Данные: ${" + "JSON.stringify({ context, evidenceContext })}`,";
const newQuestion = "question: `Составь персональный учебный план на ${targetMinutes} минут. Не давай готовые SQL-решения. Учитывай пять видов подтверждённых результатов. Данные: ${" + "JSON.stringify({ контекст: mentorContext, ограничения: evidenceContext })}`,";
replaceOne('src/components/LearningPathPortal.tsx', oldQuestion, newQuestion);

replaceOne(
  'scripts/validate-learning-path.ts',
  "  'Evidence readiness'\n]) {",
  "  'Evidence readiness',\n  'JSON.stringify({ context, evidenceContext })'\n]) {"
);

replaceOne(
  'scripts/validate-learning-path.ts',
  "  'Контрольный этап с практическими задачами'\n]) {",
  "  'Контрольный этап с практическими задачами',\n  'const mentorContext = {',\n  'sessionReasonLabels[item.reason]',\n  'JSON.stringify({ контекст: mentorContext, ограничения: evidenceContext })'\n]) {"
);

console.log('Learning Path AI request now uses a learner-facing Russian projection.');
