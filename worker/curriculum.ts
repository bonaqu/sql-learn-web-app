const MAX_CURRICULUM_BYTES = 180_000;
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

function validAnswers(value: unknown): value is Record<string, CurriculumAnswer> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 60) return false;
  return entries.every(([id, raw]) => {
    if (!ID_PATTERN.test(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const answer = raw as Partial<CurriculumAnswer>;
    return typeof answer.optionIndex === 'number'
      && Number.isInteger(answer.optionIndex)
      && answer.optionIndex >= 0
      && answer.optionIndex <= 12
      && typeof answer.correct === 'boolean'
      && safeTimestamp(answer.answeredAt);
  });
}

function validDrafts(value: unknown): value is Record<string, CurriculumDraft> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 12) return false;
  return entries.every(([id, raw]) => {
    if (!PROJECT_PATTERN.test(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const draft = raw as Partial<CurriculumDraft>;
    return typeof draft.sql === 'string'
      && draft.sql.length <= 40_000
      && typeof draft.notes === 'string'
      && draft.notes.length <= 12_000
      && validIdList(draft.completedDeliverables, ID_PATTERN, 24)
      && safeTimestamp(draft.updatedAt);
  });
}

function validBookmark(value: unknown): value is CurriculumPayload['bookmark'] {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const bookmark = value as { lessonId?: unknown; sectionId?: unknown; updatedAt?: unknown };
  return typeof bookmark.lessonId === 'string'
    && LESSON_PATTERN.test(bookmark.lessonId)
    && typeof bookmark.sectionId === 'string'
    && ID_PATTERN.test(bookmark.sectionId)
    && safeTimestamp(bookmark.updatedAt);
}

function validCurriculum(payload: unknown): payload is CurriculumPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = payload as Partial<CurriculumPayload>;
  return value.version === 1
    && validIdList(value.completedSections, ID_PATTERN, 120)
    && validIdList(value.completedLessons, LESSON_PATTERN, 40)
    && validIdList(value.completedProjects, PROJECT_PATTERN, 12)
    && validAnswers(value.answers)
    && validDrafts(value.projectDrafts)
    && validBookmark(value.bookmark)
    && safeTimestamp(value.updatedAt);
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
    if (!validCurriculum(body.progress)) return json({ error: 'Invalid curriculum payload' }, 400);
    if (body.baseUpdatedAt !== null && body.baseUpdatedAt !== undefined && !safeTimestamp(body.baseUpdatedAt)) {
      return json({ error: 'Invalid baseUpdatedAt' }, 400);
    }

    const serialized = JSON.stringify(body.progress);
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
      return json({ ok: true, version: body.progress.version, updatedAt: updated.updated_at });
    }

    const inserted = await env.DB.prepare(`INSERT INTO curriculum_progress(user_id, payload, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(user_id) DO NOTHING
      RETURNING updated_at`)
      .bind(userId, serialized, updatedAt)
      .first<MutationRow>();
    if (!inserted) return conflict(env, userId);
    return json({ ok: true, version: body.progress.version, updatedAt: inserted.updated_at });
  }

  return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PUT' });
}
