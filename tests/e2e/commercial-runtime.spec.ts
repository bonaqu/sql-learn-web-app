import { expect, test } from '@playwright/test';

const worker = 'http://127.0.0.1:8787';

function smokeIdentity() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  return { username: `commercial_${suffix}`.slice(0, 32), password: `Commercial-${suffix}-Password!aA1` };
}

test('desktop commercial runtime stays default-off, hidden and fail-closed', async ({ request }) => {
  const response = await request.get(`${worker}/api/capabilities`, { headers: { origin: 'http://127.0.0.1:4173' } });
  expect(response.status()).toBe(200);
  expect(response.headers()['access-control-allow-origin']).toBe('http://127.0.0.1:4173');
  expect(response.headers()['x-commercial-capabilities-contract']).toBe('commercial-capabilities-v1');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(await response.json()).toEqual({
    contract: 'commercial-capabilities-v1',
    authentication: {
      usernamePassword: true,
      recoveryCodes: true,
      contactLogin: {
        passwordRequired: true,
        email: { enabled: false },
        sms: { enabled: false }
      }
    },
    registration: {
      contactPolicy: 'optional',
      policyReady: true,
      contactlessAllowed: true
    },
    integrations: {
      emailVerification: { enabled: false },
      smsVerification: { enabled: false },
      turnstile: { enabled: false },
      adminConsole: { enabled: false }
    }
  });

  const hiddenAdmin = await request.get(`${worker}/api/admin/health`);
  expect(hiddenAdmin.status()).toBe(404);
  expect(await hiddenAdmin.json()).toEqual({ error: 'Not found' });

  const rejectedOrigin = await request.get(`${worker}/api/capabilities`, { headers: { origin: 'https://evil.example.net' } });
  expect(rejectedOrigin.status()).toBe(403);
  expect(rejectedOrigin.headers()['access-control-allow-origin']).toBeUndefined();

  const identity = smokeIdentity();
  const registration = await request.post(`${worker}/api/auth/register`, {
    data: { username: identity.username, password: identity.password, displayName: 'Commercial Runtime Smoke', deviceName: 'Playwright' }
  });
  expect(registration.status()).toBe(201);
  const registered = await registration.json();
  expect(registered.session?.token).toEqual(expect.any(String));
  expect(registered.recoveryCodes).toHaveLength(8);

  const deletion = await request.delete(`${worker}/api/profile`, {
    headers: { authorization: `Bearer ${registered.session.token}` },
    data: { currentPassword: identity.password, recoveryCode: registered.recoveryCodes[0], confirm: 'DELETE' }
  });
  expect(deletion.status()).toBe(200);
  expect(await deletion.json()).toEqual({ ok: true });
});
