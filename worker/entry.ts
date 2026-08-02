import app from './index';
import { handleResendDeliveryEvent, handleTwilioDeliveryEvent } from './contact-delivery-events';
import { cleanupContactObservability } from './contact-observability';
import { observeContactSecurityResponse } from './contact-security-routes';
import { handleContactStagingProbe } from './contact-staging-probe';
import { withSecurityHeaders } from './http-security';

export { Sandbox } from '@cloudflare/sandbox';

function operationalFailure(error: unknown, pathname: string) {
  const requestId = crypto.randomUUID();
  console.error('contact_operational_pipeline_unhandled', {
    requestId,
    pathname,
    name: error instanceof Error ? error.name.slice(0, 80) : 'UnknownError',
    message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
  });
  return new Response(JSON.stringify({
    error: 'Contact operational pipeline failed',
    code: 'CONTACT_OPERATIONAL_PIPELINE_UNHANDLED',
    requestId
  }), {
    status: 500,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-request-id': requestId
    }
  });
}

export default {
  async fetch(request: Request, env: Cloudflare.Env, context: ExecutionContext) {
    const pathname = new URL(request.url).pathname;
    try {
      if (pathname === '/api/integrations/resend/events') {
        return withSecurityHeaders(await handleResendDeliveryEvent(request, env), request);
      }
      if (pathname === '/api/integrations/twilio/status') {
        return withSecurityHeaders(await handleTwilioDeliveryEvent(request, env), request);
      }
      if (pathname === '/api/ops/contact-staging/timeline') {
        const response = await handleContactStagingProbe(request, env);
        if (response) return withSecurityHeaders(response, request);
      }
    } catch (error) {
      return withSecurityHeaders(operationalFailure(error, pathname), request);
    }

    const observedRequest = request.clone();
    const response = await app.fetch(request, env);
    context.waitUntil(observeContactSecurityResponse(observedRequest, response.clone(), env));
    return response;
  },

  async scheduled(_controller: ScheduledController, env: Cloudflare.Env, context: ExecutionContext) {
    context.waitUntil(cleanupContactObservability(env));
  }
} satisfies ExportedHandler<Cloudflare.Env>;