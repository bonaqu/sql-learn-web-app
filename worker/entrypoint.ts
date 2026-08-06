import worker from './index';
import { handleScheduledAdminAlerts } from './admin-alert-routing';

// The production Worker historically registered @cloudflare/sandbox's Durable Object.
// Keep this named export on the active entrypoint so new versions remain compatible
// with existing Durable Object metadata even when the free-tier config has no binding.
export { Sandbox } from '@cloudflare/sandbox';

export default {
  async fetch(request: Request, env: Cloudflare.Env, context: ExecutionContext) {
    return worker.fetch(request, env, context);
  },

  async scheduled(controller: ScheduledController, env: Cloudflare.Env, _context: ExecutionContext) {
    await handleScheduledAdminAlerts(controller, env);
  }
} satisfies ExportedHandler<Cloudflare.Env>;
