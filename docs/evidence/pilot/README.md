# Human-pilot aggregate evidence

No participant result file is present. This README is infrastructure, not learner evidence.

Only consented, privacy-safe aggregates may be added here:

- copy `docs/human-learning-pilot-report.template.json`;
- remove `_templateNotice` and replace every placeholder;
- name the result `pilot-YYYY-MM-DD-session-a.json` or `pilot-YYYY-MM-DD-complete.json`;
- run `npm run validate:pilot-evidence -- docs/evidence/pilot/<file>.json`;
- attach the reviewed aggregate and validator result to GitHub issue #82.

The validator accepts only a fixed field allowlist. It rejects direct-identifier fields, raw SQL/result fields, cohorts below five, invented Wilson intervals, unknown task/lesson IDs, impossible denominators and a delayed session outside the documented 7–14 day window. A `complete` report must include publishable `n >= 5` denominators for every required Session A/B KPI plus at least one canonical journey row from each session.

Never commit consent receipts, participant codes, names, contacts, credentials, exact timestamps, raw SQL, result rows, free-form notes, recordings or screenshots. Consent receipts remain outside the repository.

A structurally valid JSON file is not proof that consent occurred or that results are authentic. The product owner must review source custody, incident handling and issue #82 before changing the external-gate status.
