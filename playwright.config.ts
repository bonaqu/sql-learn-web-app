import { defineConfig, devices } from '@playwright/test';

const applicationPath = process.env.GITHUB_ACTIONS ? '/sql-learn-web-app/' : '/';
const applicationUrl = `http://127.0.0.1:4173${applicationPath}`;
const workerUrl = 'http://127.0.0.1:8787/api/health';

const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } };
const mobile = { ...devices['Pixel 7'] };

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 110_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: applicationUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: [
    {
      command: `npm run preview -- --host 127.0.0.1 --port 4173 --base ${applicationPath}`,
      url: applicationUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000
    },
    {
      command: "bash -lc 'set -o pipefail; npx wrangler dev --local --ip 127.0.0.1 --port 8787 --config wrangler.jsonc 2>&1 | tee wrangler-playwright.log'",
      url: workerUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 45_000
    }
  ],
  projects: [
    {
      name: 'desktop-foundation',
      grep: /desktop academy|desktop accessibility|desktop password|desktop assessment|desktop diagnostic exam|desktop capstone|desktop checkpoint/,
      use: desktop
    },
    {
      name: 'desktop-learning',
      grep: /desktop curriculum|desktop guided journey|desktop adaptive learning|desktop mastery|desktop onboarding|desktop syllabus|desktop keeps SQLite|desktop analytics/,
      use: desktop
    },
    {
      name: 'mobile-foundation',
      grep: /mobile task flow|mobile guided journey|mobile password|mobile assessment|mobile checkpoint|mobile accessibility|mobile capstone/,
      use: mobile
    },
    {
      name: 'mobile-learning',
      grep: /mobile misconception|mobile adaptive learning|mobile mastery|mobile onboarding|mobile syllabus|mobile blocks unsafe|mobile analytics/,
      use: mobile
    }
  ]
});
