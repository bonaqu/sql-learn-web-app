# SQL Academy operational runbooks

These runbooks define the repository-supported operating boundary for a buyer-owned SQL Academy deployment.

- [Incident response](incident-response.md) — declaration, containment, diagnosis, recovery, verification and post-incident evidence.
- [Support triage](support-triage.md) — privacy-safe intake, categorisation, reproduction, escalation and closure.
- [Account recovery](account-recovery.md) — recovery-code and verified-contact flows, account-takeover handling and the no-bypass boundary.

## Operating principles

1. Preserve learner data and evidence before changing production state.
2. Use repository scripts and deployment workflows instead of ad-hoc production commands.
3. Never request or store passwords, recovery codes, one-time verification codes, session tokens, Turnstile tokens or provider secrets in a support ticket.
4. Keep diagnosis read-only until an incident commander records the containment or recovery decision.
5. A green deploy is not sufficient evidence: verify the affected user lifecycle and the public health/capability contracts.
6. Repository engineering evidence does not replace the buyer's legal, privacy, security or support policy review.

## Required ownership before commercial launch

The buyer must replace placeholders in its private operating system with named owners for incident command, Cloudflare/GitHub operations, application engineering, security/privacy review and learner communications. At least two authorised people must be able to access production deployment and recovery evidence; no production recovery process may depend on the seller's personal account.
