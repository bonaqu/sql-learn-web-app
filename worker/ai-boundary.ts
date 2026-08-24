export type AiPurpose = 'mentor' | 'assessment-interviewer' | 'assessment-debrief';
export type AiBoundaryReason =
  | 'consent-required'
  | 'feature-disabled'
  | 'provider-unavailable'
  | 'quota-unavailable'
  | 'quota-exhausted';

type AiBoundaryEnvironment = Cloudflare.Env & Partial<Record<'AI_MENTOR_ENABLED', string>>;

export const AI_TEXT_MODEL = '@cf/meta/llama-3.2-1b-instruct';
export const AI_NEURONS_PER_REQUEST = 20;
export const AI_PROFILE_DAILY_NEURONS = 400;
export const AI_GLOBAL_DAILY_NEURONS = 8_000;
export const AI_D1_WORST_CASE_WRITES = 1_620;
export const AI_TIMEOUT_MS = 8_000;
const MAX_SQL_CHARS = 8_000;

export const AI_QUOTA_UPDATE_SQL = `UPDATE mentor_ai_daily_quota
SET neurons_reserved = neurons_reserved + ?1,
    request_count = request_count + 1,
    updated_at = ?2
WHERE quota_day = ?3
  AND quota_key IN ('global', ?4)
  AND 2 = (
    SELECT COUNT(*) FROM mentor_ai_daily_quota
    WHERE quota_day = ?3
      AND ((quota_key = 'global' AND neurons_reserved + ?1 <= ?5)
        OR (quota_key = ?4 AND neurons_reserved + ?1 <= ?6))
  )
RETURNING quota_key, neurons_reserved, request_count`;

export async function reserveAiQuota(env: AiBoundaryEnvironment, profileId: string, now = new Date()) {
  if (!env.DB) return { allowed: false, reason: 'quota-unavailable' as const, remaining: 0 };
  const day = now.toISOString().slice(0, 10);
  const profileKey = `profile:${profileId}`;
  const timestamp = now.toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO mentor_ai_daily_quota(quota_day, quota_key, updated_at)
      VALUES(?, 'global', ?)`).bind(day, timestamp),
    env.DB.prepare(`INSERT OR IGNORE INTO mentor_ai_daily_quota(quota_day, quota_key, updated_at)
      VALUES(?, ?, ?)`).bind(day, profileKey, timestamp),
    env.DB.prepare(AI_QUOTA_UPDATE_SQL).bind(
      AI_NEURONS_PER_REQUEST,
      timestamp,
      day,
      profileKey,
      AI_GLOBAL_DAILY_NEURONS,
      AI_PROFILE_DAILY_NEURONS
    )
  ]);
  const rows = (results[2]?.results || []) as Array<{ quota_key: string; neurons_reserved: number; request_count: number }>;
  const profile = rows.find(row => row.quota_key === profileKey);
  if (rows.length !== 2 || !profile) return { allowed: false, reason: 'quota-exhausted' as const, remaining: 0 };
  return {
    allowed: true,
    reason: 'reserved' as const,
    remaining: Math.max(0, Math.floor((AI_PROFILE_DAILY_NEURONS - profile.neurons_reserved) / AI_NEURONS_PER_REQUEST))
  };
}

export async function authorizeAiRequest(
  env: AiBoundaryEnvironment,
  profileId: string,
  aiConsent: unknown,
  _purpose: AiPurpose
) {
  if (aiConsent !== true) return { allowed: false, reason: 'consent-required' as const, remaining: null, status: 200 };
  if (env.AI_MENTOR_ENABLED !== 'on') return { allowed: false, reason: 'feature-disabled' as const, remaining: null, status: 200 };
  if (!env.AI) return { allowed: false, reason: 'provider-unavailable' as const, remaining: null, status: 200 };
  try {
    const quota = await reserveAiQuota(env, profileId);
    if (!quota.allowed) {
      return {
        allowed: false,
        reason: quota.reason,
        remaining: quota.remaining,
        status: quota.reason === 'quota-exhausted' ? 429 : 200
      };
    }
    return { allowed: true, reason: 'authorized' as const, remaining: quota.remaining, status: 200 };
  } catch {
    return { allowed: false, reason: 'quota-unavailable' as const, remaining: 0, status: 200 };
  }
}

export function sanitizeAiSql(value: string) {
  let output = '';
  let index = 0;
  while (index < value.length && output.length < MAX_SQL_CHARS) {
    if (value[index] === '-' && value[index + 1] === '-') {
      index += 2;
      while (index < value.length && value[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    if (value[index] === '/' && value[index + 1] === '*') {
      index += 2;
      while (index < value.length && !(value[index] === '*' && value[index + 1] === '/')) index += 1;
      index = Math.min(value.length, index + 2);
      output += ' ';
      continue;
    }
    if (value[index] === "'") {
      index += 1;
      while (index < value.length) {
        if (value[index] === "'" && value[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (value[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      output += "'[private literal removed]'";
      continue;
    }
    if (value[index] === '$') {
      const delimiter = value.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        const end = value.indexOf(delimiter, index + delimiter.length);
        index = end < 0 ? value.length : end + delimiter.length;
        output += '$[private literal removed]$';
        continue;
      }
    }
    output += value[index];
    index += 1;
  }
  return output
    .replace(/\b(?:0x)?[A-F0-9]{16,}\b/gi, '[private token removed]')
    .replace(/\b\d+(?:\.\d+)?\b/g, '[number]')
    .trim()
    .slice(0, MAX_SQL_CHARS);
}

export function sanitizeAiContext(value: unknown, maximum: number) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/Bearer\s+[A-Za-z0-9._~-]{8,}/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^\s,;]{4,}/gi, '$1=[redacted]')
    .replace(/\b(?:\+?\d[\d ()-]{8,}\d)\b/g, '[phone removed]')
    .trim()
    .slice(0, maximum);
}

export function untrustedDataEnvelope(data: Record<string, unknown>) {
  return [
    '<untrusted-learning-data format="json">',
    JSON.stringify(data),
    '</untrusted-learning-data>'
  ].join('\n');
}

export async function withAiTimeout<T>(operation: Promise<T>, milliseconds = AI_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AI_PROVIDER_TIMEOUT')), milliseconds);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runSharedAiText(
  env: AiBoundaryEnvironment,
  system: string,
  data: Record<string, unknown>,
  maximumTokens: number,
  temperature: number
) {
  return withAiTimeout(env.AI.run(AI_TEXT_MODEL, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: untrustedDataEnvelope(data) }
    ],
    max_tokens: maximumTokens,
    temperature
  }));
}

export function extractAiResponseText(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const response = (value as Record<string, unknown>).response;
  return typeof response === 'string' ? response : null;
}

function containsSqlSolution(value: string) {
  return /```|\b(?:select|insert|update|delete|merge|with)\b[\s\S]{0,500}\b(?:from|into|set|as)\b/i.test(value);
}

function containsFalseAuthority(value: string) {
  return /(мастерство начислено|навык освоен|зачтено автоматически|готовность подтверждена|вы получили \d+ бал)/i.test(value);
}

export function validateAssessmentAiAnswer(value: unknown, purpose: Extract<AiPurpose, 'assessment-interviewer' | 'assessment-debrief'>) {
  const answer = extractAiResponseText(value)?.trim() || '';
  const maximumCharacters = purpose === 'assessment-interviewer' ? 900 : 4_000;
  const maximumWords = purpose === 'assessment-interviewer' ? 110 : 320;
  if (!answer || answer.length > maximumCharacters) return null;
  if (answer.split(/\s+/u).filter(Boolean).length > maximumWords) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(answer)) return null;
  if (containsSqlSolution(answer) || containsFalseAuthority(answer)) return null;
  if (purpose === 'assessment-interviewer' && /\b(?:join|where|having|group\s+by|order\s+by|union)\b/i.test(answer)) return null;
  return answer;
}
