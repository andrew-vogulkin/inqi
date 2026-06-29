import { test, expect, Route, Page } from '@playwright/test';

// FE-14: audit trail — chip → types= query mapping, "All" clears it, rows render, empty state.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });
const denialRows = JSON.stringify({ total: 1, entries: [{ type: 'denial', actor: 'system', at: '2026-06-29T08:00:00Z', inquiryId: 'i9' }] });
const operatorRows = JSON.stringify({ total: 1, entries: [{ type: 'operator_action', actor: 'ops@x.io', at: '2026-06-29T10:00:00Z', refs: { targetId: 'i1', targetType: 'inquiry' }, data: { action: 'topup' } }] });

async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN); }

test('load → rows render', async ({ page }) => {
  await seed(page);
  await page.route('**/api/audit**', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: denialRows }));
  await page.goto('/#/admin/audit');
  await expect(page.getByTestId('audit-trail')).toBeVisible();
  await expect(page.getByTestId('audit-row')).toHaveCount(1);
  await expect(page.getByText('system')).toBeVisible();
});

test('selecting "Operator" sends types=operator_action and the list updates', async ({ page }) => {
  await seed(page);
  const urls: string[] = [];
  await page.route('**/api/audit**', (r: Route) => {
    const url = r.request().url();
    urls.push(url);
    return r.fulfill({ status: 200, contentType: 'application/json', body: url.includes('types=operator_action') ? operatorRows : denialRows });
  });
  await page.goto('/#/admin/audit');
  await expect(page.getByText('system')).toBeVisible();

  await page.getByRole('button', { name: 'Operator', exact: true }).click();
  await expect(page.getByTestId('audit-row')).toContainText('Top-up');
  await expect(page.getByTestId('audit-row')).toContainText('i1');
  expect(urls.some((u) => u.includes('types=operator_action'))).toBe(true);
});

test('"All" clears the filter (no types= param)', async ({ page }) => {
  await seed(page);
  const urls: string[] = [];
  await page.route('**/api/audit**', (r: Route) => {
    const url = r.request().url();
    urls.push(url);
    return r.fulfill({ status: 200, contentType: 'application/json', body: url.includes('types=operator_action') ? operatorRows : denialRows });
  });
  await page.goto('/#/admin/audit');
  await page.getByRole('button', { name: 'Operator', exact: true }).click();
  await expect(page.getByTestId('audit-row')).toContainText('Top-up');

  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByTestId('audit-row')).toContainText('Denial');
  const last = urls[urls.length - 1];
  expect(last.includes('types=')).toBe(false);
});

test('an empty filter shows the empty state', async ({ page }) => {
  await seed(page);
  await page.route('**/api/audit**', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, entries: [] }) }));
  await page.goto('/#/admin/audit');
  await expect(page.getByText('No matching activity')).toBeVisible();
  await expect(page.getByTestId('audit-row')).toHaveCount(0);
});
