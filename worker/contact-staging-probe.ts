import { contactDeliveryTimeline } from './contact-observability';

type ContactStagingEnvironment = Cloudflare.Env & Partial<Record<
  'CONTACT_STAGING_MODE' | 'CONTACT_STAGING_PROBE_SECRET',
  string
>>;

const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2_048;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-contact-staging-contract': 'contact-provider-staging-v1'
    }
  });
}

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

function constantTimeTextEqual(left: string, right: string) {
  const leftBytes = utf8(left);
  const rightBytes = utf8(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return mismatch === 0;
}

async function boundedJson(request: Request) {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (utf8(text).byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function handleContactStagingProbe(
  request: Request,
  env: ContactStagingEnvironment
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/ops/contact-staging/timeline') return null;
  if (env.CONTACT_STAGING_MODE !== 'enabled') return json({ error: 'Not found' }, 404);
  const expected = (env.CONTACT_STAGING_PROBE_SECRET || '').trim();
  const provided = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (expected.length < 32 || !constantTimeTextEqual(provided, expected)) return json({ error: 'Not found' }, 404);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = await boundedJson(request) as { challengeId?: unknown } | null;
  if (!body || typeof body.challengeId !== 'string' || !CHALLENGE_ID_PATTERN.test(body.challengeId)) {
    return json({ error: 'Invalid challenge' }, 400);
  }
  const timeline = await contactDeliveryTimeline(env, body.challengeId);
  if (!timeline) return json({ error: 'Challenge not found' }, 404);
  return json({ contract: 'contact-provider-staging-v1', ...timeline });
}