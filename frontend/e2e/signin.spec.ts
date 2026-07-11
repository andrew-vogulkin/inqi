import { test, expect } from '@playwright/test';

// FE-02: two-step email sign-in (email → MFA code, mock 123456) → Dashboard; app-wide 401 → Sign in.

const SESSION = { token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } };

test('two-step email + code sign-in routes to the Dashboard', async ({ page }) => {
  await page.route('**/api/auth/email/verify', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(SESSION) }));
  await page.route('**/api/auth/email', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ sent: true }) }));
  await page.route('**/api/reports', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/me/credits', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: 1, history: [] }) }));

  await page.goto('/#/signin');
  await expect(page.getByText('First report is free')).toBeVisible();

  // Step 1 — email
  await page.getByPlaceholder('you@example.com').fill('c@x.io');
  await page.getByTestId('signin-button').click();

  // Step 2 — the MFA code boxes (mock transport: 123456); typing auto-advances box to box
  await expect(page.getByText('We sent a 6-digit code')).toBeVisible();
  await page.getByTestId('otp-0').click();
  await page.keyboard.type('123456');
  await expect(page.getByTestId('otp-5')).toHaveValue('6');
  await page.getByTestId('verify-button').click();

  await expect(page).toHaveURL(/#\/dashboard/);
  await expect(page.getByText('Your reports')).toBeVisible();
});

test('a wrong code shows the error and stays on the code step', async ({ page }) => {
  await page.route('**/api/auth/email/verify', (r) => r.fulfill({
    status: 401, contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'AUTH_INVALID_CODE', message: 'That verification code is incorrect — check the 6 digits and try again.' } }),
  }));
  await page.route('**/api/auth/email', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ sent: true }) }));

  await page.goto('/#/signin');
  await page.getByPlaceholder('you@example.com').fill('c@x.io');
  await page.getByTestId('signin-button').click();
  await page.getByTestId('otp-0').click();
  await page.keyboard.type('000000');
  await page.getByTestId('verify-button').click();

  await expect(page.getByTestId('signin-error')).toContainText('verification code is incorrect');
  await expect(page.getByTestId('otp-0')).toBeVisible(); // still on the code step
});

test('explicit sign-out leaves a CLEAN sign-in URL (no returnTo to strand the next user)', async ({ page }) => {
  const ADMIN = { token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } };
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), JSON.stringify(ADMIN));
  await page.route('**/api/admin/reports*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], nextCursor: null }) }));

  await page.goto('/#/admin');
  await page.getByText('sign out').click();
  await expect(page).toHaveURL(/#\/signin$/); // NOT /#/signin?returnTo=%2Fadmin
});

test('a stale returnTo=/admin is ignored for a customer sign-in (lands on Dashboard, not 403)', async ({ page }) => {
  await page.route('**/api/auth/email/verify', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(SESSION) }));
  await page.route('**/api/auth/email', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ sent: true }) }));
  await page.route('**/api/reports', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/me/credits', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: 1, history: [] }) }));

  // The bug: an operator signed out on /admin left this URL behind; a customer signs in next.
  await page.goto('/#/signin?returnTo=%2Fadmin');
  await page.getByPlaceholder('you@example.com').fill('c@x.io');
  await page.getByTestId('signin-button').click();
  await page.getByTestId('otp-0').click();
  await page.keyboard.type('123456');
  await page.getByTestId('verify-button').click();

  await expect(page).toHaveURL(/#\/dashboard/); // role-aware home — not the admin 403
  await expect(page.getByText('For operators')).toHaveCount(0);
});

test('a 401 anywhere returns to Sign in', async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), JSON.stringify(SESSION));
  const unauth = { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }) };
  await page.route('**/api/reports', (r) => r.fulfill(unauth));
  await page.route('**/api/me/credits', (r) => r.fulfill(unauth));

  await page.goto('/#/dashboard');
  await expect(page).toHaveURL(/#\/signin/);
});
