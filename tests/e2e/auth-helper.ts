import { expect, Page, type APIResponse } from '@playwright/test';

const WORKER_PORT = process.env.PLAYWRIGHT_WORKER_PORT || '8792';
const WORKER_URL = process.env.PLAYWRIGHT_WORKER_URL || `http://127.0.0.1:${WORKER_PORT}`;
const SESSION_KEY = 'sql-academy-auth-session-v2';
const WORKER_ATTEMPTS = 8;

export const TEST_PASSWORD = 'Correct horse battery staple 2026!';

export type TestAuth = {
  username: string;
  password: string;
  recoveryCodes: string[];
  session: Record<string, unknown>;
};

function testUsername(label: string) {
  const compact = label.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'test';
  const unique = `${Date.now().toString(36).slice(-7)}${Math.random().toString(36).slice(2, 7)}`;
  return `pw_${compact}_${unique}`.slice(0, 32);
}

async function retryDelay(page: Page, attempt: number) {
  await page.waitForTimeout(Math.min(3_000, 400 + attempt * 350));
}

async function postAfterWorkerRecovery(
  page: Page,
  path: string,
  data: Record<string, unknown>
): Promise<APIResponse> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= WORKER_ATTEMPTS; attempt += 1) {
    try {
      const response = await page.request.post(`${WORKER_URL}${path}`, { data });
      if (response.status() < 500 || attempt === WORKER_ATTEMPTS) return response;
      lastError = new Error(`${path} returned HTTP ${response.status()}: ${(await response.text()).slice(0, 500)}`);
    } catch (error) {
      lastError = error;
    }
    await retryDelay(page, attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(`${path} remained unavailable`);
}

function browserSession(payload: {
  session: { token: string; id: string; expiresAt: string; deviceName: string; revision: number };
  user: { id: string; username: string; displayName: string; dailyMinutes: number; locale: string; theme: string };
}) {
  return {
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
}

export async function registerTestUser(page: Page, label = 'academy'): Promise<TestAuth> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= WORKER_ATTEMPTS; attempt += 1) {
    const username = testUsername(`${label}${attempt}`);
    try {
      const response = await page.request.post(`${WORKER_URL}/api/auth/register`, {
        data: {
          username,
          password: TEST_PASSWORD,
          displayName: 'Playwright User',
          deviceName: `Playwright ${label}`
        }
      });
      if (response.status() >= 500) {
        lastError = new Error(`register returned HTTP ${response.status()}: ${(await response.text()).slice(0, 500)}`);
        await retryDelay(page, attempt);
        continue;
      }
      expect(response.ok(), await response.text()).toBe(true);
      const payload = await response.json() as {
        session: { token: string; id: string; expiresAt: string; deviceName: string; revision: number };
        user: { id: string; username: string; displayName: string; dailyMinutes: number; locale: string; theme: string };
        recoveryCodes: string[];
      };
      expect(payload.recoveryCodes).toHaveLength(8);
      const session = browserSession(payload);
      return { username, password: TEST_PASSWORD, recoveryCodes: payload.recoveryCodes, session };
    } catch (error) {
      lastError = error;
      if (attempt < WORKER_ATTEMPTS) await retryDelay(page, attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Unable to register Playwright user after Worker recovery');
}

export async function authenticatePage(page: Page, label = 'academy'): Promise<TestAuth> {
  const auth = await registerTestUser(page, label);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SESSION_KEY,
    value: auth.session
  });
  return auth;
}

export async function installAuthSession(page: Page, session: Record<string, unknown>) {
  await page.evaluate(({ key, value }) => {
    const { token, ...metadata } = value as { token?: unknown } & Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify(metadata));
    if (typeof token === 'string' && token) sessionStorage.setItem('sql-academy-auth-token-v1', token);
  }, { key: SESSION_KEY, value: session });
}

export async function loginPage(page: Page, username: string, password = TEST_PASSWORD) {
  const response = await postAfterWorkerRecovery(page, '/api/auth/login', {
    username,
    password,
    deviceName: 'Playwright second device'
  });
  expect(response.ok(), await response.text()).toBe(true);
  const payload = await response.json() as {
    session: { token: string; id: string; expiresAt: string; deviceName: string; revision: number };
    user: { id: string; username: string; displayName: string; dailyMinutes: number; locale: string; theme: string };
  };
  const session = browserSession(payload);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SESSION_KEY,
    value: session
  });
  return session;
}
