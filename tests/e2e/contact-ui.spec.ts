import { expect, Page, test } from '@playwright/test';
import { authenticatePage, TEST_PASSWORD } from './auth-helper';

const capabilities = {
  contract: 'commercial-capabilities-v1',
  authentication: {
    usernamePassword: true,
    recoveryCodes: true,
    contactLogin: {
      passwordRequired: true,
      email: { enabled: true },
      sms: { enabled: false }
    }
  },
  registration: {
    contactPolicy: 'optional',
    policyReady: true,
    contactlessAllowed: true
  },
  integrations: {
    emailVerification: { enabled: true },
    smsVerification: { enabled: false },
    turnstile: { enabled: false },
    adminConsole: { enabled: false }
  }
};

async function mockEmailCapability(page: Page, override: Partial<typeof capabilities['registration']> = {}) {
  await page.route('**/api/capabilities', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...capabilities, registration: { ...capabilities.registration, ...override } })
  }));
}

async function mockProgressSync(page: Page) {
  await page.route('**/api/mastery/progress', async route => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, revision: 1, updatedAt: '2026-08-05T00:00:00.000Z' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ progress: null, revision: 0, updatedAt: null })
    });
  });
}

async function mockVerification(page: Page, purpose: 'register' | 'password-reset' | 'sensitive-action') {
  await page.route('**/api/auth/contact/challenge', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.channel).toBe('email');
    expect(body.purpose).toBe(purpose);
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        challengeId: '11111111-1111-4111-8111-111111111111',
        channel: 'email',
        purpose,
        maskedDestination: 'j***@example.com',
        expiresAt: '2026-08-02 21:10:00',
        resendAt: '2026-08-02 21:01:00',
        attempts: 5
      })
    });
  });
  await page.route('**/api/auth/contact/confirm', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.code).toBe('123456');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        verified: true,
        ticket: `signed-${purpose}-ticket`,
        channel: 'email',
        purpose,
        maskedDestination: 'j***@example.com',
        expiresAt: '2026-08-02T21:10:00.000Z'
      })
    });
  });
}

async function enterVerifiedEmail(page: Page) {
  await page.getByTestId('contact-destination').fill('jane@example.com');
  await page.getByTestId('contact-send-code').click();
  await expect(page.getByText('Код отправлен на j***@example.com.')).toBeVisible();
  await page.getByTestId('contact-code').fill('123456');
  await page.getByTestId('contact-confirm-code').click();
  await expect(page.getByText(/Email подтверждён/)).toBeVisible();
}

test('desktop verified contact UI stays absent when provider capabilities are disabled', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('auth-submit')).toBeVisible();
  await expect(page.getByTestId('commercial-contact-entry')).toHaveCount(0);
  await expect(page.getByTestId('verified-contact-launcher')).toHaveCount(0);
  await expect(page.getByTestId('contact-login-launcher')).toHaveCount(0);
  await expect(page.locator('script[data-sql-academy-turnstile]')).toHaveCount(0);
});

test('desktop verified contact login sends an explicit identifier type and no verification code', async ({ page }) => {
  await mockEmailCapability(page);
  await mockProgressSync(page);
  let challengeRequests = 0;
  await page.route('**/api/auth/contact/challenge', async route => {
    challengeRequests += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'must not be called' }) });
  });
  await page.route('**/api/auth/login', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({
      identifierType: 'email',
      identifier: 'jane@example.com',
      password: TEST_PASSWORD
    });
    expect(body).not.toHaveProperty('username');
    expect(body).not.toHaveProperty('code');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: {
          token: 'verified-contact-login-token',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          expiresAt: '2026-09-05 00:00:00',
          deviceName: 'ПК · Playwright',
          revision: 0
        },
        user: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          username: 'verified_user',
          displayName: 'Verified User',
          dailyMinutes: 25,
          locale: 'ru-RU',
          theme: 'dark'
        },
        recovery: { remaining: 8, generatedAt: '2026-08-05 00:00:00', canRegenerateAt: '2026-08-06 00:00:00' }
      })
    });
  });

  await page.goto('./');
  await page.getByTestId('contact-login-launcher').click();
  await expect(page.getByTestId('contact-login-modal')).toBeVisible();
  await page.getByTestId('contact-login-identifier').fill('jane@example.com');
  await page.getByTestId('contact-login-password').fill(TEST_PASSWORD);
  await page.getByTestId('contact-login-submit').click();
  await expect(page.getByTestId('contact-login-modal')).toHaveCount(0);
  await expect(page.getByTestId('auth-submit')).toHaveCount(0);
  expect(challengeRequests).toBe(0);
});

test('required registration policy is explicit without locking out existing users', async ({ page }) => {
  await mockEmailCapability(page, {
    contactPolicy: 'required-for-new-registration',
    policyReady: true,
    contactlessAllowed: false
  });
  await page.goto('./');
  await expect(page.getByText('Контакт обязателен для новых аккаунтов')).toBeVisible();
  await expect(page.getByText(/Существующие пользователи сохраняют вход по логину/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подтвердить контакт и зарегистрироваться', exact: true })).toBeVisible();
  await expect(page.getByTestId('auth-submit')).toBeVisible();
});

test('desktop verified contact registration enters the mandatory recovery-code gate', async ({ page }) => {
  await mockEmailCapability(page);
  await mockVerification(page, 'register');
  await page.route('**/api/auth/contact/register', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.contactTicket).toBe('signed-register-ticket');
    expect(body.username).toBe('verified_user');
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        session: {
          token: 'verified-contact-session-token',
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          expiresAt: '2026-09-01 21:00:00',
          deviceName: 'ПК · Playwright',
          revision: 0
        },
        user: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          username: 'verified_user',
          displayName: 'Verified User',
          dailyMinutes: 25,
          locale: 'ru-RU',
          theme: 'dark'
        },
        recoveryCodes: Array.from({ length: 8 }, (_, index) => `SQLR-TEST-${String(index + 1).padStart(4, '0')}`),
        recovery: {
          remaining: 8,
          generatedAt: '2026-08-02 21:00:00',
          canRegenerateAt: '2026-08-03 21:00:00'
        },
        contacts: [{ channel: 'email', maskedDestination: 'j***@example.com', verifiedAt: '2026-08-02 21:00:00' }]
      })
    });
  });

  await page.goto('./');
  await expect(page.getByTestId('commercial-contact-entry')).toBeVisible();
  await page.getByRole('button', { name: 'Регистрация с контактом', exact: true }).click();
  await enterVerifiedEmail(page);
  const modal = page.getByTestId('contact-register-modal');
  await modal.getByTestId('contact-register-username').fill('verified_user');
  await modal.getByLabel('Отображаемое имя необязательно').fill('Verified User');
  await modal.getByTestId('contact-new-password').fill(TEST_PASSWORD);
  await modal.getByTestId('contact-new-password-confirm').fill(TEST_PASSWORD);
  await modal.getByTestId('contact-finish').click();

  await expect(page.getByTestId('recovery-codes-screen')).toBeVisible();
  await expect(page.getByTestId('recovery-codes').locator('code')).toHaveCount(8);
  await expect(page.locator('script[data-sql-academy-turnstile]')).toHaveCount(0);
});

test('desktop verified contact recovery revokes sessions through the bound destination', async ({ page }) => {
  await mockEmailCapability(page);
  await mockVerification(page, 'password-reset');
  await page.route('**/api/auth/contact/password/reset', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.contactTicket).toBe('signed-password-reset-ticket');
    expect(body.newPassword).toBe(TEST_PASSWORD);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'Пароль изменён. Все старые сессии отключены.' })
    });
  });

  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Восстановить через контакт', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Восстановить через контакт', exact: true }).click();
  await enterVerifiedEmail(page);
  await page.getByTestId('contact-new-password').fill(TEST_PASSWORD);
  await page.getByTestId('contact-new-password-confirm').fill(TEST_PASSWORD);
  await page.getByTestId('contact-finish').click();
  await expect(page.getByRole('heading', { name: 'Пароль изменён' })).toBeVisible();
  await expect(page.getByText('Все старые сессии отозваны.')).toBeVisible();
});

test('desktop verified contact binding lists only a masked destination', async ({ page }) => {
  await mockEmailCapability(page);
  await authenticatePage(page, 'contact-bind');
  await mockVerification(page, 'sensitive-action');
  let contacts: Array<Record<string, string>> = [];
  await page.route('**/api/auth/contacts', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ contacts })
  }));
  await page.route('**/api/auth/contact/attach', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.contactTicket).toBe('signed-sensitive-action-ticket');
    expect(body.currentPassword).toBe(TEST_PASSWORD);
    contacts = [{
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      channel: 'email',
      maskedDestination: 'j***@example.com',
      verifiedAt: '2026-08-02 21:00:00',
      createdAt: '2026-08-02 21:00:00'
    }];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, contacts })
    });
  });

  await page.goto('./');
  await expect(page.getByTestId('verified-contact-launcher')).toBeVisible();
  await page.getByTestId('verified-contact-launcher').click();
  await expect(page.getByTestId('verified-contact-drawer')).toBeVisible();
  await expect(page.getByTestId('verified-contact-card')).toBeVisible();
  await page.getByRole('button', { name: 'Привязать email', exact: true }).click();
  await enterVerifiedEmail(page);
  await page.getByTestId('contact-current-password').fill(TEST_PASSWORD);
  await page.getByTestId('contact-finish').click();
  await expect(page.getByRole('heading', { name: 'Контакт привязан' })).toBeVisible();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByTestId('verified-contact-launcher').click();
  await expect(page.getByText('j***@example.com')).toBeVisible();
  await expect(page.getByText('jane@example.com')).toHaveCount(0);
});

test('mobile verified contact registration remains inside the Pixel 7 viewport', async ({ page }) => {
  await mockEmailCapability(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Регистрация с контактом', exact: true }).click();
  await expect(page.getByTestId('contact-register-modal')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  const box = await page.getByTestId('contact-register-modal').boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(413);
});