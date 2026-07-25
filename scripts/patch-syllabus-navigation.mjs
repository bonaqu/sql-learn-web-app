import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/App.tsx';
const source = readFileSync(path, 'utf8');
const before = `        <button type="button" data-testid="curriculum-trigger" onMouseEnter={() => preloadDeferredFeature('curriculum')} onFocus={() => preloadDeferredFeature('curriculum')} onClick={() => openDeferredFeature('curriculum')}><GraduationCap /><span>Уроки и проекты</span></button>
        <Nav icon={<BookOpen />} label="Каталог" active={view === 'catalog'} onClick={() => navigate('catalog')} />`;
const after = `        <button type="button" data-testid="curriculum-trigger" onMouseEnter={() => preloadDeferredFeature('curriculum')} onFocus={() => preloadDeferredFeature('curriculum')} onClick={() => openDeferredFeature('curriculum')}><GraduationCap /><span>Уроки и проекты</span></button>
        <button type="button" data-testid="syllabus-trigger" onMouseEnter={() => preloadDeferredFeature('syllabus')} onFocus={() => preloadDeferredFeature('syllabus')} onClick={() => openDeferredFeature('syllabus')}><ListChecks /><span>Карта курса и диалекты</span></button>
        <Nav icon={<BookOpen />} label="Каталог" active={view === 'catalog'} onClick={() => navigate('catalog')} />`;
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`Expected one curriculum navigation block, got ${count}`);
writeFileSync(path, source.replace(before, after));
