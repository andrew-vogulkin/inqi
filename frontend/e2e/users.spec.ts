import { test, expect, Route, Page } from '@playwright/test';

// FE-18 / HP-25: the admin user directory — alphabetical table (email · registered ·
// role · status · reports), search + status filter, row-select → suspend/reactivate
// (self + admin protected), and the "view this user's reports" link.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });

const ROWS = [
  { id: 'a1', email: 'ops@x.io', name: 'Operator Ada', role: 'admin', registeredAt: '2026-06-01T00:00:00.000Z', status: 'active', suspendedAt: null, credits: 0, reportCount: 0 },
  { id: 'c-nina', email: 'nina.costa@example.com', name: 'Nina Costa', role: 'customer', registeredAt: '2026-07-01T00:00:00.000Z', status: 'active', suspendedAt: null, credits: 3, reportCount: 4 },
  { id: 'c-raj', email: 'raj.patel@example.com', name: 'Raj Patel', role: 'customer', registeredAt: '2026-07-05T00:00:00.000Z', status: 'suspended', suspendedAt: '2026-07-05T10:00:00.000Z', credits: 0, reportCount: 1 },
];

async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN); }

/** Mock the directory list; capture the query params seen so we can assert on filters.
 *  Regex (not glob) so it matches the bare `/api/admin/users` first page AND `?…` pages,
 *  but never the `/users/:id/suspend` sub-paths. */
function mockList(page: Page, calls: { q: string | null; status: string | null }[] = []) {
  return page.route(/\/api\/admin\/users(\?|$)/, (r: Route) => {
    const u = new URL(r.request().url());
    const status = u.searchParams.get('status');
    const q = u.searchParams.get('q');
    calls.push({ q, status });
    let rows = ROWS;
    if (status) rows = rows.filter((x) => x.status === status);
    if (q) rows = rows.filter((x) => x.email.includes(q) || (x.name ?? '').toLowerCase().includes(q.toLowerCase()));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, nextCursor: null }) });
  });
}

test('renders the four columns for every account', async ({ page }) => {
  await seed(page);
  await mockList(page);
  await page.goto('/#/admin/users');

  await expect(page.getByTestId('admin-users')).toBeVisible();
  await expect(page.getByTestId('user-row')).toHaveCount(3);
  const raj = page.getByTestId('user-row').filter({ hasText: 'raj.patel@example.com' });
  await expect(raj.getByTestId('user-status-pill')).toHaveText('suspended');
  const nina = page.getByTestId('user-row').filter({ hasText: 'nina.costa@example.com' });
  await expect(nina.getByTestId('user-status-pill')).toHaveText('active');
});

test('status filter narrows to suspended via ?status=', async ({ page }) => {
  await seed(page);
  const calls: { q: string | null; status: string | null }[] = [];
  await mockList(page, calls);
  await page.goto('/#/admin/users');
  await page.getByTestId('status-filter-suspended').click();
  await expect(page.getByTestId('user-row')).toHaveCount(1);
  await expect(page.getByTestId('user-row')).toContainText('raj.patel@example.com');
  expect(calls.map((c) => c.status)).toContain('suspended');
});

test('suspend flow: select an active customer, confirm, row flips to suspended', async ({ page }) => {
  await seed(page);
  await mockList(page);
  let posted: string | null = null;
  await page.route('**/api/admin/users/*/suspend', (r: Route) => {
    posted = r.request().url();
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...ROWS[1], status: 'suspended', suspendedAt: '2026-07-13T00:00:00.000Z' }) });
  });
  await page.goto('/#/admin/users');

  await page.getByTestId('user-row').filter({ hasText: 'nina.costa@example.com' }).click();
  await expect(page.getByTestId('user-detail-panel')).toContainText('nina.costa@example.com');
  await page.getByTestId('suspend-button').click();
  await page.getByTestId('suspend-confirm').click();

  expect(posted!).toContain('/api/admin/users/c-nina/suspend');
  const nina = page.getByTestId('user-row').filter({ hasText: 'nina.costa@example.com' });
  await expect(nina.getByTestId('user-status-pill')).toHaveText('suspended');
});

test('reactivate flow: a suspended user can be restored', async ({ page }) => {
  await seed(page);
  await mockList(page);
  await page.route('**/api/admin/users/*/reactivate', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...ROWS[2], status: 'active', suspendedAt: null }) }));
  await page.goto('/#/admin/users');

  await page.getByTestId('user-row').filter({ hasText: 'raj.patel@example.com' }).click();
  await page.getByTestId('reactivate-button').click();
  const raj = page.getByTestId('user-row').filter({ hasText: 'raj.patel@example.com' });
  await expect(raj.getByTestId('user-status-pill')).toHaveText('active');
});

test('self and admin rows are protected (no suspend control)', async ({ page }) => {
  await seed(page);
  await mockList(page);
  await page.goto('/#/admin/users');

  // The signed-in admin (ops@x.io, id a1) selecting their own row.
  await page.getByTestId('user-row').filter({ hasText: 'ops@x.io' }).click();
  await expect(page.getByTestId('protected-note')).toBeVisible();
  await expect(page.getByTestId('suspend-button')).toHaveCount(0);
});

test('"view reports" link carries the email to the board picker', async ({ page }) => {
  await seed(page);
  await mockList(page);
  await page.goto('/#/admin/users');
  await page.getByTestId('user-row').filter({ hasText: 'nina.costa@example.com' }).click();
  await expect(page.getByTestId('view-reports-link')).toHaveAttribute('href', /#\/admin\?q=nina/);
});
