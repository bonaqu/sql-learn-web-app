import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, before, after, label) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
  writeFileSync(path, source.replace(before, after));
}

patch('src/lib/assessment.ts',
`import { modules, SqlTask, tasks } from '../data/course-catalog';
import { loadAuthSession } from './auth';`,
`import { modules, SqlTask, tasks } from '../data/course-catalog';
import { sqlExams } from '../data/sql-exams';
import { loadAuthSession } from './auth';`,
'assessment exam import');

patch('src/lib/assessment.ts',
`export type AssessmentMode = 'quick' | 'interview' | 'exam';`,
`export type AssessmentMode = 'quick' | 'interview' | 'exam' | 'diagnostic' | 'production' | 'final';`,
'assessment mode union');

patch('src/lib/assessment.ts',
`  minimumCompleted: number;
  minimumModules: number;
};`,
`  minimumCompleted: number;
  minimumModules: number;
  passingScore: number;
  requiredModuleIds?: string[];
  fixedTaskIds?: string[];
};`,
'assessment config fields');

patch('src/lib/assessment.ts',
`    minimumCompleted: 0,
    minimumModules: 0
  },`,
`    minimumCompleted: 0,
    minimumModules: 0,
    passingScore: 50
  },`,
'quick passing score');
patch('src/lib/assessment.ts',
`    minimumCompleted: 6,
    minimumModules: 2
  },`,
`    minimumCompleted: 6,
    minimumModules: 2,
    passingScore: 65
  },`,
'interview passing score');
patch('src/lib/assessment.ts',
`    minimumCompleted: 12,
    minimumModules: 4
  }
};`,
`    minimumCompleted: 12,
    minimumModules: 4,
    passingScore: 70
  },
  diagnostic: {
    mode: 'diagnostic',
    title: sqlExams[0].title,
    shortTitle: 'Diagnostic',
    description: sqlExams[0].description,
    durationMinutes: sqlExams[0].durationMinutes,
    taskCount: sqlExams[0].taskIds.length,
    interviewer: false,
    minimumCompleted: 0,
    minimumModules: 0,
    passingScore: sqlExams[0].passingScore,
    requiredModuleIds: sqlExams[0].requiredModuleIds,
    fixedTaskIds: sqlExams[0].taskIds
  },
  production: {
    mode: 'production',
    title: sqlExams[1].title,
    shortTitle: 'Production',
    description: sqlExams[1].description,
    durationMinutes: sqlExams[1].durationMinutes,
    taskCount: sqlExams[1].taskIds.length,
    interviewer: false,
    minimumCompleted: 96,
    minimumModules: 16,
    passingScore: sqlExams[1].passingScore,
    requiredModuleIds: sqlExams[1].requiredModuleIds,
    fixedTaskIds: sqlExams[1].taskIds
  },
  final: {
    mode: 'final',
    title: sqlExams[2].title,
    shortTitle: 'Final',
    description: sqlExams[2].description,
    durationMinutes: sqlExams[2].durationMinutes,
    taskCount: sqlExams[2].taskIds.length,
    interviewer: false,
    minimumCompleted: 180,
    minimumModules: 26,
    passingScore: sqlExams[2].passingScore,
    requiredModuleIds: sqlExams[2].requiredModuleIds,
    fixedTaskIds: sqlExams[2].taskIds
  }
};`,
'graded assessment configs');

patch('src/lib/assessment.ts',
`const PHASE_MODULES = [
  new Set(['sql-thinking', 'select', 'filtering', 'sorting', 'aggregates', 'grouping']),
  new Set(['joins', 'subqueries', 'cte', 'windows', 'dates', 'text']),
  new Set(['set-ops', 'data-quality', 'indexes', 'explain', 'transactions', 'schema']),
  new Set(['support', 'final'])
];`,
`const PHASE_MODULES = [
  new Set(['sql-thinking', 'select', 'filtering', 'sorting', 'aggregates', 'grouping']),
  new Set(['joins', 'subqueries', 'cte', 'windows', 'dates', 'text', 'set-ops']),
  new Set(['data-quality', 'indexes', 'explain', 'transactions', 'schema']),
  new Set(['support', 'final']),
  new Set(['dml', 'schema-evolution', 'null-logic-advanced']),
  new Set(['conditional-aggregation', 'advanced-joins', 'recursive-cte']),
  new Set(['window-frames', 'json-sql', 'sql-security']),
  new Set(['concurrency', 'pagination-patterns', 'incident-investigation'])
];`,
'assessment phase groups');

patch('src/lib/assessment.ts',
`function completedModuleCount(progress: Progress) {
  const completed = new Set(progress.completed);
  return modules.filter(([id]) => tasks.some(task => task.module === id && completed.has(task.id))).length;
}

export function assessmentEligibility(mode: AssessmentMode, progress: Progress) {
  const config = assessmentModes[mode];
  const modulesCompleted = completedModuleCount(progress);
  const missingCompleted = Math.max(0, config.minimumCompleted - progress.completed.length);
  const missingModules = Math.max(0, config.minimumModules - modulesCompleted);
  return {
    eligible: missingCompleted === 0 && missingModules === 0,
    completed: progress.completed.length,
    modulesCompleted,
    missingCompleted,
    missingModules
  };
}`,
`function moduleCoverage(progress: Progress, moduleId: string) {
  const moduleTasks = tasks.filter(task => task.module === moduleId);
  const completed = new Set(progress.completed);
  return moduleTasks.length ? completed.size && moduleTasks.filter(task => completed.has(task.id)).length / moduleTasks.length : 0;
}

function completedModuleCount(progress: Progress) {
  return modules.filter(([id]) => moduleCoverage(progress, id) >= 0.45).length;
}

export function assessmentEligibility(mode: AssessmentMode, progress: Progress) {
  const config = assessmentModes[mode];
  const modulesCompleted = completedModuleCount(progress);
  const missingCompleted = Math.max(0, config.minimumCompleted - progress.completed.length);
  const missingModules = Math.max(0, config.minimumModules - modulesCompleted);
  const missingRequiredModules = (config.requiredModuleIds || []).filter(moduleId => moduleCoverage(progress, moduleId) < 0.45);
  return {
    eligible: missingCompleted === 0 && missingModules === 0 && missingRequiredModules.length === 0,
    completed: progress.completed.length,
    modulesCompleted,
    missingCompleted,
    missingModules,
    missingRequiredModules
  };
}`,
'assessment prerequisites');

patch('src/lib/assessment.ts',
`function eligiblePool(mode: AssessmentMode) {
  if (mode === 'quick') return tasks.filter(task => task.mode !== 'puzzle');
  if (mode === 'interview') return tasks.filter(task => task.mode === 'interview' || task.mode === 'practice');
  return tasks.filter(task => task.mode !== 'lesson' && task.mode !== 'puzzle' && task.difficulty !== 'База');
}`,
`function eligiblePool(mode: AssessmentMode) {
  const fixed = assessmentModes[mode].fixedTaskIds;
  if (fixed?.length) return fixed.flatMap(taskId => tasks.find(task => task.id === taskId) || []);
  if (mode === 'quick') return tasks.filter(task => task.mode !== 'puzzle');
  if (mode === 'interview') return tasks.filter(task => task.mode === 'interview' || task.mode === 'practice');
  return tasks.filter(task => task.mode !== 'lesson' && task.mode !== 'puzzle' && task.difficulty !== 'База');
}`,
'fixed assessment pools');

patch('src/lib/assessment.ts',
`export function selectAssessmentTasks(mode: AssessmentMode, progress: Progress) {
  const config = assessmentModes[mode];
  const ranked = eligiblePool(mode)
    .map(task => ({ task, priority: taskPriority(task, progress, mode) }))
    .sort((left, right) => right.priority - left.priority || left.task.id.localeCompare(right.task.id))
    .map(item => item.task);
  return chooseDiverse(ranked, config.taskCount, mode);
}`,
`export function selectAssessmentTasks(mode: AssessmentMode, progress: Progress) {
  const config = assessmentModes[mode];
  const pool = eligiblePool(mode);
  if (config.fixedTaskIds?.length) return pool.slice(0, config.taskCount);
  const ranked = pool
    .map(task => ({ task, priority: taskPriority(task, progress, mode) }))
    .sort((left, right) => right.priority - left.priority || left.task.id.localeCompare(right.task.id))
    .map(item => item.task);
  return chooseDiverse(ranked, config.taskCount, mode);
}`,
'fixed assessment selection');

patch('worker/assessment.ts',
`type AssessmentMode = 'quick' | 'interview' | 'exam';`,
`type AssessmentMode = 'quick' | 'interview' | 'exam' | 'diagnostic' | 'production' | 'final';`,
'worker assessment mode union');
patch('worker/assessment.ts',
`const MODES = new Set<AssessmentMode>(['quick', 'interview', 'exam']);`,
`const MODES = new Set<AssessmentMode>(['quick', 'interview', 'exam', 'diagnostic', 'production', 'final']);`,
'worker assessment modes');
patch('worker/assessment.ts',
`    && report.taskScores.length <= 20
    && Array.isArray(report.moduleScores)
    && report.moduleScores.length <= 20;`,
`    && report.taskScores.length <= 40
    && Array.isArray(report.moduleScores)
    && report.moduleScores.length <= 40;`,
'worker report bounds');

patch('src/components/AssessmentCenterPortal.tsx',
`          <div className="assessment-mode-icon">{mode === 'quick' ? <AlarmClock /> : mode === 'interview' ? <BrainCircuit /> : <Trophy />}</div>`,
`          <div className="assessment-mode-icon">{mode === 'quick' ? <AlarmClock /> : mode === 'interview' ? <BrainCircuit /> : mode === 'diagnostic' ? <Target /> : mode === 'production' ? <ShieldCheck /> : <Trophy />}</div>`,
'assessment mode icons');
patch('src/components/AssessmentCenterPortal.tsx',
`            : <div className="assessment-locked"><LockKeyhole /><span>Нужно ещё {eligibility.missingCompleted} задач и {eligibility.missingModules} модулей</span></div>}`, 
`            : <div className="assessment-locked"><LockKeyhole /><span>Нужно ещё {eligibility.missingCompleted} задач, {eligibility.missingModules} модулей{eligibility.missingRequiredModules.length ? ' · prerequisites: ' + eligibility.missingRequiredModules.length : ''}</span></div>}`,
'assessment prerequisite message');

patch('scripts/validate-assessment.ts',
`const practiced: Progress = {
  ...defaultProgress,
  completed: tasks.slice(0, 30).map(task => task.id),
  taskStats: Object.fromEntries(tasks.slice(0, 30).map((task, index) => [task.id, {`,
`const practiced: Progress = {
  ...defaultProgress,
  completed: tasks.slice(0, 30).map(task => task.id),
  taskStats: Object.fromEntries(tasks.slice(0, 30).map((task, index) => [task.id, {`,
'validator fixture anchor');

patch('scripts/validate-assessment.ts',
`};

for (const mode of Object.keys(assessmentModes) as AssessmentMode[]) {
  const config = assessmentModes[mode];
  const progress = mode === 'quick' ? defaultProgress : practiced;`,
`};
const completeProgress: Progress = {
  ...defaultProgress,
  completed: tasks.map(task => task.id),
  taskStats: Object.fromEntries(tasks.map(task => [task.id, {
    attempts: 1,
    incorrect: 0,
    hintsUsed: 0,
    lastAttemptAt: new Date(2026, 6, 24).toISOString(),
    completedAt: new Date(2026, 6, 24).toISOString()
  }]))
};

for (const mode of Object.keys(assessmentModes) as AssessmentMode[]) {
  const config = assessmentModes[mode];
  const progress = mode === 'quick' || mode === 'diagnostic'
    ? defaultProgress
    : mode === 'production' || mode === 'final'
      ? completeProgress
      : practiced;`,
'validator complete fixture');
patch('scripts/validate-assessment.ts',
`  if (mode === 'exam') assert(first.every(task => task.mode !== 'lesson' && task.mode !== 'puzzle'), 'exam: invalid task mode');
}`,
`  if (mode === 'exam') assert(first.every(task => task.mode !== 'lesson' && task.mode !== 'puzzle'), 'exam: invalid task mode');
  if (config.fixedTaskIds) assert(JSON.stringify(first.map(task => task.id)) === JSON.stringify(config.fixedTaskIds), mode + ': fixed pool changed');
}`,
'validator fixed pools');

console.log('Graded exam integration patch applied.');
