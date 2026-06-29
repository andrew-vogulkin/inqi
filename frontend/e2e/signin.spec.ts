import { test, expect } from '@playwright/test';

// FE-02: Continue-with-Google (stub) → busy → Dashboard; app-wide 401 → Sign in.

const SESSION = { token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } };

test('stub sign-in routes to the Dashboard', async ({ page }) => {
  await page.route('**/api/auth/google', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
  await page.route('**/api/inquiries', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/me/credits', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: 1, history: [] }) }));

  await page.goto('/#/signin');
  await expect(page.getByText('First report is free')).toBeVisible();
  await page.getByPlaceholder('your email').fill('c@x.io');
  await page.getByRole('button', { name: /Continue with Google/ }).click();

  await expect(page).toHaveURL(/#\/dashboard/);
  await expect(page.getByText('Your inquiries')).toBeVisible();
});

test('a 401 anywhere returns to Sign in', async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), JSON.stringify(SESSION));
  const unauth = { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }) };
  await page.route('**/api/inquiries', (r) => r.fulfill(unauth));
  await page.route('**/api/me/credits', (r) => r.fulfill(unauth));

  await page.goto('/#/dashboard');
  await expect(page).toHaveURL(/#\/signin/);
});
