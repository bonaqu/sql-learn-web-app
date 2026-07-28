# Security policy

## Supported release

Only the current production commit on `bonaqu_projects` is supported.

## Reporting

Do not open a public issue containing credentials, recovery codes, session tokens,
private learner data, or exploit details. Before a commercial transfer, the buyer
must replace this section with a private security contact and disclosure SLA.

## Current boundary

- email/SMS verification, Turnstile and operator administration are disabled by default;
- no secret belongs in source control;
- production credentials are supplied only through GitHub Actions and Cloudflare secrets;
- a commercial launch requires the checklist in `docs/commercial-product-roadmap.md`.
