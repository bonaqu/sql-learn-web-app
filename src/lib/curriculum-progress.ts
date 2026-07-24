import { capstoneProjects, curriculumLessons } from '../data/curriculum';

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
  notes: string;
  completedDeliverables: string[];
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

function sanitize(raw: unknown): CurriculumProgressV1 {
  const source = raw && typeof raw === 'object' ? raw as Partial<CurriculumProgressV1> : {};
  const lessonIds = new Set(curriculumLessons.map(lesson => lesson.id));
  const sectionIds = new Set(curriculumLessons.flatMap(lesson => lesson.sections.map(section => section.id)));
  const projectIds = new Set(capstoneProjects.map(project => project.id));
  const deliverableIds = new Map(capstoneProjects.map(project => [project.id, new Set(project.deliverables.map(item => item.id))]));

  const answers: Record<string, CurriculumCheckAnswer> = {};
  if (source.answers && typeof source.answers === 'object') {
    for (const lesson of curriculumLessons) {
      const answer = source.answers[lesson.check.id];
      if (!answer || typeof answer !== 'object') continue;
      const optionIndex = Number(answer.optionIndex);
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= lesson.check.options.length) continue;
      answers[lesson.check.id] = {
        optionIndex,
        correct: optionIndex === lesson.check.correctIndex,
        answeredAt: typeof answer.answeredAt === 'string' ? answer.answeredAt : now()
      };
    }
  }

  const projectDrafts: Record<string, ProjectDraft> = {};
  if (source.projectDrafts && typeof source.projectDrafts === 'object') {
    for (const project of capstoneProjects) {
      const draft = source.projectDrafts[project.id];
      if (!draft || typeof draft !== 'object') continue;
      projectDrafts[project.id] = {
        sql: typeof draft.sql === 'string' ? draft.sql.slice(0, 40_000) : '',
        notes: typeof draft.notes === 'string' ? draft.notes.slice(0, 12_000) : '',
        completedDeliverables: uniqueKnown(draft.completedDeliverables, deliverableIds.get(project.id) || new Set()),
        updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : now()
      };
    }
  }

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
    completedSections: uniqueKnown(source.completedSections, sectionIds),
    completedLessons: uniqueKnown(source.completedLessons, lessonIds),
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
  const answerCorrect = Boolean(progress.answers[lesson.check.id]?.correct);
  const lessonComplete = lesson.sections.every(section => completedSections.includes(section.id)) && answerCorrect;
  return saveCurriculumProgress({
    ...progress,
    completedSections,
    completedLessons: lessonComplete ? Array.from(new Set([...progress.completedLessons, lessonId])) : progress.completedLessons,
    bookmark: { lessonId, sectionId, updatedAt: now() },
    updatedAt: now()
  });
}

export function answerCurriculumCheck(progress: CurriculumProgressV1, lessonId: string, optionIndex: number) {
  const lesson = curriculumLessons.find(item => item.id === lessonId);
  if (!lesson || optionIndex < 0 || optionIndex >= lesson.check.options.length) return progress;
  const answer: CurriculumCheckAnswer = {
    optionIndex,
    correct: optionIndex === lesson.check.correctIndex,
    answeredAt: now()
  };
  const answers = { ...progress.answers, [lesson.check.id]: answer };
  const lessonComplete = lesson.sections.every(section => progress.completedSections.includes(section.id)) && answer.correct;
  return saveCurriculumProgress({
    ...progress,
    answers,
    completedLessons: lessonComplete ? Array.from(new Set([...progress.completedLessons, lessonId])) : progress.completedLessons,
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

export function updateProjectDraft(
  progress: CurriculumProgressV1,
  projectId: string,
  patch: Partial<Pick<ProjectDraft, 'sql' | 'notes' | 'completedDeliverables'>>
) {
  const project = capstoneProjects.find(item => item.id === projectId);
  if (!project) return progress;
  const current = progress.projectDrafts[projectId] || { sql: '', notes: '', completedDeliverables: [], updatedAt: now() };
  const allowed = new Set(project.deliverables.map(item => item.id));
  const nextDraft: ProjectDraft = {
    sql: typeof patch.sql === 'string' ? patch.sql.slice(0, 40_000) : current.sql,
    notes: typeof patch.notes === 'string' ? patch.notes.slice(0, 12_000) : current.notes,
    completedDeliverables: patch.completedDeliverables
      ? uniqueKnown(patch.completedDeliverables, allowed)
      : current.completedDeliverables,
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
  if (!allDeliverables || draft.sql.trim().length < 20) return progress;
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
  const projectPercent = capstoneProjects.length ? progress.completedProjects.length / capstoneProjects.length : 0;
  return Math.round((lessonPercent * 0.75 + projectPercent * 0.25) * 100);
}
