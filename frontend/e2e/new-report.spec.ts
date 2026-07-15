import { test, expect, Route, Page } from '@playwright/test';

// FE-04: new report — credit-gated intake. Renders, 402 → amber banner + blocked submit, success routes onward.

const S = JSON.stringify({ token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });
async function seed(page: Page, balance: number) {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), S);
  await page.route('**/api/me/credits', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance, history: [] }) }));
}

test('form renders with the reserve hint', async ({ page }) => {
  await seed(page, 3);
  await page.goto('/#/new');
  await expect(page.getByTestId('new-report')).toBeVisible();
  await expect(page.getByText('What should inqi find?')).toBeVisible();
  await expect(page.getByText(/1 credit when ready · 3 available/)).toBeVisible();
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
  await page.route('**/api/reports', (r: Route) => r.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CREDITS_INSUFFICIENT', message: 'no credits' } }) }));
  await page.goto('/#/new');
  await page.getByPlaceholder(/Reformer pilates/).fill('a weekly tennis coach near Porto');
  await page.getByTestId('start-research').click();
  await expect(page.getByTestId('credits-banner')).toBeVisible();
});

/** Stub POST /api/reports (capturing the body) + the live view the app routes onto. */
async function stubCreate(page: Page): Promise<{ body: () => Record<string, unknown> | null }> {
  let captured: Record<string, unknown> | null = null;
  await page.route('**/api/reports', (r: Route) => {
    if (r.request().method() === 'POST') captured = r.request().postDataJSON() as Record<string, unknown>;
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'i1', rawRequest: 'x', state: 'RECEIVED', customerEmail: 'c@x.io', createdAt: '2026-06-29T00:00:00Z' }) });
  });
  // Hermetic: the live view fetch must not hit a real backend (the seeded token would 401 → signin bounce).
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reportId: 'i1', state: 'RECEIVED', delivered: false, rawRequest: 'a weekly tennis coach near Porto', snapshotToken: null, reusedFrom: null, summary: '', options: [] }) }));
  return { body: () => captured };
}

test('success creates the report and routes to the live view', async ({ page }) => {
  await seed(page, 2);
  await stubCreate(page);
  await page.goto('/#/new');
  await page.getByPlaceholder(/Reformer pilates/).fill('a weekly tennis coach near Porto');
  await page.getByTestId('start-research').click();
  await expect(page).toHaveURL(/#\/r\/i1/);
});

test('search criteria — Focus on QUALITY is the default and travels with the request', async ({ page }) => {
  await seed(page, 2);
  const created = await stubCreate(page);
  await page.goto('/#/new');

  // Quality is pre-selected in the search input; Price is not.
  await expect(page.getByTestId('focus-quality')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('focus-price')).toHaveAttribute('aria-pressed', 'false');

  await page.getByPlaceholder(/Reformer pilates/).fill('rooftop yoga classes in Bangkok');
  await page.getByTestId('start-research').click();
  await expect(page).toHaveURL(/#\/r\/i1/);

  // The server receives focus=quality → depth research evaluates presence + review volume.
  expect(created.body()).toMatchObject({ rawRequest: 'rooftop yoga classes in Bangkok', focus: 'quality' });
});

test('search criteria — Focus on PRICE is selectable and travels with the request', async ({ page }) => {
  await seed(page, 2);
  const created = await stubCreate(page);
  await page.goto('/#/new');

  // Toggle to Price: the selection flips (single-choice), Quality releases.
  await page.getByTestId('focus-price').click();
  await expect(page.getByTestId('focus-price')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('focus-quality')).toHaveAttribute('aria-pressed', 'false');

  await page.getByPlaceholder(/Reformer pilates/).fill('a weekly tennis coach near Porto');
  await page.getByTestId('start-research').click();
  await expect(page).toHaveURL(/#\/r\/i1/);

  // The server receives focus=price → depth research hunts the publicly announced price.
  expect(created.body()).toMatchObject({ rawRequest: 'a weekly tennis coach near Porto', focus: 'price' });
});
