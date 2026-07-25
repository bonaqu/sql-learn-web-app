import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/components/SyllabusPortal.tsx';
let source = readFileSync(path, 'utf8');
const importBefore = "import { useDialogFocus } from '../lib/dialog-focus';\nimport '../syllabus.css';";
const importAfter = "import { useDialogFocus } from '../lib/dialog-focus';\nimport LearningReportButton from './LearningReportButton';\nimport '../syllabus.css';";
if (source.split(importBefore).length - 1 !== 1) throw new Error('Syllabus import anchor missing');
source = source.replace(importBefore, importAfter);
const bodyBefore = `    <section className="syllabus-certificate-criteria" aria-label="Критерии сертификата">
      {completeReadiness.criteria.map(item => <article key={item.id} className={item.passed ? 'passed' : ''}>
        {item.passed ? <CheckCircle2 /> : <LockKeyhole />}
        <span><strong>{item.title}</strong><small>{item.current} / {item.target}{item.unit === '%' ? '%' : ''}</small></span>
      </article>)}
    </section>`;
const bodyAfter = `    <section className="syllabus-certificate-criteria" aria-label="Критерии сертификата">
      {completeReadiness.criteria.map(item => <article key={item.id} className={item.passed ? 'passed' : ''}>
        {item.passed ? <CheckCircle2 /> : <LockKeyhole />}
        <span><strong>{item.title}</strong><small>{item.current} / {item.target}{item.unit === '%' ? '%' : ''}</small></span>
      </article>)}
    </section>
    <LearningReportButton readiness={completeReadiness} mastery={mastery} curriculum={curriculumProgress} reports={reports} />`;
if (source.split(bodyBefore).length - 1 !== 1) throw new Error('Certificate criteria anchor missing');
writeFileSync(path, source.replace(bodyBefore, bodyAfter));
