import { readFileSync, writeFileSync } from 'node:fs';

function replaceOne(path, needle, replacement) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(needle).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one occurrence, found ${count}: ${needle}`);
  writeFileSync(path, source.replace(needle, replacement));
}

replaceOne(
  'src/lib/learner-onboarding.ts',
  "{ id: 'support', title: 'Support SQL',",
  "{ id: 'support', title: 'SQL для поддержки',"
);
replaceOne(
  'src/lib/learner-onboarding.ts',
  "{ id: 'backend', title: 'Backend SQL',",
  "{ id: 'backend', title: 'SQL для бэкенда',"
);
replaceOne(
  'src/components/OnboardingPortal.tsx',
  "{ready ? 'Синхронизировать план' : 'Принять стартовый контракт'}",
  "{ready ? 'Синхронизировать план' : 'Принять стартовый план'}"
);
replaceOne(
  'src/components/OnboardingPortal.tsx',
  'SQL Academy · Стартовый контракт',
  'SQL Academy · Стартовый план'
);
replaceOne(
  'scripts/validate-onboarding.ts',
  "  'Начать с foundation',\n",
  "  'Начать с foundation',\n  'Support SQL',\n  'Backend SQL',\n  'Стартовый контракт',\n"
);
replaceOne(
  'scripts/validate-onboarding.ts',
  "  'Начать с базового уровня без диагностики'\n",
  "  'Начать с базового уровня без диагностики',\n  'SQL Academy · Стартовый план',\n  'Принять стартовый план'\n"
);

console.log('Final onboarding copy migration applied.');
