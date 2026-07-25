import { Download } from 'lucide-react';
import type { AssessmentReport } from '../lib/assessment';
import type { CompleteReadiness } from '../lib/complete-readiness';
import type { CurriculumProgressV1 } from '../lib/curriculum-progress';
import { exportLearningReport } from '../lib/learning-report';
import type { ModuleMastery } from '../lib/learning-path';

export default function LearningReportButton({
  readiness,
  mastery,
  curriculum,
  reports
}: {
  readiness: CompleteReadiness;
  mastery: ModuleMastery[];
  curriculum: CurriculumProgressV1;
  reports: AssessmentReport[];
}) {
  return <button
    type="button"
    className="syllabus-report-export"
    onClick={() => exportLearningReport({ readiness, mastery, curriculum, reports })}
  ><Download />Экспортировать анонимный learning report</button>;
}
