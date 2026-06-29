import { test, expect, Route, Page } from '@playwright/test';

// FE-09: credits — balance + ledger, top-up request (no balance change), manual refresh, empty state.

const SESSION = JSON.stringify({ token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });
const now = new Date().toISOString();
const history = [
  { id: 'l1', kind: 'topup', amount: 5, reason: 'Onboarding grant', createdAt: now },
  { id: 'l2', kind: 'reserve', amount: 1, reason: 'Report run', inquiryId: 'inq11111aaaa', createdAt: now },
  { id: 'l3', kind: 'charge', amount: 1, reason: 'Report delivered', inquiryId: 'inq11111aaaa', createdAt: now },
];

async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), SESSION); }

test('renders balance + ledger; top-up request shows a toast with no balance change; refresh updates', async ({ page }) => {
  await seed(page);
  let bal = 2;
  await page.route('**/api/me/credits', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: bal, history }) }));

  await page.goto('/#/credits');
  await expect(page.getByTestId('balance')).toHaveText('2');
  await expect(page.getByText('Top-up', { exact: true })).toBeVisible();
  await expect(page.getByText('Reserved', { exact: true })).toBeVisible();
  await expect(page.getByText('Charged', { exact: true })).toBeVisible();

  // Request a top-up → toast only, balance unchanged.
  await page.getByRole('button', { name: 'Request a top-up' }).click();
  await expect(page.getByText(/Top-up requested/)).toBeVisible();
  await expect(page.getByTestId('balance')).toHaveText('2');

  // No realtime for top-ups → manual refresh reflects the operator's grant.
  bal = 9;
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(page.getByTestId('balance')).toHaveText('9');
});

test('empty ledger shows the first-run state', async ({ page }) => {
  await seed(page);
  await page.route('**/api/me/credits', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: 0, history: [] }) }));
  await page.goto('/#/credits');
  await expect(page.getByTestId('balance')).toHaveText('0');
  await expect(page.getByText('No credit activity yet')).toBeVisible();
});
