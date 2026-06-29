import { test, expect, Route, Page } from '@playwright/test';

// API-01: a 401 from any HTTP call clears the session + redirects to Sign in (global handler).

const SESSION = JSON.stringify({ token: 'expired', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });

async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), SESSION); }

test('a 401 from a data call redirects to Sign in', async ({ page }) => {
  await seed(page);
  // The session looks valid client-side, but the server rejects it → global 401 handler fires.
  await page.route('**/api/inquiries', (r: Route) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }) }));
  await page.route('**/api/me/credits', (r: Route) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_TOKEN_EXPIRED' } }) }));

  await page.goto('/#/dashboard');
  await expect(page).toHaveURL(/#\/signin/);
});
