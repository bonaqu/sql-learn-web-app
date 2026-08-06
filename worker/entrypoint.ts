import worker from './index';
import { handleScheduledAdminAlerts } from './admin-alert-routing';

export default {
  async fetch(request: Request, env: Cloudflare.Env, context: ExecutionContext) {
    return worker.fetch(request, env, context);
  },

  async scheduled(controller: ScheduledController, env: Cloudflare.Env, _context: ExecutionContext) {
    await handleScheduledAdminAlerts(controller, env);
  }
} satisfies ExportedHandler<Cloudflare.Env>;
