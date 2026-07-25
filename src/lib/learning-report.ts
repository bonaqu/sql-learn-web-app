import type { AssessmentReport } from './assessment';
import type { CompleteReadiness } from './complete-readiness';
import type { CurriculumProgressV1 } from './curriculum-progress';
import type { ModuleMastery } from './learning-path';

export type LearningReportInput = {
  readiness: CompleteReadiness;
  mastery: ModuleMastery[];
  curriculum: CurriculumProgressV1;
  reports: AssessmentReport[];
};

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function bestExamRows(reports: AssessmentReport[]) {
  const best = new Map<string, AssessmentReport>();
  for (const report of reports) {
    const current = best.get(report.mode);
    if (!current || report.score > current.score) best.set(report.mode, report);
  }
  return Array.from(best.values()).sort((left, right) => left.mode.localeCompare(right.mode));
}

export function exportLearningReport(input: LearningReportInput) {
  const generatedAt = new Date();
  const moduleRows = [...input.mastery]
    .sort((left, right) => right.mastery - left.mastery || left.title.localeCompare(right.title))
    .map(module => `<tr><td>${escapeHtml(module.title)}</td><td>${module.mastery}%</td><td>${module.solved}/${module.total}</td><td>${module.accuracy}%</td><td>${module.hints}</td></tr>`)
    .join('');
  const criteriaRows = input.readiness.criteria
    .map(item => `<tr><td>${item.passed ? '✓' : '—'}</td><td>${escapeHtml(item.title)}</td><td>${item.current}</td><td>${item.target}</td></tr>`)
    .join('');
  const examRows = bestExamRows(input.reports)
    .map(report => `<tr><td>${escapeHtml(report.mode)}</td><td>${report.score}</td><td>${report.accuracy}%</td><td>${report.independence}%</td><td>${escapeHtml(report.completedAt.slice(0, 10))}</td></tr>`)
    .join('') || '<tr><td colspan="5">Экзаменационные отчёты пока отсутствуют.</td></tr>';

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SQL Academy — Learning Report</title>
<style>
body{max-width:1100px;margin:0 auto;padding:40px 28px;font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#18181b;background:#fff}h1{font-size:42px;letter-spacing:-.04em;margin:0 0 8px}h2{margin-top:34px}.meta{color:#52525b}.score{display:inline-block;margin:22px 0;padding:14px 18px;border:2px solid #18181b;border-radius:12px;font-size:28px;font-weight:900}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.grid div{padding:12px;border:1px solid #d4d4d8;border-radius:8px}.grid strong,.grid span{display:block}.grid span{color:#52525b;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:9px;border-bottom:1px solid #d4d4d8;text-align:left;font-size:13px}th{background:#f4f4f5}.privacy{margin-top:36px;padding:14px;border-radius:8px;background:#f4f4f5;color:#3f3f46}@media print{body{padding:0}.privacy{break-inside:avoid}}
</style></head><body>
<h1>SQL Academy Learning Report</h1>
<p class="meta">Сформирован ${escapeHtml(generatedAt.toLocaleString('ru-RU'))}. Отчёт намеренно не содержит имя, login, email, employer или другие персональные данные.</p>
<div class="score">Complete Readiness: ${input.readiness.total}%</div>
<div class="grid">
<div><strong>${input.readiness.taskReadiness}%</strong><span>Task mastery</span></div>
<div><strong>${input.readiness.lessonCompletion}%</strong><span>Lessons</span></div>
<div><strong>${input.readiness.checkpointCompletion}%</strong><span>Checkpoints</span></div>
<div><strong>${input.readiness.projectCompletion}%</strong><span>Projects</span></div>
<div><strong>${input.readiness.examReadiness}%</strong><span>Exams</span></div>
</div>
<h2>Certificate criteria</h2><table><thead><tr><th>Статус</th><th>Критерий</th><th>Текущее</th><th>Цель</th></tr></thead><tbody>${criteriaRows}</tbody></table>
<h2>Mastery по модулям</h2><table><thead><tr><th>Модуль</th><th>Mastery</th><th>Решено</th><th>Точность</th><th>Подсказки</th></tr></thead><tbody>${moduleRows}</tbody></table>
<h2>Лучшие assessment results</h2><table><thead><tr><th>Режим</th><th>Score</th><th>Accuracy</th><th>Independence</th><th>Дата</th></tr></thead><tbody>${examRows}</tbody></table>
<h2>Curriculum state</h2><p>Завершено уроков: ${input.curriculum.completedLessons.length}. Завершено разделов: ${input.curriculum.completedSections.length}. Capstone-проектов: ${input.curriculum.completedProjects.length}.</p>
<p class="privacy">Privacy-first export: файл создаётся локально в браузере. SQL drafts, notes, session token, recovery-коды и пользовательские идентификаторы в отчёт не включаются.</p>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sql-academy-learning-report-${generatedAt.toISOString().slice(0, 10)}.html`;
  link.click();
  URL.revokeObjectURL(url);
}
