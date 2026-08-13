import type { CapstoneReport } from './capstone-evaluator';

function fencedSql(sql: string) {
  return `\`\`\`sql\n${sql.trim()}\n\`\`\``;
}

function safeFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sql-capstone';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function privacySafePortfolioText(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?7|8)[\s()-]*\d{3}[\s()-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g, '[REDACTED_PHONE]')
    .replace(/\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[^\s,'";]+/gi, match => `${match.split(/[:=]/, 1)[0]}=[REDACTED_SECRET]`)
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_TOKEN]');
}

export function capstonePortfolioMarkdown(report: CapstoneReport, projectTitle: string) {
  const files = report.files.map(file => {
    const sql = privacySafePortfolioText(report.submissionFiles[file.fileId] || '');
    return `## ${file.title}\n\n- Тип: ${file.kind}\n- Score: ${file.score}/${file.maxScore}\n- Contract: ${file.passed ? 'passed' : 'failed'}\n\n${fencedSql(sql)}`;
  }).join('\n\n');

  return `# ${projectTitle}\n\n` +
    `## Verified result\n\n` +
    `- Score: ${report.score}/${report.passingScore} passing\n` +
    `- Status: ${report.passed ? 'PASSED' : 'FAILED'}\n` +
    `- Provenance: ${report.provenance}\n` +
    `- Independence: ${report.independence}%\n` +
    `- Completed: ${report.completedAt}\n` +
    `- Attempt: ${report.attemptNumber}\n\n` +
    `${files}\n\n` +
    `## Privacy and provenance\n\nThis export omits account identifiers and redacts common email, phone, token, password and API-key patterns. Provenance labels reflect recorded guidance and solution use.\n\n` +
    `## Engineering reflection\n\n${privacySafePortfolioText(report.reflection.trim())}\n\n` +
    `## Automated evidence\n\n` +
    report.checks.map(check => `- ${check.passed ? 'PASS' : 'FAIL'} · ${check.title}: ${check.message}`).join('\n') +
    '\n';
}

export function capstoneSqlBundle(report: CapstoneReport, projectTitle: string) {
  return Object.entries(report.submissionFiles).map(([fileId, sql]) => [
    `-- ============================================================`,
    `-- ${projectTitle}`,
    `-- Artifact: ${fileId}`,
    `-- Verified report: ${report.id}`,
    `-- Score: ${report.score} · ${report.provenance} · independence ${report.independence}%`,
    `-- ============================================================`,
    privacySafePortfolioText(sql.trim()),
    ''
  ].join('\n')).join('\n');
}

export function downloadPortfolioText(contents: string, filename: string, mimeType: string) {
  const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCapstoneMarkdown(report: CapstoneReport, projectTitle: string) {
  downloadPortfolioText(
    capstonePortfolioMarkdown(report, projectTitle),
    `${safeFileName(projectTitle)}-portfolio.md`,
    'text/markdown'
  );
}

export function downloadCapstoneSql(report: CapstoneReport, projectTitle: string) {
  downloadPortfolioText(
    capstoneSqlBundle(report, projectTitle),
    `${safeFileName(projectTitle)}-verified.sql`,
    'application/sql'
  );
}

export function printCapstonePortfolio(report: CapstoneReport, projectTitle: string) {
  const popup = window.open('', '_blank', 'width=980,height=760');
  if (!popup) throw new Error('Браузер заблокировал окно печати');
  popup.opener = null;
  const fileSections = report.files.map(file => `<section>
    <h2>${escapeHtml(file.title)}</h2>
    <p>${file.passed ? 'Passed' : 'Failed'} · ${file.score}/${file.maxScore}</p>
    <pre>${escapeHtml(privacySafePortfolioText(report.submissionFiles[file.fileId] || ''))}</pre>
  </section>`).join('');
  popup.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(projectTitle)}</title>
  <style>body{font:15px/1.55 system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 24px;color:#111}h1,h2{line-height:1.2}header{border-bottom:2px solid #111;margin-bottom:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f4f6;padding:16px;border-radius:8px}section{break-inside:avoid;margin:24px 0}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}@media print{body{margin:0;max-width:none}.no-print{display:none}}</style></head><body>
  <header><h1>${escapeHtml(projectTitle)}</h1><div class="meta"><span>Score: ${report.score}</span><span>Status: ${report.passed ? 'PASSED' : 'FAILED'}</span><span>Provenance: ${escapeHtml(report.provenance)}</span><span>Independence: ${report.independence}%</span></div></header>
  ${fileSections}<section><h2>Privacy and provenance</h2><p>Account identifiers are omitted. Common private-data and secret patterns are redacted. The provenance label reflects recorded guidance and solution use.</p></section><section><h2>Engineering reflection</h2><p>${escapeHtml(privacySafePortfolioText(report.reflection))}</p></section>
  <button class="no-print" onclick="window.print()">Печать / сохранить как PDF</button></body></html>`);
  popup.document.close();
  popup.focus();
}
