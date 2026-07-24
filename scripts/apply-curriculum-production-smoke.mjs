import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, before, after, label) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  writeFileSync(path, source.replace(before, after));
}

patch(
  '.github/workflows/cloudflare.yml',
  `          test "$UNAUTH_STATUS" = "401"

          SMOKE_USERNAME="smoke_$(date +%s)_${GITHUB_RUN_ATTEMPT}"`,
  `          test "$UNAUTH_STATUS" = "401"

          CURRICULUM_UNAUTH_STATUS=$(curl --silent --output cloudflare-curriculum-unauthorized.json --write-out '%{http_code}' \
            "$DEPLOY_URL/api/curriculum/progress")
          test "$CURRICULUM_UNAUTH_STATUS" = "401"

          SMOKE_USERNAME="smoke_$(date +%s)_${GITHUB_RUN_ATTEMPT}"`,
  'Cloudflare unauthenticated curriculum smoke'
);

patch(
  '.github/workflows/cloudflare.yml',
  `          AUTH_TOKEN=$(node -e "const x=require('./cloudflare-register.json'); if(x.session?.token) process.stdout.write(x.session.token)")
          RECOVERY_CODE=$(node -e "const x=require('./cloudflare-register.json'); if(x.recoveryCodes?.[0]) process.stdout.write(x.recoveryCodes[0])")
          test -n "$AUTH_TOKEN"
          test -n "$RECOVERY_CODE"
          export AUTH_TOKEN RECOVERY_CODE`,
  `          AUTH_TOKEN=$(node -e "const x=require('./cloudflare-register.json'); if(x.session?.token) process.stdout.write(x.session.token)")
          RECOVERY_CODE=$(node -e "const x=require('./cloudflare-register.json'); if(x.recoveryCodes?.[0]) process.stdout.write(x.recoveryCodes[0])")
          SMOKE_USER_ID=$(node -e "const x=require('./cloudflare-register.json'); if(x.user?.id) process.stdout.write(x.user.id)")
          test -n "$AUTH_TOKEN"
          test -n "$RECOVERY_CODE"
          test -n "$SMOKE_USER_ID"
          export AUTH_TOKEN RECOVERY_CODE SMOKE_USER_ID`,
  'Cloudflare smoke user ID'
);

patch(
  '.github/workflows/cloudflare.yml',
  `          node - <<'NODE'
          const progress = require('./cloudflare-progress.json');
          if (progress.revision !== 0 || progress.progress !== null) {
            console.error('Unexpected initial progress:', progress);
            process.exit(1);
          }
          NODE

          node - <<'NODE' > cloudflare-delete-payload.json`,
  `          node - <<'NODE'
          const progress = require('./cloudflare-progress.json');
          if (progress.revision !== 0 || progress.progress !== null) {
            console.error('Unexpected initial progress:', progress);
            process.exit(1);
          }
          NODE

          curl --fail --silent --show-error --location \
            --header "authorization: Bearer $AUTH_TOKEN" \
            "$DEPLOY_URL/api/curriculum/progress" > cloudflare-curriculum-initial.json
          node - <<'NODE'
          const value = require('./cloudflare-curriculum-initial.json');
          if (value.progress !== null || value.updatedAt !== null) {
            console.error('Unexpected initial curriculum progress:', value);
            process.exit(1);
          }
          NODE

          node - <<'NODE' > cloudflare-curriculum-payload.json
          const now = new Date().toISOString();
          process.stdout.write(JSON.stringify({
            progress: {
              version: 1,
              completedSections: ['sql-thinking-concept'],
              completedLessons: [],
              completedProjects: [],
              answers: {
                'check-sql-thinking': { optionIndex: 1, correct: true, answeredAt: now }
              },
              projectDrafts: {
                'project-incident-command': {
                  sql: 'SELECT service, COUNT(*) FROM tickets GROUP BY service;',
                  notes: 'Deployment smoke draft',
                  completedDeliverables: ['incident-base'],
                  updatedAt: now
                }
              },
              bookmark: { lessonId: 'lesson-sql-thinking', sectionId: 'sql-thinking-concept', updatedAt: now },
              updatedAt: now
            },
            baseUpdatedAt: null
          }));
          NODE

          curl --fail --silent --show-error --location \
            --request PUT \
            --header "authorization: Bearer $AUTH_TOKEN" \
            --header 'content-type: application/json' \
            --data @cloudflare-curriculum-payload.json \
            "$DEPLOY_URL/api/curriculum/progress" > cloudflare-curriculum-put.json
          CURRICULUM_UPDATED_AT=$(node -e "const x=require('./cloudflare-curriculum-put.json'); if(x.ok && x.updatedAt) process.stdout.write(x.updatedAt)")
          test -n "$CURRICULUM_UPDATED_AT"
          export CURRICULUM_UPDATED_AT

          curl --fail --silent --show-error --location \
            --header "authorization: Bearer $AUTH_TOKEN" \
            "$DEPLOY_URL/api/curriculum/progress" > cloudflare-curriculum-get.json
          node - <<'NODE'
          const value = require('./cloudflare-curriculum-get.json');
          if (value.updatedAt !== process.env.CURRICULUM_UPDATED_AT
            || value.progress?.version !== 1
            || value.progress?.projectDrafts?.['project-incident-command']?.notes !== 'Deployment smoke draft'
            || value.progress?.answers?.['check-sql-thinking']?.correct !== true) {
            console.error('Curriculum round-trip failed:', value);
            process.exit(1);
          }
          NODE

          STALE_STATUS=$(curl --silent --show-error --location \
            --request PUT \
            --header "authorization: Bearer $AUTH_TOKEN" \
            --header 'content-type: application/json' \
            --data @cloudflare-curriculum-payload.json \
            --output cloudflare-curriculum-conflict.json \
            --write-out '%{http_code}' \
            "$DEPLOY_URL/api/curriculum/progress")
          test "$STALE_STATUS" = "409"
          node - <<'NODE'
          const value = require('./cloudflare-curriculum-conflict.json');
          if (!value.progress || !value.updatedAt || !String(value.error || '').includes('another device')) {
            console.error('Curriculum conflict contract failed:', value);
            process.exit(1);
          }
          NODE

          node - <<'NODE' > cloudflare-delete-payload.json`,
  'Cloudflare curriculum authenticated lifecycle'
);

patch(
  '.github/workflows/cloudflare.yml',
  `          node -e "const x=require('./cloudflare-delete.json'); if(!x.ok) process.exit(1)"

      - name: Upload deployment diagnostics`,
  `          node -e "const x=require('./cloudflare-delete.json'); if(!x.ok) process.exit(1)"

          npx wrangler d1 execute sql-academy --remote --config wrangler.deploy.jsonc \
            --command "SELECT COUNT(*) AS count FROM curriculum_progress WHERE user_id = '$SMOKE_USER_ID'" \
            --json > cloudflare-curriculum-cascade.json
          node - <<'NODE'
          const result = require('./cloudflare-curriculum-cascade.json');
          const count = Number(result?.[0]?.results?.[0]?.count);
          if (count !== 0) {
            console.error('Curriculum cascade cleanup failed:', result);
            process.exit(1);
          }
          NODE

      - name: Upload deployment diagnostics`,
  'Cloudflare curriculum cascade smoke'
);

patch(
  '.github/workflows/cloudflare.yml',
  `            cloudflare-unauthorized.json
            cloudflare-register-payload.json`,
  `            cloudflare-unauthorized.json
            cloudflare-curriculum-unauthorized.json
            cloudflare-register-payload.json`,
  'Cloudflare curriculum unauth diagnostics'
);

patch(
  '.github/workflows/cloudflare.yml',
  `            cloudflare-progress.json
            cloudflare-delete.json`,
  `            cloudflare-progress.json
            cloudflare-curriculum-initial.json
            cloudflare-curriculum-payload.json
            cloudflare-curriculum-put.json
            cloudflare-curriculum-get.json
            cloudflare-curriculum-conflict.json
            cloudflare-curriculum-cascade.json
            cloudflare-delete.json`,
  'Cloudflare curriculum diagnostics files'
);

patch(
  '.github/workflows/cloudflare.yml',
  `              description: success ? 'Cloudflare Worker deployed and auth smoke-tested' : 'Cloudflare deployment failed'`,
  `              description: success ? 'Cloudflare Worker deployed; auth, progress and curriculum smoke-tested' : 'Cloudflare deployment failed'`,
  'Cloudflare status description'
);

patch(
  'README.md',
  `8. регистрирует временного smoke-пользователя, проверяет bearer-session и progress API;
9. удаляет временный аккаунт паролем и recovery-кодом.`,
  `8. регистрирует временного smoke-пользователя и проверяет bearer-session;
9. проверяет task progress и curriculum API, включая round-trip и stale-write \`409\`;
10. удаляет временный аккаунт паролем и recovery-кодом;
11. напрямую подтверждает в D1 cascade-удаление curriculum row.`,
  'README production smoke steps'
);

console.log('Curriculum production smoke patch applied.');
