import { test, expect, Route, Page } from '@playwright/test';

// FE-04: new inquiry — credit-gated intake. Renders, 402 → amber banner + blocked submit, success routes onward.

const S = JSON.stringify({ token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });
async function seed(page: Page, balance: number) {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), S);
  await page.route('**/api/me/credits', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance, history: [] }) }));
}

test('form renders with the reserve hint + SOON tag', async ({ page }) => {
  await seed(page, 3);
  await page.goto('/#/new');
  await expect(page.getByTestId('new-inquiry')).toBeVisible();
  await expect(page.getByText('What should inqi find?')).toBeVisible();
  await expect(page.getByText(/Reserves 1 credit · 3 available/)).toBeVisible();
  await expect(page.getByText('SOON')).toBeVisible();
});

test('zero balance shows the amber add-credits banner and blocks submit', async ({ page }) => {
  await seed(page, 0);
  await page.goto('/#/new');
  await expect(page.getByTestId('credits-banner')).toBeVisible();
  await page.getByPlaceholder(/Reformer pilates/).fill('a weekly tennis coach near Porto');
  await expect(page.getByTestId('start-research')).toBeDisabled();
});

test('a 402 on submit shows the banner', async ({ page }) => {
  await seed(page, 1); // looks fine client-side, but the server rejects
  await page.route('**/api/inquiries', (r: Route) => r.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CREDITS_INSUFFICIENT', message: 'no credits' } }) }));
  await page.goto('/#/new');
  await page.getByPlaceholder(/Reformer pilates/).fill('a weekly tennis coach near Porto');
  await page.getByTestId('start-research').click();
  await expect(page.getByTestId('credits-banner')).toBeVisible();
});

test('success creates the inquiry and routes to the live view', async ({ page }) => {
  await seed(page, 2);
  await page.route('**/api/inquiries', (r: Route) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'i1', rawRequest: 'x', state: 'RECEIVED', customerEmail: 'c@x.io', createdAt: '2026-06-29T00:00:00Z' }) }));
  await page.goto('/#/new');
  await page.getByPlaceholder(/Reformer pilates/).fill('a weekly tennis coach near Porto');
  await page.getByTestId('start-research').click();
  await expect(page).toHaveURL(/#\/i\/i1/);
});
