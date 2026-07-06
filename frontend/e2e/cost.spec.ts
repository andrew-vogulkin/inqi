import { test, expect, Route, Page } from '@playwright/test';

// FE-13: per-report cost rollup — tiles + line items reconcile to the grand total;
// the admin-only 403 path renders the Forbidden screen with NO cost figures.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });
const CUSTOMER = JSON.stringify({ token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });
const costBody = JSON.stringify({
  currency: 'USD',
  perModel: [
    { model: 'qwen', promptTokens: 1000, completionTokens: 500, estUsd: 0.15 },
    { model: 'embed', promptTokens: 2000, completionTokens: 0, estUsd: 0.05 },
  ],
  outreach: { emails: 3, replies: 1, discovery: 2, research: 4, embeddings: 10, estUsd: 0.30 },
  tokenTotal: 3500,
  grandTotalUsd: 0.50,
});

async function seed(page: Page, session: string) {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), session);
}

test('admin sees tiles + a table that reconciles to the grand total', async ({ page }) => {
  await seed(page, ADMIN);
  await page.route('**/api/reports/*/cost', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: costBody }));
  await page.goto('/#/admin/r/i1/cost');

  await expect(page.getByTestId('cost-report')).toBeVisible();
  await expect(page.getByTestId('cost-total')).toContainText('$0.5000');
  await expect(page.getByTestId('cost-tokens')).toContainText('3,500');
  await expect(page.getByTestId('cost-outreach')).toContainText('20');
  await expect(page.getByTestId('cost-grandtotal')).toContainText('$0.5000');
  await expect(page.getByTestId('cost-reconciled')).toBeVisible();
  await expect(page.getByTestId('cost-table')).toContainText('qwen');
});

test('a 403 from /cost renders the Forbidden screen with ZERO cost figures', async ({ page }) => {
  // Admin session passes the route guard so the screen renders; the API itself
  // returns 403 → the component must show Forbidden and leak no figure.
  await seed(page, ADMIN);
  await page.route('**/api/reports/*/cost', (r: Route) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_FORBIDDEN', message: 'admin only' } }) }));
  await page.goto('/#/admin/r/i1/cost');

  await expect(page.getByText('For operators')).toBeVisible();
  await expect(page.getByTestId('cost-report')).toHaveCount(0);
  await expect(page.getByTestId('cost-total')).toHaveCount(0);
  await expect(page.getByTestId('cost-grandtotal')).toHaveCount(0);
});

test('a non-admin is blocked by the route guard (no cost call, no figures)', async ({ page }) => {
  let costCalls = 0;
  await seed(page, CUSTOMER);
  await page.route('**/api/reports/*/cost', (r: Route) => { costCalls += 1; return r.fulfill({ status: 200, contentType: 'application/json', body: costBody }); });
  await page.goto('/#/admin/r/i1/cost');

  await expect(page.getByText('For operators')).toBeVisible();
  await expect(page.getByTestId('cost-total')).toHaveCount(0);
  expect(costCalls).toBe(0);
});
