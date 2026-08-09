import { handleMasteryProgressRequest } from './mastery-progress';

const MASTERY_PROGRESS_PATH = '/api/mastery/progress';
const LEGACY_PROGRESS_PATH = '/api/user/progress';

function withContractHeader(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('x-progress-contract', 'mastery-v1');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function handleMasteryProgressV1Request(request: Request, env: Cloudflare.Env) {
  const url = new URL(request.url);
  if (url.pathname !== MASTERY_PROGRESS_PATH && url.pathname !== LEGACY_PROGRESS_PATH) return null;

  const routedRequest = url.pathname === LEGACY_PROGRESS_PATH
    ? request
    : (() => {
        const routedUrl = new URL(request.url);
        routedUrl.pathname = LEGACY_PROGRESS_PATH;
        return new Request(routedUrl.toString(), request);
      })();
  const response = await handleMasteryProgressRequest(routedRequest, env);
  if (!response) {
    throw new Error('Mastery progress route did not resolve the strict progress handler');
  }
  return withContractHeader(response);
}
