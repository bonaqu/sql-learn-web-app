import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { capstoneContractList } from '../src/data/capstone-contracts.ts';
import { capstoneProjects } from '../src/data/complete-curriculum.ts';
import { capstoneWorkspaceTemplate } from '../src/data/capstone-workspace-templates.ts';
import {
  evaluateCapstone,
  type CapstoneReport,
  type CapstoneSubmission
} from '../src/lib/capstone-evaluator.ts';
import { calculateCompleteReadiness } from '../src/lib/complete-readiness.ts';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress.ts';
import { defaultProgress } from '../src/lib/progress.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });
const userId = '12345678-1234-4234-9234-123456789abc';

function reflectionFor(contract: (typeof capstoneContractList)[number]) {
  const keywords = contract.reflection.requiredIdeas.map(idea => idea.keywords[0]).join('. ');
  const explanation = `${keywords}. Результат проверяется на публичных и скрытых данных, ограничения описаны явно, а порядок остаётся детерминированным. `;
  return explanation.repeat(Math.ceil((contract.reflection.minimumCharacters + 40) / explanation.length));
}

function solutionFiles(contract: (typeof capstoneContractList)[number]) {
  return Object.fromEntries(contract.files.map(file => [
    file.id,
    file.kind === 'schema' ? file.starterSql : file.referenceSql || file.starterSql
  ]));
}

async function reportFor(
  contract: (typeof capstoneContractList)[number],
  overrides: Partial<CapstoneSubmission> = {}
): Promise<CapstoneReport> {
  const submission: CapstoneSubmission = {
    projectId: contract.projectId,
    files: solutionFiles(contract),
    reflection: reflectionFor(contract),
    startedAt: '2026-07-25T12:00:00.000Z',
    guidanceUses: 0,
    solutionViews: 0,
    ...overrides
  };
  return evaluateCapstone({
    SQL,
    submission,
    userId,
    completedAt: '2026-07-25T12:30:00.000Z'
  });
}

assert(capstoneContractList.length === capstoneProjects.length, 'Every capstone project must have one evaluator contract');
assert(new Set(capstoneContractList.map(contract => contract.projectId)).size === capstoneContractList.length, 'Capstone project IDs must be unique');

const globalFileIds = new Set<string>();
const passedReports: CapstoneReport[] = [];
for (const contract of capstoneContractList) {
  const project = capstoneProjects.find(item => item.id === contract.projectId);
  assert(Boolean(project), `${contract.projectId}: missing Project Lab definition`);
  assert(contract.files.length === 3, `${contract.projectId}: exactly three SQL artifacts are required`);
  assert(contract.datasets.some(dataset => !dataset.hidden), `${contract.projectId}: public dataset is required`);
  assert(contract.datasets.some(dataset => dataset.hidden), `${contract.projectId}: hidden dataset is required`);
  assert(contract.files.reduce((sum, file) => sum + file.weight, 0) + contract.reflection.weight === 100, `${contract.projectId}: weights must sum to 100`);
  assert(contract.reflection.minimumCharacters >= 180, `${contract.projectId}: reflection contract is too weak`);
  assert(contract.reflection.requiredIdeas.length >= 4, `${contract.projectId}: reflection must cover at least four ideas`);

  for (const file of contract.files) {
    assert(!globalFileIds.has(file.id), `Duplicate capstone file ID ${file.id}`);
    globalFileIds.add(file.id);
    assert(file.requiredColumns?.length, `${file.id}: required result columns are missing`);
    assert(file.remediation.length >= 40, `${file.id}: remediation is too vague`);
    const solution = file.kind === 'schema' ? file.starterSql : file.referenceSql || file.starterSql;
    const template = capstoneWorkspaceTemplate(file.id, file.starterSql);
    assert(normalized(template) !== normalized(solution), `${file.id}: learner template exposes the reference solution`);
    assert(/TODO/i.test(template), `${file.id}: learner template must show unfinished work`);
  }

  try {
    const report = await reportFor(contract);
    passedReports.push(report);
    assert(report.passed, `${contract.projectId}: reference submission did not pass (${report.score})`);
    assert(report.score === 100, `${contract.projectId}: reference submission must score 100, got ${report.score}`);
    assert(report.files.every(file => file.passed), `${contract.projectId}: a reference artifact failed`);
    assert(report.checks.some(check => check.hidden), `${contract.projectId}: report contains no hidden evidence`);
    assert(Object.keys(report.submissionFiles).length === contract.files.length, `${contract.projectId}: immutable SQL snapshot is incomplete`);

    const assisted = await reportFor(contract, { solutionViews: 1 });
    assert(!assisted.passed, `${contract.projectId}: solution-assisted attempt must not pass independence gate`);
    assert(assisted.independence < 60, `${contract.projectId}: solution view did not reduce independence below passing`);
    assert(assisted.provenance === 'solution-assisted', `${contract.projectId}: solution provenance was not preserved`);

    const brokenFiles = { ...solutionFiles(contract), [contract.files[0].id]: '' };
    const broken = await reportFor(contract, { files: brokenFiles });
    assert(!broken.passed, `${contract.projectId}: empty required artifact unexpectedly passed`);
    assert(broken.remediation.length > 0, `${contract.projectId}: failed attempt contains no remediation`);
  } catch (reason) {
    failures.push(`${contract.projectId}: evaluator crashed (${reason instanceof Error ? reason.message : String(reason)})`);
  }
}

assert(globalFileIds.size === 9, `Expected 9 globally unique capstone files, got ${globalFileIds.size}`);
assert(passedReports.length === capstoneProjects.length, 'Reference report generation is incomplete');

const legacyCheckboxProgress = {
  ...emptyCurriculumProgress(),
  completedProjects: capstoneProjects.map(project => project.id)
};
const legacyReadiness = calculateCompleteReadiness(defaultProgress, legacyCheckboxProgress, [], [], []);
assert(legacyReadiness.projectCompletion === 0, 'Legacy completedProjects checkbox must not create capstone readiness');
assert(!legacyReadiness.criteria.find(item => item.id === 'projects')?.passed, 'Legacy project checkbox must not satisfy certificate criterion');

const reportReadiness = calculateCompleteReadiness(defaultProgress, emptyCurriculumProgress(), [], [], passedReports);
assert(reportReadiness.projectCompletion === 100, 'Passed reports must produce 100% capstone completion');
assert(reportReadiness.criteria.find(item => item.id === 'projects')?.passed, 'Passed reports must satisfy capstone certificate criterion');

if (failures.length) {
  console.error(`Capstone validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Capstones validated: ${capstoneContractList.length} projects, ${globalFileIds.size} SQL artifacts, public/hidden datasets, immutable snapshots, provenance gate and report-only readiness.`);
