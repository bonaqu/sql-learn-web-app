import { capstoneContract } from '../data/capstone-contracts';
import { capstoneProjects, curriculumLessons } from '../data/complete-curriculum';
import { capstoneWorkspaceTemplate } from '../data/capstone-workspace-templates';
import {
  allKnownLessonChecks,
  lessonChecks,
  lessonChecksComplete
} from '../data/lesson-checks';

export const CURRICULUM_PROGRESS_CHANGED_EVENT = 'sql-academy-curriculum-progress-changed';
const STORAGE_PREFIX = 'sql-academy-curriculum-progress-v1';
const AUTH_SESSION_KEY = 'sql-academy-auth-session-v2';

export interface CurriculumCheckAnswer {
  optionIndex: number;
  correct: boolean;
  answeredAt: string;
}

export interface ProjectDraft {
  sql: string;
  files: Record<string, string>;
  notes: string;
  completedDeliverables: string[];
  startedAt: string;
  guidanceUses: number;
  solutionViews: number;
  updatedAt: string;
}

export interface CurriculumBookmark {
  lessonId: string;
  sectionId: string;
  updatedAt: string;
}

export interface CurriculumProgressV1 {
  version: 1;
  completedSections: string[];
  completedLessons: string[];
  completedProjects: string[];
  answers: Record<string, CurriculumCheckAnswer>;
  projectDrafts: Record<string, ProjectDraft>;
  bookmark: CurriculumBookmark | null;
  updatedAt: string;
}

function ownerId() {
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || '{}') as { userId?: string; username?: string };
    return session.userId || session.username || 'local';
  } catch {
    return 'local';
  }
}

function storageKey() {
  return `${STORAGE_PREFIX}:${ownerId()}`;
}

function now() {
  return new Date().toISOString();
}

export function emptyCurriculumProgress(): CurriculumProgressV1 {
  return {
    version: 1,
    completedSections: [],
    completedLessons: [],
    completedProjects: [],
    answers: {},
    projectDrafts: {},
    bookmark: null,
    updatedAt: now()
  };
}

function uniqueKnown(values: unknown, known: Set<string>) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && known.has(value))));
}

function lessonComplete(
  lesson: (typeof curriculumLessons)[number],
  completedSections: string[],
  answers: Record<string, CurriculumCheckAnswer>
) {
  return lesson.sections.every(section => completedSections.includes(section.id))
    && lessonChecksComplete(lesson, answers);
}

function defaultProjectFiles(projectId: string, legacySql = '') {
  const contract = capstoneContract(projectId);
  if (!contract) return {};
  return Object.fromEntries(contract.files.map((file, index) => [
    file.id,
    index === 0 && legacySql.trim()
      ? legacySql.slice(0, 40_000)
      : capstoneWorkspaceTemplate(file.id, file.starterSql).slice(0, 40_000)
  ]));
}

function sanitizedProjectFiles(projectId: string, value: unknown, legacySql: string) {
  const contract = capstoneContract(projectId);
  if (!contract) return {};
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const fallback = defaultProjectFiles(projectId, legacySql);
  return Object.fromEntries(contract.files.map(file => [
    file.id,
    typeof source[file.id] === 'string' ? String(source[file.id]).slice(0, 40_000) : fallback[file.id] || ''
  ]));
}

function sanitize(raw: unknown): CurriculumProgressV1 {
  const source = raw && typeof raw === 'object' ? raw as Partial<CurriculumProgressV1> : {};
  const lessonIds = new Set(curriculumLessons.map(lesson => lesson.id));
  const sectionIds = new Set(curriculumLessons.flatMap(lesson => lesson.sections.map(section => section.id)));
  const projectIds = new Set(capstoneProjects.map(project => project.id));
  const deliverableIds = new Map(capstoneProjects.map(project => [project.id, new Set(project.deliverables.map(item => item.id))]));
  const knownChecks = allKnownLessonChecks(curriculumLessons);

  const answers: Record<string, CurriculumCheckAnswer> = {};
  if (source.answers && typeof source.answers === 'object') {
    for (const check of knownChecks) {
      const answer = source.answers[check.id];
      if (!answer || typeof answer !== 'object') continue;
      const optionIndex = Number(answer.optionIndex);
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= check.options.length) continue;
      answers[check.id] = {
        optionIndex,
        correct: optionIndex === check.correctIndex,
        answeredAt: typeof answer.answeredAt === 'string' ? answer.answeredAt : now()
      };
    }
  }

  const projectDrafts: Record<string, ProjectDraft> = {};
  if (source.projectDrafts && typeof source.projectDrafts === 'object') {
    for (const project of capstoneProjects) {
      const draft = source.projectDrafts[project.id] as Partial<ProjectDraft> | undefined;
      if (!draft || typeof draft !== 'object') continue;
      const legacySql = typeof draft.sql === 'string' ? draft.sql.slice(0, 40_000) : '';
      const files = sanitizedProjectFiles(project.id, draft.files, legacySql);
      const firstFile = capstoneContract(project.id)?.files[0]?.id;
      projectDrafts[project.id] = {
        sql: firstFile ? files[firstFile] || legacySql : legacySql,
        files,
        notes: typeof draft.notes === 'string' ? draft.notes.slice(0, 12_000) : '',
        completedDeliverables: uniqueKnown(draft.completedDeliverables, deliverableIds.get(project.id) || new Set()),
        startedAt: typeof draft.startedAt === 'string' && Number.isFinite(Date.parse(draft.startedAt)) ? draft.startedAt : now(),
        guidanceUses: Number.isInteger(draft.guidanceUses) ? Math.max(0, Math.min(1_000, Number(draft.guidanceUses))) : 0,
        solutionViews: Number.isInteger(draft.solutionViews) ? Math.max(0, Math.min(1_000, Number(draft.solutionViews))) : 0,
        updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : now()
      };
    }
  }

  const completedSections = uniqueKnown(source.completedSections, sectionIds);
  const requestedCompletedLessons = new Set(uniqueKnown(source.completedLessons, lessonIds));
  const completedLessons = curriculumLessons
    .filter(lesson => requestedCompletedLessons.has(lesson.id) && lessonComplete(lesson, completedSections, answers))
    .map(lesson => lesson.id);

  const bookmark = source.bookmark
    && typeof source.bookmark.lessonId === 'string'
    && lessonIds.has(source.bookmark.lessonId)
    && typeof source.bookmark.sectionId === 'string'
    && sectionIds.has(source.bookmark.sectionId)
    ? {
        lessonId: source.bookmark.lessonId,
        sectionId: source.bookmark.sectionId,
        updatedAt: typeof source.bookmark.updatedAt === 'string' ? source.bookmark.updatedAt : now()
      }
    : null;

  return {
    version: 1,
    completedSections,
    completedLessons,
    completedProjects: uniqueKnown(source.completedProjects, projectIds),
    answers,
    projectDrafts,
    bookmark,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now()
  };
}

export function loadCurriculumProgress(): CurriculumProgressV1 {
  try {
    const raw = localStorage.getItem(storageKey());
    return raw ? sanitize(JSON.parse(raw)) : emptyCurriculumProgress();
  } catch {
    return emptyCurriculumProgress();
  }
}

export function saveCurriculumProgress(progress: CurriculumProgressV1) {
  const next = sanitize({ ...progress, updatedAt: now() });
  localStorage.setItem(storageKey(), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CURRICULUM_PROGRESS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function markCurriculumSection(progress: CurriculumProgressV1, lessonId: string, sectionId: string) {
  const lesson = curriculumLessons.find(item => item.id === lessonId);
  if (!lesson || !lesson.sections.some(section => section.id === sectionId)) return progress;
  const completedSections = Array.from(new Set([...progress.completedSections, sectionId]));
  const complete = lessonComplete(lesson, completedSections, progress.answers);
  return saveCurriculumProgress({
    ...progress,
    completedSections,
    completedLessons: complete ? Array.from(new Set([...progress.completedLessons, lessonId])) : progress.completedLessons,
    bookmark: { lessonId, sectionId, updatedAt: now() },
    updatedAt: now()
  });
}

export function answerCurriculumCheck(
  progress: CurriculumProgressV1,
  lessonId: string,
  optionIndex: number,
  checkId?: string
) {
  const lesson = curriculumLessons.find(item => item.id === lessonId);
  if (!lesson) return progress;
  const checks = lessonChecks(lesson);
  const check = checkId ? checks.find(item => item.id === checkId) : checks[0];
  if (!check || optionIndex < 0 || optionIndex >= check.options.length) return progress;
  const answer: CurriculumCheckAnswer = {
    optionIndex,
    correct: optionIndex === check.correctIndex,
    answeredAt: now()
  };
  const answers = { ...progress.answers, [check.id]: answer };
  const complete = lessonComplete(lesson, progress.completedSections, answers);
  return saveCurriculumProgress({
    ...progress,
    answers,
    completedLessons: complete
      ? Array.from(new Set([...progress.completedLessons, lessonId]))
      : progress.completedLessons.filter(id => id !== lessonId),
    updatedAt: now()
  });
}

export function setCurriculumBookmark(progress: CurriculumProgressV1, lessonId: string, sectionId: string) {
  return saveCurriculumProgress({
    ...progress,
    bookmark: { lessonId, sectionId, updatedAt: now() },
    updatedAt: now()
  });
}

export function projectDraftFor(progress: CurriculumProgressV1, projectId: string): ProjectDraft {
  const current = progress.projectDrafts[projectId];
  if (current) return current;
  const files = defaultProjectFiles(projectId);
  const firstFile = capstoneContract(projectId)?.files[0]?.id;
  const timestamp = now();
  return {
    sql: firstFile ? files[firstFile] || '' : '',
    files,
    notes: '',
    completedDeliverables: [],
    startedAt: timestamp,
    guidanceUses: 0,
    solutionViews: 0,
    updatedAt: timestamp
  };
}

export function updateProjectDraft(
  progress: CurriculumProgressV1,
  projectId: string,
  patch: Partial<Pick<ProjectDraft, 'sql' | 'files' | 'notes' | 'completedDeliverables' | 'startedAt' | 'guidanceUses' | 'solutionViews'>>
) {
  const project = capstoneProjects.find(item => item.id === projectId);
  if (!project) return progress;
  const current = projectDraftFor(progress, projectId);
  const allowed = new Set(project.deliverables.map(item => item.id));
  const files = patch.files
    ? sanitizedProjectFiles(projectId, patch.files, current.sql)
    : current.files;
  const firstFile = capstoneContract(projectId)?.files[0]?.id;
  const nextDraft: ProjectDraft = {
    sql: typeof patch.sql === 'string'
      ? patch.sql.slice(0, 40_000)
      : firstFile ? files[firstFile] || current.sql : current.sql,
    files,
    notes: typeof patch.notes === 'string' ? patch.notes.slice(0, 12_000) : current.notes,
    completedDeliverables: patch.completedDeliverables
      ? uniqueKnown(patch.completedDeliverables, allowed)
      : current.completedDeliverables,
    startedAt: typeof patch.startedAt === 'string' && Number.isFinite(Date.parse(patch.startedAt))
      ? patch.startedAt
      : current.startedAt,
    guidanceUses: Number.isInteger(patch.guidanceUses)
      ? Math.max(0, Math.min(1_000, Number(patch.guidanceUses)))
      : current.guidanceUses,
    solutionViews: Number.isInteger(patch.solutionViews)
      ? Math.max(0, Math.min(1_000, Number(patch.solutionViews)))
      : current.solutionViews,
    updatedAt: now()
  };
  return saveCurriculumProgress({
    ...progress,
    projectDrafts: { ...progress.projectDrafts, [projectId]: nextDraft },
    updatedAt: now()
  });
}

export function completeProject(progress: CurriculumProgressV1, projectId: string) {
  const project = capstoneProjects.find(item => item.id === projectId);
  const draft = progress.projectDrafts[projectId];
  if (!project || !draft) return progress;
  const allDeliverables = project.deliverables.every(item => draft.completedDeliverables.includes(item.id));
  if (!allDeliverables || Object.values(draft.files).some(sql => sql.trim().length < 10)) return progress;
  return saveCurriculumProgress({
    ...progress,
    completedProjects: Array.from(new Set([...progress.completedProjects, projectId])),
    updatedAt: now()
  });
}

export function mergeCurriculumProgress(local: CurriculumProgressV1, remote: CurriculumProgressV1) {
  const answers = { ...local.answers };
  for (const [id, answer] of Object.entries(remote.answers)) {
    const current = answers[id];
    if (!current || answer.answeredAt >= current.answeredAt || answer.correct) answers[id] = answer;
  }

  const projectDrafts = { ...local.projectDrafts };
  for (const [id, draft] of Object.entries(remote.projectDrafts)) {
    const current = projectDrafts[id];
    if (!current || draft.updatedAt >= current.updatedAt) projectDrafts[id] = draft;
  }

  const bookmark = !local.bookmark
    ? remote.bookmark
    : !remote.bookmark
      ? local.bookmark
      : remote.bookmark.updatedAt >= local.bookmark.updatedAt ? remote.bookmark : local.bookmark;

  return sanitize({
    version: 1,
    completedSections: [...local.completedSections, ...remote.completedSections],
    completedLessons: [...local.completedLessons, ...remote.completedLessons],
    completedProjects: [...local.completedProjects, ...remote.completedProjects],
    answers,
    projectDrafts,
    bookmark,
    updatedAt: local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt
  });
}

export function curriculumCompletion(progress: CurriculumProgressV1) {
  const lessonPercent = curriculumLessons.length ? progress.completedLessons.length / curriculumLessons.length : 0;
  const legacyProjectPercent = capstoneProjects.length ? progress.completedProjects.length / capstoneProjects.length : 0;
  return Math.round((lessonPercent * 0.9 + legacyProjectPercent * 0.1) * 100);
}
