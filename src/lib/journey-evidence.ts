import {
  capstoneProjects,
  curriculumCheckpoints,
  curriculumLessons
} from '../data/complete-curriculum';
import { lessonChecksComplete } from '../data/lesson-checks';
import type { CurriculumCheckAnswer, CurriculumProgressV1 } from './curriculum-progress';

export const JOURNEY_CURRICULUM_CHANGED_EVENT = 'sql-academy-curriculum-progress-changed';
export const JOURNEY_CHECKPOINT_REPORTS_CHANGED_EVENT = 'sql-academy-checkpoint-reports-changed';
export const JOURNEY_ASSESSMENT_REPORTS_CHANGED_EVENT = 'sql-academy-assessment-reports-changed';
export const JOURNEY_EVIDENCE_EVENTS = [
  JOURNEY_CURRICULUM_CHANGED_EVENT,
  JOURNEY_CHECKPOINT_REPORTS_CHANGED_EVENT,
  JOURNEY_ASSESSMENT_REPORTS_CHANGED_EVENT
] as const;

const AUTH_SESSION_KEY = 'sql-academy-auth-session-v2';
const CURRICULUM_STORAGE_PREFIX = 'sql-academy-curriculum-progress-v1';
const CHECKPOINT_REPORTS_PREFIX = 'sql-academy-checkpoint-reports-v1';
const ASSESSMENT_REPORTS_PREFIX = 'sql-academy-assessment-reports-v1';
const MAX_EVIDENCE_BYTES = 1_000_000;
const MAX_CHECKPOINT_REPORTS = 50;
const MAX_ASSESSMENT_REPORTS = 20;

export type JourneyEvidenceSnapshot = {
  curriculum: CurriculumProgressV1;
  passedCheckpointIds: string[];
  assessmentComplete: boolean;
};

type StoredOwner = {
  userId: string | null;
  curriculumOwnerId: string;
};

function now() {
  return new Date().toISOString();
}

function emptyCurriculum(): CurriculumProgressV1 {
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

function storedOwner(): StoredOwner {
  if (typeof localStorage === 'undefined') return { userId: null, curriculumOwnerId: 'local' };
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw || raw.length > MAX_EVIDENCE_BYTES) return { userId: null, curriculumOwnerId: 'local' };
    const session = JSON.parse(raw) as { version?: unknown; userId?: unknown; username?: unknown };
    const userId = session.version === 2 && typeof session.userId === 'string' && session.userId
      ? session.userId
      : null;
    const username = typeof session.username === 'string' && session.username ? session.username : null;
    return {
      userId,
      curriculumOwnerId: userId || username || 'local'
    };
  } catch {
    return { userId: null, curriculumOwnerId: 'local' };
  }
}

function readJson(key: string): unknown {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > MAX_EVIDENCE_BYTES) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function stringSet(value: unknown, known: ReadonlySet<string>) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string =>
    typeof item === 'string' && known.has(item)
  )));
}

function safeAnswers(value: unknown): Record<string, CurriculumCheckAnswer> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const answers: Record<string, CurriculumCheckAnswer> = {};
  for (const lesson of curriculumLessons) {
    for (const check of lesson.checks || [lesson.check]) {
      const candidate = source[check.id];
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const answer = candidate as Record<string, unknown>;
      const optionIndex = Number(answer.optionIndex);
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= check.options.length) continue;
      answers[check.id] = {
        optionIndex,
        correct: optionIndex === check.correctIndex,
        answeredAt: typeof answer.answeredAt === 'string' ? answer.answeredAt : now()
      };
    }
  }
  return answers;
}

function loadCurriculum(ownerId: string): CurriculumProgressV1 {
  const raw = readJson(`${CURRICULUM_STORAGE_PREFIX}:${ownerId}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyCurriculum();
  const source = raw as Record<string, unknown>;
  const lessonIds = new Set(curriculumLessons.map(lesson => lesson.id));
  const sectionIds = new Set(curriculumLessons.flatMap(lesson => lesson.sections.map(section => section.id)));
  const projectIds = new Set(capstoneProjects.map(project => project.id));
  const completedSections = stringSet(source.completedSections, sectionIds);
  const requestedLessons = new Set(stringSet(source.completedLessons, lessonIds));
  const answers = safeAnswers(source.answers);
  const completedLessons = curriculumLessons
    .filter(lesson =>
      requestedLessons.has(lesson.id)
      && lesson.sections.every(section => completedSections.includes(section.id))
      && lessonChecksComplete(lesson, answers)
    )
    .map(lesson => lesson.id);

  return {
    version: 1,
    completedSections,
    completedLessons,
    completedProjects: stringSet(source.completedProjects, projectIds),
    answers,
    projectDrafts: {},
    bookmark: null,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now()
  };
}

function loadPassedCheckpointIds(userId: string | null) {
  if (!userId) return [];
  const raw = readJson(`${CHECKPOINT_REPORTS_PREFIX}:${userId}`);
  if (!Array.isArray(raw)) return [];
  const knownCheckpointIds = new Set(curriculumCheckpoints.map(checkpoint => checkpoint.id));
  const passed = new Set<string>();
  for (const item of raw.slice(0, MAX_CHECKPOINT_REPORTS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const report = item as Record<string, unknown>;
    if (report.version !== 1
      || report.userId !== userId
      || report.status !== 'completed'
      || report.passed !== true
      || typeof report.checkpointId !== 'string'
      || !knownCheckpointIds.has(report.checkpointId)) continue;
    passed.add(report.checkpointId);
  }
  return curriculumCheckpoints
    .map(checkpoint => checkpoint.id)
    .filter(checkpointId => passed.has(checkpointId));
}

function loadAssessmentComplete(userId: string | null) {
  if (!userId) return false;
  const raw = readJson(`${ASSESSMENT_REPORTS_PREFIX}:${userId}`);
  if (!Array.isArray(raw)) return false;
  return raw.slice(0, MAX_ASSESSMENT_REPORTS).some(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const report = item as Record<string, unknown>;
    return report.version === 1
      && report.userId === userId
      && report.status === 'completed'
      && (report.mode === 'exam' || report.mode === 'production' || report.mode === 'final');
  });
}

export function loadJourneyEvidenceSnapshot(): JourneyEvidenceSnapshot {
  const owner = storedOwner();
  return {
    curriculum: loadCurriculum(owner.curriculumOwnerId),
    passedCheckpointIds: loadPassedCheckpointIds(owner.userId),
    assessmentComplete: loadAssessmentComplete(owner.userId)
  };
}
