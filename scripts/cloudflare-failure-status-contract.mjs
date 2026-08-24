export const CLOUDFLARE_DEPLOYMENT_WORKFLOW_NAME = 'Deploy Cloudflare Free Stack';

const terminalConclusions = new Set([
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
  'timed_out'
]);

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid workflow_run ${field}`);
  }
  return value.trim();
}

export function cloudflareFailureStatusForWorkflowRun(run) {
  if (!run || typeof run !== 'object') throw new Error('Invalid workflow_run payload');
  if (run.name !== CLOUDFLARE_DEPLOYMENT_WORKFLOW_NAME || run.event !== 'push') return null;
  if (run.conclusion === 'success') return null;

  const conclusion = requiredString(run.conclusion, 'conclusion');
  if (!terminalConclusions.has(conclusion)) {
    throw new Error(`Unsupported workflow_run conclusion: ${conclusion}`);
  }
  const sha = requiredString(run.headSha, 'head_sha');
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Invalid workflow_run head_sha');
  const targetUrl = requiredString(run.htmlUrl, 'html_url');
  const parsedUrl = new URL(targetUrl);
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('Invalid workflow_run html_url protocol');
  }

  return {
    sha,
    state: 'failure',
    context: 'deployment/cloudflare',
    description: `Cloudflare deployment ${conclusion} — open diagnostics`.slice(0, 140),
    target_url: targetUrl
  };
}
