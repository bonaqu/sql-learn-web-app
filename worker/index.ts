import core from './core';
import { handleAssessmentRequest } from './assessment';
import { handleAssessmentReportV2Request } from './assessment-report-v2-route';
import { authenticateSession, handleAuthRequest } from './auth';
import { handleCapstoneRequest } from './capstones';
import { handleCheckpointRequest } from './checkpoints';
import { handleCurriculumRequest } from './curriculum';
import { handleMasteryProgressV1Request } from './mastery-progress-route';
import { handleOnboardingRequest } from './onboarding';

const ALLOWED_ORIGINS = new Set([
  'https://bonaqu.github.io',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

const CORS_METHODS = 'GET, PUT, POST, DELETE, OPTIONS';
const CORS_HEADERS = 'authorization, content-type, x-profile-id';

type Pipeline = 'auth' | 'assessment' | 'checkpoint' | 'capstone' | 'curriculum' | 'onboarding';

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === new URL(request.url).origin || ALLOWED_ORIGINS.has(origin)) return origin;
  return false;
}

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': CORS_METHODS,
    'access-control-allow-headers': CORS_HEADERS,
    'access-control-expose-headers': 'retry-after, x-request-id, x-progress-contract, x-onboarding-contract',
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
          : pipeline === 'onboarding'
            ? 'Onboarding'
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
    if (!url.pathname.startsWith('/api/')) return core.fetch(request, env);

    const origin = allowedOrigin(request);
    if (origin === false) {
      return new Response(JSON.stringify({ error: 'Origin is not allowed' }), {
        status: 403,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          vary: 'Origin'
        }
      });
    }

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 204, headers: { allow: CORS_METHODS } });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    let masteryProgressResponse: Response | null;
    try {
      masteryProgressResponse = await handleMasteryProgressV1Request(request, env);
    } catch (error) {
      const response = pipelineFailure(error, url.pathname, 'auth');
      return origin ? withCors(response, origin) : response;
    }
    if (masteryProgressResponse) return origin ? withCors(masteryProgressResponse, origin) : masteryProgressResponse;

    let authResponse: Response | null;
    try {
      authResponse = await handleAuthRequest(request, env);
    } catch (error) {
      const response = pipelineFailure(error, url.pathname, 'auth');
      return origin ? withCors(response, origin) : response;
    }
    if (authResponse) return origin ? withCors(authResponse, origin) : authResponse;

    let routedRequest = request;
    if (url.pathname !== '/api/health') {
      let auth: Awaited<ReturnType<typeof authenticateSession>>;
      try {
        auth = await authenticateSession(request, env);
      } catch (error) {
        const response = pipelineFailure(error, url.pathname, 'auth');
        return origin ? withCors(response, origin) : response;
      }
      if (auth instanceof Response) return origin ? withCors(auth, origin) : auth;

      let assessmentV2Response: Response | null;
      try {
        assessmentV2Response = await handleAssessmentReportV2Request(request, env, auth.userId);
      } catch (error) {
        const response = pipelineFailure(error, url.pathname, 'assessment');
        return origin ? withCors(response, origin) : response;
      }
      if (assessmentV2Response) return origin ? withCors(assessmentV2Response, origin) : assessmentV2Response;

      let assessmentResponse: Response | null;
      try {
        assessmentResponse = await handleAssessmentRequest(request, env, auth.userId);
      } catch (error) {
        const response = pipelineFailure(error, url.pathname, 'assessment');
        return origin ? withCors(response, origin) : response;
      }
      if (assessmentResponse) return origin ? withCors(assessmentResponse, origin) : assessmentResponse;

      let checkpointResponse: Response | null;
      try {
        checkpointResponse = await handleCheckpointRequest(request, env, auth.userId);
      } catch (error) {
        const response = pipelineFailure(error, url.pathname, 'checkpoint');
        return origin ? withCors(response, origin) : response;
      }
      if (checkpointResponse) return origin ? withCors(checkpointResponse, origin) : checkpointResponse;

      let capstoneResponse: Response | null;
      try {
        capstoneResponse = await handleCapstoneRequest(request, env, auth.userId);
      } catch (error) {
        const response = pipelineFailure(error, url.pathname, 'capstone');
        return origin ? withCors(response, origin) : response;
      }
      if (capstoneResponse) return origin ? withCors(capstoneResponse, origin) : capstoneResponse;

      let curriculumResponse: Response | null;
      try {
        curriculumResponse = await handleCurriculumRequest(request, env, auth.userId);
      } catch (error) {
        const response = pipelineFailure(error, url.pathname, 'curriculum');
        return origin ? withCors(response, origin) : response;
      }
      if (curriculumResponse) return origin ? withCors(curriculumResponse, origin) : curriculumResponse;

      let onboardingResponse: Response | null;
      try {
        onboardingResponse = await handleOnboardingRequest(request, env, auth.userId);
      } catch (error) {
        const response = pipelineFailure(error, url.pathname, 'onboarding');
        return origin ? withCors(response, origin) : response;
      }
      if (onboardingResponse) return origin ? withCors(onboardingResponse, origin) : onboardingResponse;

      const headers = new Headers(request.headers);
      headers.set('x-profile-id', auth.userId);
      routedRequest = new Request(request, { headers });
    }

    const response = await core.fetch(routedRequest, env);
    return origin ? withCors(response, origin) : response;
  }
} satisfies ExportedHandler<Cloudflare.Env>;
