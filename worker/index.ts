import core from './core';
import { handleAdminHealthRequest, handleHiddenAdminBoundary } from './admin-health';
import { handleAssessmentRequest } from './assessment';
import { handleAssessmentReportV2Request } from './assessment-report-v2-route';
import { authenticateSession, handleAuthRequest } from './auth';
import { handleCapstoneRequest } from './capstones';
import { handleCheckpointRequest } from './checkpoints';
import { handleCommercialCapabilitiesRequest } from './commercial-capabilities';
import { handleContactAccountRequest } from './contact-account';
import { handleContactVerificationRequest } from './contact-verification';
import { handleCurriculumRequest } from './curriculum';
import { handleDialectLabRequest } from './dialect-labs';
import { handleDialectRealEngineRequest } from './dialect-real-engine-route';
import { withSecurityHeaders } from './http-security';
import { handleLearningAnalyticsRequest } from './learning-analytics';
import { handleMasteryProgressV1Request } from './mastery-progress-route';
import { handleOnboardingRequest } from './onboarding';
import { enforceTurnstile } from './turnstile';

export { Sandbox } from '@cloudflare/sandbox';

const CORS_METHODS = 'GET, PUT, POST, DELETE, OPTIONS';
const CORS_HEADERS = 'authorization, content-type, x-profile-id, cf-turnstile-response';

type Pipeline = 'auth' | 'assessment' | 'checkpoint' | 'capstone' | 'dialect' | 'analytics' | 'curriculum' | 'onboarding' | 'commercial';
type OriginEnvironment = Cloudflare.Env & Partial<Record<'ALLOWED_ORIGINS', string>>;

function configuredOrigins(env: OriginEnvironment) {
  const origins = new Set<string>();
  const entries = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 24);
  for (const entry of entries) {
    try {
      const parsed = new URL(entry);
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:')
        && parsed.origin === entry.replace(/\/$/, '')
        && !parsed.username
        && !parsed.password
        && parsed.pathname === '/'
        && !parsed.search
        && !parsed.hash) origins.add(parsed.origin);
    } catch {
      // Invalid configured origins are ignored. Missing valid configuration fails closed.
    }
  }
  return origins;
}

function allowedOrigin(request: Request, env: OriginEnvironment) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === new URL(request.url).origin || configuredOrigins(env).has(origin)) return origin;
  return false;
}

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': CORS_METHODS,
    'access-control-allow-headers': CORS_HEADERS,
    'access-control-expose-headers': 'retry-after, x-request-id, x-progress-contract, x-onboarding-contract, x-dialect-lab-contract, x-learning-analytics-contract, x-commercial-capabilities-contract, x-contact-verification-contract, x-contact-account-contract',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

function withCors(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function finalize(response: Response, request: Request, origin: string | null) {
  return withSecurityHeaders(origin ? withCors(response, origin) : response, request);
}

function pipelineFailure(error: unknown, pathname: string, pipeline: Pipeline) {
  const requestId = crypto.randomUUID();
  const name = error instanceof Error ? error.name.slice(0, 80) : 'UnknownError';
  const message = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
  console.error(`${pipeline}_pipeline_unhandled`, { requestId, pathname, name, message });
  const label = pipeline === 'auth'
    ? 'Authentication'
    : pipeline === 'assessment'
      ? 'Assessment'
      : pipeline === 'checkpoint'
        ? 'Checkpoint'
        : pipeline === 'capstone'
          ? 'Capstone'
          : pipeline === 'dialect'
            ? 'Dialect lab'
            : pipeline === 'analytics'
              ? 'Learning analytics'
              : pipeline === 'onboarding'
                ? 'Onboarding'
                : pipeline === 'commercial'
                  ? 'Commercial runtime'
                  : 'Curriculum';
  return new Response(JSON.stringify({
    error: `${label} operation failed`,
    code: `${pipeline.toUpperCase()}_PIPELINE_UNHANDLED`,
    requestId
  }), {
    status: 500,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-request-id': requestId
    }
  });
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return withSecurityHeaders(await core.fetch(request, env), request);

    const origin = allowedOrigin(request, env);
    if (origin === false) {
      return withSecurityHeaders(new Response(JSON.stringify({ error: 'Origin is not allowed' }), {
        status: 403,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          vary: 'Origin'
        }
      }), request);
    }

    if (request.method === 'OPTIONS') {
      if (!origin) return withSecurityHeaders(new Response(null, { status: 204, headers: { allow: CORS_METHODS } }), request);
      return finalize(new Response(null, { status: 204, headers: corsHeaders(origin) }), request, null);
    }

    let hiddenAdminResponse: Response | null;
    try {
      hiddenAdminResponse = handleHiddenAdminBoundary(request, env);
    } catch (error) {
      return finalize(pipelineFailure(error, url.pathname, 'commercial'), request, origin);
    }
    if (hiddenAdminResponse) return finalize(hiddenAdminResponse, request, origin);

    let commercialResponse: Response | null;
    try {
      commercialResponse = handleCommercialCapabilitiesRequest(request, env);
    } catch (error) {
      return finalize(pipelineFailure(error, url.pathname, 'commercial'), request, origin);
    }
    if (commercialResponse) return finalize(commercialResponse, request, origin);

    let turnstileResponse: Response | null;
    try {
      turnstileResponse = await enforceTurnstile(request, env);
    } catch (error) {
      return finalize(pipelineFailure(error, url.pathname, 'commercial'), request, origin);
    }
    if (turnstileResponse) return finalize(turnstileResponse, request, origin);

    let contactVerificationResponse: Response | null;
    try {
      contactVerificationResponse = await handleContactVerificationRequest(request, env);
    } catch (error) {
      return finalize(pipelineFailure(error, url.pathname, 'commercial'), request, origin);
    }
    if (contactVerificationResponse) return finalize(contactVerificationResponse, request, origin);

    let contactAccountResponse: Response | null;
    try {
      contactAccountResponse = await handleContactAccountRequest(request, env);
    } catch (error) {
      return finalize(pipelineFailure(error, url.pathname, 'auth'), request, origin);
    }
    if (contactAccountResponse) return finalize(contactAccountResponse, request, origin);

    let masteryProgressResponse: Response | null;
    try {
      masteryProgressResponse = await handleMasteryProgressV1Request(request, env);
    } catch (error) {
      return finalize(pipelineFailure(error, url.pathname, 'auth'), request, origin);
    }
    if (masteryProgressResponse) return finalize(masteryProgressResponse, request, origin);

    let authResponse: Response | null;
    try {
      authResponse = await handleAuthRequest(request, env);
    } catch (error) {
      return finalize(pipelineFailure(error, url.pathname, 'auth'), request, origin);
    }
    if (authResponse) return finalize(authResponse, request, origin);

    let routedRequest = request;
    if (url.pathname !== '/api/health') {
      let auth: Awaited<ReturnType<typeof authenticateSession>>;
      try {
        auth = await authenticateSession(request, env);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'auth'), request, origin);
      }
      if (auth instanceof Response) return finalize(auth, request, origin);

      let adminHealthResponse: Response | null;
      try {
        adminHealthResponse = await handleAdminHealthRequest(request, env, auth.userId);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'commercial'), request, origin);
      }
      if (adminHealthResponse) return finalize(adminHealthResponse, request, origin);

      let assessmentV2Response: Response | null;
      try {
        assessmentV2Response = await handleAssessmentReportV2Request(request, env, auth.userId);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'assessment'), request, origin);
      }
      if (assessmentV2Response) return finalize(assessmentV2Response, request, origin);

      let assessmentResponse: Response | null;
      try {
        assessmentResponse = await handleAssessmentRequest(request, env, auth.userId);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'assessment'), request, origin);
      }
      if (assessmentResponse) return finalize(assessmentResponse, request, origin);

      let checkpointResponse: Response | null;
      try {
        checkpointResponse = await handleCheckpointRequest(request, env, auth.userId);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'checkpoint'), request, origin);
      }
      if (checkpointResponse) return finalize(checkpointResponse, request, origin);

      let capstoneResponse: Response | null;
      try {
        capstoneResponse = await handleCapstoneRequest(request, env, auth.userId);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'capstone'), request, origin);
      }
      if (capstoneResponse) return finalize(capstoneResponse, request, origin);

      let realDialectResponse: Response | null;
      try {
        realDialectResponse = await handleDialectRealEngineRequest(request, env, auth.userId);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'dialect'), request, origin);
      }
      if (realDialectResponse) return finalize(realDialectResponse, request, origin);

      let dialectResponse: Response | null;
      try {
        dialectResponse = await handleDialectLabRequest(request, env, auth.userId);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'dialect'), request, origin);
      }
      if (dialectResponse) return finalize(dialectResponse, request, origin);

      let analyticsResponse: Response | null;
      try {
        analyticsResponse = await handleLearningAnalyticsRequest(request, env, auth.userId);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'analytics'), request, origin);
      }
      if (analyticsResponse) return finalize(analyticsResponse, request, origin);

      let curriculumResponse: Response | null;
      try {
        curriculumResponse = await handleCurriculumRequest(request, env, auth.userId);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'curriculum'), request, origin);
      }
      if (curriculumResponse) return finalize(curriculumResponse, request, origin);

      let onboardingResponse: Response | null;
      try {
        onboardingResponse = await handleOnboardingRequest(request, env, auth.userId);
      } catch (error) {
        return finalize(pipelineFailure(error, url.pathname, 'onboarding'), request, origin);
      }
      if (onboardingResponse) return finalize(onboardingResponse, request, origin);

      const headers = new Headers(request.headers);
      headers.set('x-profile-id', auth.userId);
      routedRequest = new Request(request, { headers });
    }

    return finalize(await core.fetch(routedRequest, env), request, origin);
  }
} satisfies ExportedHandler<Cloudflare.Env>;
