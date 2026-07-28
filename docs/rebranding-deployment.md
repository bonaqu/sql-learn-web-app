# Buyer-owned rebranding and deployment

The product must be transferable without leaving runtime dependencies on the seller's GitHub name, domain or Cloudflare account.

## Configuration layers

### Frontend build variables

- `VITE_PRODUCT_NAME`;
- `VITE_SUPPORT_URL`;
- `VITE_TERMS_URL`;
- `VITE_PRIVACY_URL`;
- future `VITE_TURNSTILE_SITE_KEY` only when server Turnstile is fully active.

These values affect presentation and links. They do not enable a protected server capability.

### Worker variables

- `PRODUCT_NAME`;
- `DEPLOYMENT_ENVIRONMENT`;
- `ALLOWED_ORIGINS`;
- `FEATURE_*` switches;
- provider names/endpoints/senders;
- Turnstile hostname allowlist;
- operator user-ID allowlist.

### Worker secrets

- provider API keys;
- Turnstile secret key;
- any future signing or encryption key.

Secrets must be created in the buyer-owned Cloudflare environment and must not appear in `.env`, Wrangler JSON, repository variables, logs or transfer documents.

## Required buyer-owned resources

Create separate staging and production resources:

- GitHub repository and environments;
- Cloudflare Worker names;
- D1 databases;
- KV namespaces;
- API tokens with least privilege;
- domains and DNS;
- legal/support destinations;
- optional Workers AI binding and budget policy.

Do not point staging at the production D1 or KV namespace.

## Rebranding checklist

1. Change frontend and Worker product names.
2. Replace support, Terms and Privacy URLs only after approved destinations exist.
3. Replace Worker/D1/KV names and IDs in deployment configuration.
4. Configure exact buyer origins; remove `https://bonaqu.github.io` in the buyer deployment.
5. Replace repository security contact, CODEOWNERS and transaction-specific license documents.
6. Search source and generated assets for `bonaqu`, old Worker names and old domains.
7. Rebuild from a clean checkout and verify the output contains only buyer-approved branding.

## Staging before production

A buyer deployment is accepted only after:

- migrations apply to an empty staging D1;
- full PR Quality passes;
- production lifecycle smokes pass against staging;
- backup/export and restore rehearsal are recorded;
- all optional capabilities report the intended state through `/api/capabilities`;
- malicious origins receive `403` and approved origins receive exact CORS headers;
- legal and support links are reachable;
- a dedicated learner account completes first-run → first task → cross-device sync → deletion.

## Production health variable

Set GitHub repository variable `PRODUCTION_HEALTH_URL` to the buyer deployment. The scheduled workflow is designed to be portable: it does not contain the current owner's URL and does not require a secret for public health checks.

## Rollback

For optional commercial capabilities, the fastest safe rollback is the corresponding server feature flag to `off`. For application code, use the buyer's recorded Worker version rollback procedure. For data incidents, prefer the buyer's rehearsed D1 Time Travel path when available, while preserving the SQL export/checksum evidence for audit and transfer.

## Current repository boundary

The included configuration keeps all optional integrations off. The current `https://bonaqu.github.io` allowed origin exists only for the present deployment and is deliberately a variable rather than a code constant. A buyer must replace it before acceptance.
