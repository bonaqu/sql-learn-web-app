const MAX_CURRICULUM_BYTES = 180_000;
const MAX_ANSWERS = 220;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,99}$/;
const LESSON_PATTERN = /^lesson-[a-z0-9-]{3,80}$/;
const PROJECT_PATTERN = /^project-[a-z0-9-]{3,80}$/;

type CurriculumAnswer = {
  optionIndex: number;
  correct: boolean;
  answeredAt: string;
};

type CurriculumDraft = {
  sql: string;
  notes: string;
  completedDeliverables: string[];
  updatedAt: string;
};

type CurriculumPayload = {
  version: 1;
  completedSections: string[];
  completedLessons: string[];
  completedProjects: string[];
  answers: Record<string, CurriculumAnswer>;
  projectDrafts: Record<string, CurriculumDraft>;
  bookmark: null | { lessonId: string; sectionId: string; updatedAt: string };
  updatedAt: string;
};

type CurriculumWrite = {
  progress?: unknown;
  baseUpdatedAt?: unknown;
};

type CurriculumRow = { payload: string; updated_at: string };
type MutationRow = { updated_at: string };

type ValidationCode =
  | 'payload'
  | 'version'
  | 'completedSections'
  | 'completedLessons'
  | 'completedProjects'
  | 'answers.object'
  | 'answers.count'
  | 'answers.id'
  | 'answers.optionIndex'
  | 'answers.correct'
  | 'answers.answeredAt'
  | 'projectDrafts.object'
  | 'projectDrafts.count'
  | 'projectDrafts.id'
  | 'projectDrafts.sql'
  | 'projectDrafts.notes'
  | 'projectDrafts.completedDeliverables'
  | 'projectDrafts.updatedAt'
  | 'bookmark'
  | 'bookmark.lessonId'
  | 'bookmark.sectionId'
  | 'bookmark.updatedAt'
  | 'updatedAt';

const json = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  }
});

function bodyTooLarge(request: Request) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > MAX_CURRICULUM_BYTES;
}

function safeTimestamp(value: unknown) {
  return typeof value === 'string' && value.length >= 10 && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function validIdList(value: unknown, pattern: RegExp, max: number) {
  return Array.isArray(value)
    && value.length <= max
    && new Set(value).size === value.length
    && value.every(item => typeof item === 'string' && pattern.test(item));
}

function answersValidationCode(value: unknown): ValidationCode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'answers.object';
  const entries = Object.entries(value);
  if (entries.length > MAX_ANSWERS) return 'answers.count';
  for (const [id, raw] of entries) {
    if (!ID_PATTERN.test(id)) return 'answers.id';
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'answers.object';
    const answer = raw as Partial<CurriculumAnswer>;
    if (typeof answer.optionIndex !== 'number'
      || !Number.isInteger(answer.optionIndex)
      || answer.optionIndex < 0
      || answer.optionIndex > 12) return 'answers.optionIndex';
    if (typeof answer.correct !== 'boolean') return 'answers.correct';
    if (!safeTimestamp(answer.answeredAt)) return 'answers.answeredAt';
  }
  return null;
}

function draftsValidationCode(value: unknown): ValidationCode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'projectDrafts.object';
  const entries = Object.entries(value);
  if (entries.length > 12) return 'projectDrafts.count';
  for (const [id, raw] of entries) {
    if (!PROJECT_PATTERN.test(id)) return 'projectDrafts.id';
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'projectDrafts.object';
    const draft = raw as Partial<CurriculumDraft>;
    if (typeof draft.sql !== 'string' || draft.sql.length > 40_000) return 'projectDrafts.sql';
    if (typeof draft.notes !== 'string' || draft.notes.length > 12_000) return 'projectDrafts.notes';
    if (!validIdList(draft.completedDeliverables, ID_PATTERN, 24)) return 'projectDrafts.completedDeliverables';
    if (!safeTimestamp(draft.updatedAt)) return 'projectDrafts.updatedAt';
  }
  return null;
}

function bookmarkValidationCode(value: unknown): ValidationCode | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'bookmark';
  const bookmark = value as { lessonId?: unknown; sectionId?: unknown; updatedAt?: unknown };
  if (typeof bookmark.lessonId !== 'string' || !LESSON_PATTERN.test(bookmark.lessonId)) return 'bookmark.lessonId';
  if (typeof bookmark.sectionId !== 'string' || !ID_PATTERN.test(bookmark.sectionId)) return 'bookmark.sectionId';
  if (!safeTimestamp(bookmark.updatedAt)) return 'bookmark.updatedAt';
  return null;
}

function curriculumValidationCode(payload: unknown): ValidationCode | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'payload';
  const value = payload as Partial<CurriculumPayload>;
  if (value.version !== 1) return 'version';
  if (!validIdList(value.completedSections, ID_PATTERN, 240)) return 'completedSections';
  if (!validIdList(value.completedLessons, LESSON_PATTERN, 80)) return 'completedLessons';
  if (!validIdList(value.completedProjects, PROJECT_PATTERN, 12)) return 'completedProjects';
  const answersCode = answersValidationCode(value.answers);
  if (answersCode) return answersCode;
  const draftsCode = draftsValidationCode(value.projectDrafts);
  if (draftsCode) return draftsCode;
  const bookmarkCode = bookmarkValidationCode(value.bookmark);
  if (bookmarkCode) return bookmarkCode;
  if (!safeTimestamp(value.updatedAt)) return 'updatedAt';
  return null;
}

function validCurriculum(payload: unknown): payload is CurriculumPayload {
  return curriculumValidationCode(payload) === null;
}

async function readRow(env: Cloudflare.Env, userId: string) {
  return env.DB.prepare('SELECT payload, updated_at FROM curriculum_progress WHERE user_id = ?')
    .bind(userId)
    .first<CurriculumRow>();
}

function parsedRow(row: CurriculumRow | null) {
  if (!row) return { progress: null, updatedAt: null };
  try {
    const progress: unknown = JSON.parse(row.payload);
    if (!validCurriculum(progress)) return null;
    return { progress, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

async function conflict(env: Cloudflare.Env, userId: string) {
  const current = parsedRow(await readRow(env, userId));
  if (!current) return json({ error: 'Stored curriculum progress is corrupted' }, 500);
  return json({ error: 'Curriculum progress changed on another device', ...current }, 409);
}

export async function handleCurriculumRequest(request: Request, env: Cloudflare.Env, userId: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/curriculum/progress') return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (request.method === 'GET') {
    const current = parsedRow(await readRow(env, userId));
    if (!current) return json({ error: 'Stored curriculum progress is corrupted' }, 500);
    return json(current);
  }

  if (request.method === 'PUT') {
    if (bodyTooLarge(request)) return json({ error: 'Curriculum payload is too large' }, 413);
    const body = await request.json<CurriculumWrite>();
    const validationCode = curriculumValidationCode(body.progress);
    if (validationCode) return json({ error: 'Invalid curriculum payload', validationCode }, 400);
    if (body.baseUpdatedAt !== null && body.baseUpdatedAt !== undefined && !safeTimestamp(body.baseUpdatedAt)) {
      return json({ error: 'Invalid baseUpdatedAt', validationCode: 'updatedAt' }, 400);
    }

    const progress = body.progress as CurriculumPayload;
    const serialized = JSON.stringify(progress);
    if (new TextEncoder().encode(serialized).byteLength > MAX_CURRICULUM_BYTES) {
      return json({ error: 'Curriculum payload is too large' }, 413);
    }

    const updatedAt = new Date().toISOString();
    if (typeof body.baseUpdatedAt === 'string') {
      const updated = await env.DB.prepare(`UPDATE curriculum_progress
        SET payload = ?, updated_at = ?
        WHERE user_id = ? AND updated_at = ?
        RETURNING updated_at`)
        .bind(serialized, updatedAt, userId, body.baseUpdatedAt)
        .first<MutationRow>();
      if (!updated) return conflict(env, userId);
      return json({ ok: true, version: progress.version, updatedAt: updated.updated_at });
    }

    const inserted = await env.DB.prepare(`INSERT INTO curriculum_progress(user_id, payload, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(user_id) DO NOTHING
      RETURNING updated_at`)
      .bind(userId, serialized, updatedAt)
      .first<MutationRow>();
    if (!inserted) return conflict(env, userId);
    return json({ ok: true, version: progress.version, updatedAt: inserted.updated_at });
  }

  return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PUT' });
}
