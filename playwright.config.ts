import { defineConfig, devices } from '@playwright/test';

const applicationPath = process.env.GITHUB_ACTIONS ? '/sql-learn-web-app/' : '/';
const applicationUrl = `http://127.0.0.1:4173${applicationPath}`;
const workerUrl = 'http://127.0.0.1:8787/api/health';

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
      command: 'npx wrangler dev --local --ip 127.0.0.1 --port 8787 --config wrangler.jsonc',
      url: workerUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 45_000
    }
  ],
  projects: [
    {
      name: 'desktop-chromium',
      grep: /desktop academy|desktop password account|desktop password recovery|desktop adaptive learning|desktop assessment|desktop accessibility|desktop curriculum/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } }
    },
    {
      name: 'mobile-chromium',
      grep: /mobile task flow|mobile password registration|mobile adaptive learning|mobile assessment|mobile accessibility|mobile curriculum/,
      use: { ...devices['Pixel 7'] }
    }
  ]
});
