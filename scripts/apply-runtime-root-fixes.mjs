import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, before, after, label) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  writeFileSync(path, source.replace(before, after));
}

patch(
  'src/App.tsx',
  '  CheckCircle2,\n  ChevronRight,',
  '  CheckCircle2,\n  ChevronRight,\n  ClipboardCheck,',
  'App Assessment icon import'
);
patch(
  'src/App.tsx',
  '  Repeat2,\n  RotateCcw,',
  '  Repeat2,\n  RotateCcw,\n  Route,',
  'App Learning Path icon import'
);
patch(
  'src/App.tsx',
  "} from './lib/progress';",
  "} from './lib/progress';\nimport { openDeferredFeature, preloadDeferredFeature } from './lib/deferred-features';",
  'App deferred feature helpers'
);
patch(
  'src/App.tsx',
  "const Editor = lazy(() => import('@monaco-editor/react'));",
  "const Editor = lazy(() => import('./components/SqlEditor'));",
  'App natural Monaco boundary'
);
patch(
  'src/App.tsx',
  '        <Nav icon={<Home />} label="Главная" active={view === \'home\'} onClick={() => navigate(\'home\')} />\n        <Nav icon={<BookOpen />} label="Каталог"',
  '        <Nav icon={<Home />} label="Главная" active={view === \'home\'} onClick={() => navigate(\'home\')} />\n        <button type="button" data-testid="learning-path-trigger" onMouseEnter={() => preloadDeferredFeature(\'learning-path\')} onFocus={() => preloadDeferredFeature(\'learning-path\')} onClick={() => openDeferredFeature(\'learning-path\')}><Route /><span>Учебный путь</span></button>\n        <Nav icon={<BookOpen />} label="Каталог"',
  'App desktop Learning Path trigger'
);
patch(
  'src/App.tsx',
  '        <Nav icon={<BriefcaseBusiness />} label="Interview" active={view === \'interview\'} onClick={() => navigate(\'interview\')} />\n        <Nav icon={<Puzzle />}',
  '        <Nav icon={<BriefcaseBusiness />} label="Interview" active={view === \'interview\'} onClick={() => navigate(\'interview\')} />\n        <button type="button" data-testid="assessment-trigger" onMouseEnter={() => preloadDeferredFeature(\'assessment\')} onFocus={() => preloadDeferredFeature(\'assessment\')} onClick={() => openDeferredFeature(\'assessment\')}><ClipboardCheck /><span>Assessment Center</span></button>\n        <Nav icon={<Puzzle />}',
  'App desktop Assessment trigger'
);
patch(
  'src/App.tsx',
  '      <MobileNav icon={<Home />} label="Главная" active={view === \'home\'} onClick={() => navigate(\'home\')} />\n      <MobileNav icon={<BrainCircuit />}',
  '      <MobileNav icon={<Home />} label="Главная" active={view === \'home\'} onClick={() => navigate(\'home\')} />\n      <button type="button" data-testid="learning-path-mobile-trigger" onTouchStart={() => preloadDeferredFeature(\'learning-path\')} onFocus={() => preloadDeferredFeature(\'learning-path\')} onClick={() => openDeferredFeature(\'learning-path\')}><span className="mobile-nav-icon"><Route /></span><small>Путь</small></button>\n      <MobileNav icon={<BrainCircuit />}',
  'App mobile Learning Path trigger'
);
patch(
  'src/App.tsx',
  '      <MobileNav icon={<Repeat2 />} label="Повтор" active={view === \'review\'} badge={queue.length} onClick={() => navigate(\'review\')} />\n      <MobileNav icon={<Sparkles />}',
  '      <MobileNav icon={<Repeat2 />} label="Повтор" active={view === \'review\'} badge={queue.length} onClick={() => navigate(\'review\')} />\n      <button type="button" data-testid="assessment-mobile-trigger" onTouchStart={() => preloadDeferredFeature(\'assessment\')} onFocus={() => preloadDeferredFeature(\'assessment\')} onClick={() => openDeferredFeature(\'assessment\')}><span className="mobile-nav-icon"><ClipboardCheck /></span><small>Экзамен</small></button>\n      <MobileNav icon={<Sparkles />}',
  'App mobile Assessment trigger'
);

patch(
  'src/components/AssessmentCenterPortal.tsx',
  "const Editor = lazy(() => import('@monaco-editor/react'));",
  "const Editor = lazy(() => import('./SqlEditor'));",
  'Assessment natural Monaco boundary'
);

patch(
  'src/components/AuthGate.tsx',
  '      <div className="auth-tabs" role="tablist" aria-label="Режим авторизации">\n        <button type="button" role="tab" aria-selected={mode === \'login\'} className={mode === \'login\' ? \'active\' : \'\'} onClick={() => switchMode(\'login\')}>Вход</button>\n        <button type="button" role="tab" aria-selected={mode === \'register\'} className={mode === \'register\' ? \'active\' : \'\'} onClick={() => switchMode(\'register\')}>Регистрация</button>\n      </div>',
  '      <div className="auth-tabs" role="group" aria-label="Режим авторизации">\n        <button type="button" aria-pressed={mode === \'login\'} className={mode === \'login\' ? \'active\' : \'\'} onClick={() => switchMode(\'login\')}>Вход</button>\n        <button type="button" aria-pressed={mode === \'register\'} className={mode === \'register\' ? \'active\' : \'\'} onClick={() => switchMode(\'register\')}>Регистрация</button>\n      </div>',
  'Auth mode buttons'
);
patch(
  'src/components/AuthGate.tsx',
  '      <nav className="profile-tabs" role="tablist" aria-label="Разделы профиля">\n        <button role="tab" aria-selected={tab === \'profile\'} className={tab === \'profile\' ? \'active\' : \'\'} onClick={() => setTab(\'profile\')}><User />Профиль</button>\n        <button role="tab" aria-selected={tab === \'security\'} className={tab === \'security\' ? \'active\' : \'\'} onClick={() => setTab(\'security\')}><ShieldCheck />Безопасность</button>\n        <button role="tab" aria-selected={tab === \'sessions\'} className={tab === \'sessions\' ? \'active\' : \'\'} onClick={() => setTab(\'sessions\')}><MonitorSmartphone />Сессии</button>\n      </nav>',
  '      <nav className="profile-tabs" aria-label="Разделы профиля">\n        <button aria-pressed={tab === \'profile\'} className={tab === \'profile\' ? \'active\' : \'\'} onClick={() => setTab(\'profile\')}><User />Профиль</button>\n        <button aria-pressed={tab === \'security\'} className={tab === \'security\' ? \'active\' : \'\'} onClick={() => setTab(\'security\')}><ShieldCheck />Безопасность</button>\n        <button aria-pressed={tab === \'sessions\'} className={tab === \'sessions\' ? \'active\' : \'\'} onClick={() => setTab(\'sessions\')}><MonitorSmartphone />Сессии</button>\n      </nav>',
  'Profile section buttons'
);

patch(
  'tests/e2e/accessibility-pwa.spec.ts',
  "  expect(initialResources.some(name => /assessment-|learning-path-|sqlite-/i.test(name))).toBe(false);",
  "  expect(initialResources.some(name => /assessment-|learning-path-|sqlite-|SqlEditor-/i.test(name))).toBe(false);",
  'initial lazy resources assertion'
);
patch(
  'tests/e2e/accessibility-pwa.spec.ts',
  "  await expect.poll(async () => (await resourceNames(page)).some(name => /sqlite-/i.test(name))).toBe(true);",
  "  await expect.poll(async () => (await resourceNames(page)).some(name => /sqlite-/i.test(name))).toBe(true);\n  await expect.poll(async () => (await resourceNames(page)).some(name => /SqlEditor-/i.test(name))).toBe(true);",
  'SqlEditor lazy resource assertion'
);

patch(
  'scripts/validate-bundle.mjs',
  "for (const boundary of ['assessment', 'learning-path', 'sqlite', 'charts']) {",
  "for (const boundary of ['assessment', 'learning-path', 'sqlite', 'charts', 'SqlEditor']) {",
  'bundle boundary list'
);
patch(
  'scripts/validate-bundle.mjs',
  "for (const heavy of ['assessment-', 'learning-path-', 'sqlite-', 'charts-']) {",
  "for (const heavy of ['assessment-', 'learning-path-', 'sqlite-', 'charts-', 'SqlEditor-']) {",
  'eager heavy chunk list'
);

console.log('Applied stable feature events, natural Monaco boundary and semantic button fixes.');
