import { readFileSync, writeFileSync } from 'node:fs';

function replaceOne(path, needle, replacement) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(needle).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one occurrence, found ${count}: ${needle}`);
  writeFileSync(path, source.replace(needle, replacement));
}

const path = 'src/lib/skill-evidence.ts';
const replacements = [
  ["blockers.push('Не завершён lesson mastery loop: теория, check и independent SQL');", "blockers.push('Не завершён цикл освоения урока: теория, проверка понимания и самостоятельный SQL');"],
  ["blockers.push('Нет passed checkpoint evidence');", "blockers.push('Нет подтверждённого результата контрольного этапа');", 2],
  ["blockers.push('Нет устойчивого completed assessment evidence');", "blockers.push('Нет устойчивого результата итоговой проверки');"],
  ["blockers.push(`Не пройден предыдущий checkpoint: ${previousCheckpoint.title}`);", "blockers.push(`Не пройден предыдущий контрольный этап: ${previousCheckpoint.title}`);"],
  ["blockers.push(`Есть модуль с practice mastery ниже ${thresholds.phasePracticeCompletion}%`);", "blockers.push(`Есть модуль с самостоятельной практикой ниже ${thresholds.phasePracticeCompletion}%`);"],
  ["`Practice mastery каждого модуля не ниже ${thresholds.phasePracticeCompletion}%`", "`Самостоятельная практика каждого модуля не ниже ${thresholds.phasePracticeCompletion}%`"],
  ["`Checkpoint score не ниже ${checkpoint.passingScore}%`", "`Результат контрольного этапа не ниже ${checkpoint.passingScore}%`"],
  ["'Источник: текущая completed checkpoint attempt, синхронизируемая между устройствами'", "'Источник: текущая завершённая попытка контрольного этапа, синхронизируемая между устройствами'"],
  ["'Источник: migrated legacy task evidence; рекомендуется подтвердить новым report'", "'Источник: перенесённый результат из старой версии; рекомендуется подтвердить новым отчётом'"],
  ["'Последняя completed attempt не пройдена; historical best не открывает текущий gate'", "'Последняя завершённая попытка не пройдена; исторический максимум не открывает текущий этап'"],
  ["'Checkpoint evidence ещё не получено'", "'Подтверждённый результат контрольного этапа ещё не получен'"],
  ["'Новый executable report отсутствует'", "'Новый исполняемый отчёт отсутствует'"]
];

let source = readFileSync(path, 'utf8');
for (const [needle, replacement, expected = 1] of replacements) {
  const count = source.split(needle).length - 1;
  if (count !== expected) throw new Error(`${path}: expected ${expected} occurrence(s), found ${count}: ${needle}`);
  source = expected === 1 ? source.replace(needle, replacement) : source.split(needle).join(replacement);
}
writeFileSync(path, source);

replaceOne(
  'scripts/validate-learning-path.ts',
  "const readinessExplainerSource = readFileSync(new URL('../src/components/ReadinessExplainer.tsx', import.meta.url), 'utf8');",
  "const skillEvidenceSource = readFileSync(new URL('../src/lib/skill-evidence.ts', import.meta.url), 'utf8');\nfor (const forbidden of [\n  'lesson mastery loop',\n  'passed checkpoint evidence',\n  'completed assessment evidence',\n  'предыдущий checkpoint',\n  'practice mastery',\n  'Checkpoint score',\n  'completed checkpoint attempt',\n  'migrated legacy task evidence',\n  'historical best',\n  'current gate',\n  'Checkpoint evidence',\n  'executable report'\n]) {\n  if (skillEvidenceSource.includes(forbidden)) failures.push(`Skill evidence retained internal learner copy: ${forbidden}`);\n}\nfor (const required of [\n  'цикл освоения урока',\n  'подтверждённого результата контрольного этапа',\n  'результата итоговой проверки',\n  'самостоятельной практикой',\n  'Результат контрольного этапа',\n  'исторический максимум',\n  'Новый исполняемый отчёт отсутствует'\n]) {\n  if (!skillEvidenceSource.includes(required)) failures.push(`Skill evidence is missing localized explanation: ${required}`);\n}\n\nconst readinessExplainerSource = readFileSync(new URL('../src/components/ReadinessExplainer.tsx', import.meta.url), 'utf8');"
);

console.log('Skill-evidence blockers and completion criteria localized without changing thresholds or IDs.');
