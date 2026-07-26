import type { CapstoneReport } from './capstone-evaluator';

export function bestCapstoneReport(projectId: string, reports: CapstoneReport[]) {
  return reports
    .filter(report => report.projectId === projectId && report.status === 'passed' && report.passed)
    .sort((left, right) => right.score - left.score || right.completedAt.localeCompare(left.completedAt))[0] || null;
}

export function passedCapstoneReports(reports: CapstoneReport[]) {
  return reports.filter(report => report.status === 'passed' && report.passed);
}
