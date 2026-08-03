import { expect, test, type Page } from '@playwright/test';

const capabilities = (enabled: boolean) => ({
  contract: 'commercial-capabilities-v1',
  authentication: { usernamePassword: true, recoveryCodes: true },
  integrations: {
    emailVerification: { enabled },
    smsVerification: { enabled: false },
    turnstile: { enabled: false },
    adminConsole: { enabled: false }
  }
});

async function mockCapabilities(page: Page, enabled: boolean) {
  await page.route('**/api/capabilities', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(capabilities(enabled))
  }));
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

test('desktop commercial runtime hides verified-contact UI when the capability is off', async ({ page }) => {
  await mockCapabilities(page, false);
  await page.goto('./');
  await expect(page.getByTestId('verified-contact-guest-actions')).toHaveCount(0);
  await expect(page.getByTestId('auth-submit')).toBeVisible();
});

test('desktop commercial runtime registers with a verified contact without skipping recovery codes', async ({ page }) => {
  await mockCapabilities(page, true);
  await page.route('**/api/auth/contact/challenge', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({
      challengeId: '11111111-1111-4111-8111-111111111111',
      channel: 'email',
      purpose: 'register',
      maskedDestination: 'u***@example.com',
      expiresAt: '2030-01-01 10:10:00',
      resendAt: '2030-01-01 10:01:00',
      attempts: 5
    })
  }));
  await page.route('**/api/auth/contact/confirm', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      verified: true,
      ticket: 'verified-contact-ticket',
      channel: 'email',
      purpose: 'register',
      maskedDestination: 'u***@example.com',
      expiresAt: '2030-01-01T10:10:00.000Z'
    })
  }));
  await page.route('**/api/auth/contact/register', route => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({
      session: {
        token: 'contact-registration-token',
        id: 'contact-registration-session',
        expiresAt: '2030-02-01 10:00:00',
        deviceName: 'Playwright',
        revision: 0
      },
      user: {
        id: 'contact-registration-user',
        username: 'contact_learner',
        displayName: 'Contact Learner',
        dailyMinutes: 25,
        locale: 'ru-RU',
        theme: 'dark'
      },
      recovery: {
        remaining: 8,
        generatedAt: '2030-01-01 10:00:00',
        canRegenerateAt: '2030-01-02 10:00:00'
      },
      recoveryCodes: Array.from({ length: 8 }, (_, index) => `SQLR-TEST-${String(index + 1).padStart(4, '0')}`),
      contacts: [{ channel: 'email', maskedDestination: 'u***@example.com', verifiedAt: '2030-01-01 10:00:00' }]
    })
  }));

  await page.goto('./');
  await page.getByRole('button', { name: 'Создать с контактом' }).click();
  const modal = page.getByTestId('verified-contact-modal');
  await expect(modal).toBeVisible();
  await modal.getByTestId('verified-contact-destination').fill('user@example.com');
  await modal.getByTestId('verified-contact-username').fill('contact_learner');
  await modal.getByRole('textbox', { name: 'Отображаемое имя' }).fill('Contact Learner');
  await modal.getByTestId('verified-contact-password').fill('Long contact password 2026!');
  await modal.getByLabel('Повтори пароль').fill('Long contact password 2026!');
  await modal.getByTestId('verified-contact-send').click();
  await modal.getByTestId('verified-contact-code').fill('123456');
  await modal.getByTestId('verified-contact-confirm').click();
  await expect(modal.getByText('Контакт подтверждён', { exact: true })).toBeVisible();
  await modal.getByTestId('verified-contact-complete').click();

  await expect(page.getByTestId('recovery-codes-screen')).toBeVisible();
  await expect(page.getByTestId('recovery-codes').locator('code')).toHaveCount(8);
  await expect(page.getByTestId('recovery-confirm')).toBeDisabled();
});

test('mobile password contact recovery launcher and modal stay within the Pixel 7 viewport', async ({ page }) => {
  await mockCapabilities(page, true);
  await page.goto('./');
  await page.getByRole('button', { name: 'Восстановить по контакту' }).click();
  await expect(page.getByTestId('verified-contact-modal')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByTestId('verified-contact-destination')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SMS' })).toHaveCount(0);
});
