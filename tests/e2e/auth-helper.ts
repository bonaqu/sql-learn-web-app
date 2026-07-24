import { expect, Page } from '@playwright/test';

const WORKER_URL = 'http://127.0.0.1:8787';
const SESSION_KEY = 'sql-academy-auth-session-v2';

export const TEST_PASSWORD = 'Correct horse battery staple 2026!';

export type TestAuth = {
  username: string;
  password: string;
  recoveryCodes: string[];
  session: Record<string, unknown>;
};

export async function authenticatePage(page: Page, label = 'academy'): Promise<TestAuth> {
  const username = `pw_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
  const response = await page.request.post(`${WORKER_URL}/api/auth/register`, {
    data: {
      username,
      password: TEST_PASSWORD,
      displayName: 'Playwright User',
      deviceName: `Playwright ${label}`
    }
  });
  expect(response.ok(), await response.text()).toBe(true);
  const payload = await response.json() as {
    session: { token: string; id: string; expiresAt: string; deviceName: string; revision: number };
    user: { id: string; username: string; displayName: string; dailyMinutes: number; locale: string; theme: string };
    recoveryCodes: string[];
  };
  expect(payload.recoveryCodes).toHaveLength(8);
  const session = {
    version: 2,
    token: payload.session.token,
    id: payload.session.id,
    userId: payload.user.id,
    username: payload.user.username,
    displayName: payload.user.displayName,
    dailyMinutes: payload.user.dailyMinutes,
    locale: payload.user.locale,
    theme: payload.user.theme,
    expiresAt: payload.session.expiresAt,
    deviceName: payload.session.deviceName,
    revision: payload.session.revision
  };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SESSION_KEY,
    value: session
  });
  return { username, password: TEST_PASSWORD, recoveryCodes: payload.recoveryCodes, session };
}

export async function loginPage(page: Page, username: string, password = TEST_PASSWORD) {
  const response = await page.request.post(`${WORKER_URL}/api/auth/login`, {
    data: { username, password, deviceName: 'Playwright second device' }
  });
  expect(response.ok(), await response.text()).toBe(true);
  const payload = await response.json() as {
    session: { token: string; id: string; expiresAt: string; deviceName: string; revision: number };
    user: { id: string; username: string; displayName: string; dailyMinutes: number; locale: string; theme: string };
  };
  const session = {
    version: 2,
    token: payload.session.token,
    id: payload.session.id,
    userId: payload.user.id,
    username: payload.user.username,
    displayName: payload.user.displayName,
    dailyMinutes: payload.user.dailyMinutes,
    locale: payload.user.locale,
    theme: payload.user.theme,
    expiresAt: payload.session.expiresAt,
    deviceName: payload.session.deviceName,
    revision: payload.session.revision
  };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SESSION_KEY,
    value: session
  });
  return session;
}
