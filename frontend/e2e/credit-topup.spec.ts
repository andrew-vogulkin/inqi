import { test, expect, Route, Page } from '@playwright/test';

// FE-16: operator credit top-up — partial customer search wired to the admin
// directory, grant flow (amount + note → new balance), validation + error paths.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });

const DIRECTORY = [
  { id: 'cust-nina-0001', name: 'Nina Costa', email: 'nina.costa@example.com' },
  { id: 'cust-omar-0002', name: 'Omar Haddad', email: 'omar.haddad@example.com' },
];

async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN); }

/** Mock the directory search: filters DIRECTORY by the partial `q`, case-insensitively (mirrors the backend). */
function mockSearch(page: Page, calls: string[] = []) {
  return page.route('**/api/admin/customers?*', (r: Route) => {
    const q = new URL(r.request().url()).searchParams.get('q') ?? '';
    calls.push(q);
    const hits = DIRECTORY.filter((c) => c.email.toLowerCase().includes(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase()));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hits) });
  });
}

test('search field is live: partial keyword hits the directory endpoint and renders matches', async ({ page }) => {
  await seed(page);
  const calls: string[] = [];
  await mockSearch(page, calls);
  await page.goto('/#/admin/topup');

  await expect(page.getByTestId('credit-topup')).toBeVisible();
  const input = page.getByPlaceholder(/Search by email or name/);
  await expect(input).toBeEnabled(); // was a disabled placeholder shell before FE-16 landed

  await input.fill('NINA'); // partial + wrong case — the backend matches insensitively
  await expect(page.getByTestId('search-results')).toBeVisible();
  await expect(page.getByTestId('search-result')).toHaveCount(1);
  await expect(page.getByTestId('search-result')).toContainText('nina.costa@example.com');
  expect(calls.pop()).toBe('NINA'); // the typed keyword really reached ?q=

  await input.fill('example.com'); // broader partial → both match
  await expect(page.getByTestId('search-result')).toHaveCount(2);
});

test('no matches shows the empty note', async ({ page }) => {
  await seed(page);
  await mockSearch(page);
  await page.goto('/#/admin/topup');
  await page.getByPlaceholder(/Search by email or name/).fill('zzz-nobody');
  await expect(page.getByTestId('no-results')).toContainText('zzz-nobody');
});

test('grant flow: select a customer, top up, success shows the new balance', async ({ page }) => {
  await seed(page);
  await mockSearch(page);
  let posted: { url: string; body: Record<string, unknown> } | null = null;
  await page.route('**/api/admin/customers/*/credits', (r: Route) => {
    posted = { url: r.request().url(), body: r.request().postDataJSON() as Record<string, unknown> };
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ customerId: 'cust-nina-0001', balance: 8 }) });
  });
  await page.goto('/#/admin/topup');

  await page.getByPlaceholder(/Search by email or name/).fill('nina');
  await page.getByTestId('search-result').click();
  await expect(page.getByTestId('grant-panel')).toBeVisible();
  await expect(page.getByTestId('selected-email')).toContainText('nina.costa@example.com');

  await page.getByPlaceholder(/onboarding grant/).fill('welcome grant');
  await page.getByTestId('grant-button').click();

  await expect(page.getByTestId('topup-success')).toContainText('nina.costa@example.com');
  await expect(page.getByTestId('new-balance')).toHaveText('8');
  expect(posted!.url).toContain('/api/admin/customers/cust-nina-0001/credits');
  expect(posted!.body).toMatchObject({ amount: 5, note: 'welcome grant' }); // default amount 5 + the note
});

test('validation: a non-positive amount disables Grant and shows the hint', async ({ page }) => {
  await seed(page);
  await mockSearch(page);
  await page.goto('/#/admin/topup');
  await page.getByPlaceholder(/Search by email or name/).fill('omar');
  await page.getByTestId('search-result').click();

  const amount = page.getByTestId('grant-panel').locator('input[type=number]');
  await amount.fill('0');
  await expect(page.getByTestId('amount-invalid')).toBeVisible();
  await expect(page.getByTestId('grant-button')).toBeDisabled();

  await amount.fill('3');
  await expect(page.getByTestId('grant-button')).toBeEnabled();
});

test('a failed top-up surfaces the API error message', async ({ page }) => {
  await seed(page);
  await mockSearch(page);
  await page.route('**/api/admin/customers/*/credits', (r: Route) =>
    r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'top-up amount must be a positive integer', retryable: false } }) }));
  await page.goto('/#/admin/topup');

  await page.getByPlaceholder(/Search by email or name/).fill('nina');
  await page.getByTestId('search-result').click();
  await page.getByTestId('grant-button').click();

  await expect(page.getByTestId('topup-error')).toBeVisible();
  await expect(page.getByTestId('grant-panel')).toBeVisible(); // selection kept so the operator can retry
});
