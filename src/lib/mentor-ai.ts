export type MentorSource = 'local' | 'workers-ai';
export type MentorExampleStatus = 'none' | 'unverified';

export type MentorResponse = {
  answer: string;
  source: MentorSource;
  reason: string;
  remaining: number | null;
  exampleStatus: MentorExampleStatus;
  masteryAwarded: false;
};

const CONSENT_KEY = 'sql-academy-mentor-ai-consent-v1';

export function loadMentorAiConsent() {
  return sessionStorage.getItem(CONSENT_KEY) === 'granted';
}

export function saveMentorAiConsent(granted: boolean) {
  if (granted) sessionStorage.setItem(CONSENT_KEY, 'granted');
  else sessionStorage.removeItem(CONSENT_KEY);
}

export function mentorSourceLabel(source: MentorSource, reason = '', exampleStatus: MentorExampleStatus = 'none') {
  if (source === 'workers-ai') {
    return exampleStatus === 'unverified'
      ? 'Cloudflare Workers AI · SQL-пример не проверен и не влияет на прогресс'
      : 'Cloudflare Workers AI · ответ не влияет на прогресс';
  }
  if (reason === 'quota-exhausted') return 'Локальная подсказка · дневной AI-лимит исчерпан';
  if (reason === 'provider-timeout-or-error' || reason === 'provider-unavailable') return 'Локальная подсказка · AI сейчас недоступен';
  if (reason === 'feature-disabled') return 'Локальная подсказка · AI отключён';
  if (reason === 'malformed-provider-output') return 'Локальная подсказка · небезопасный AI-ответ отклонён';
  return 'Локальная подсказка · данные не покидали устройство';
}

export function parseMentorResponse(value: unknown): MentorResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<MentorResponse>;
  if (typeof item.answer !== 'string' || !item.answer.trim()) return null;
  if (item.source !== 'local' && item.source !== 'workers-ai') return null;
  if (item.exampleStatus !== 'none' && item.exampleStatus !== 'unverified') return null;
  return {
    answer: item.answer.trim().slice(0, 1_600),
    source: item.source,
    reason: typeof item.reason === 'string' ? item.reason.slice(0, 80) : '',
    remaining: typeof item.remaining === 'number' ? Math.max(0, Math.floor(item.remaining)) : null,
    exampleStatus: item.exampleStatus,
    masteryAwarded: false
  };
}

