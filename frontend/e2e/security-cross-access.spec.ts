import { test, expect, request as apiRequest, APIRequestContext } from '@playwright/test';
import { API, signIn, createReport, listReports } from './_support/live-api';

/**
 * SECURITY — cross-account access (tenant isolation).
 *
 * Reports are ownership-scoped: a customer may read/act on only their own; a
 * non-owner must get 404 (NOT 403 — no existence leak), operator controls are
 * admin-only, and anonymous callers get 401. These run against the real dev
 * backend (guards + DB scoping), so they prove the boundary rather than a mock.
 *
 * Gated: run with `E2E_LIVE=1 npx playwright test security-cross-access`.
 */
const LIVE = process.env.E2E_LIVE === '1';
const describe = LIVE ? test.describe.serial : test.describe.skip;

const OWNER = 'mei.tan@example.com';       // seed customer, funded → can submit
const OTHER = 'nina.costa@example.com';    // seed customer, a different tenant

describe('cross-account access is denied', () => {
  let ctx: APIRequestContext;
  let ownerToken: string, otherToken: string;
  let reportId: string;

  test.beforeAll(async () => {
    ctx = await apiRequest.newContext();
    ownerToken = (await signIn(ctx, OWNER)).token;
    otherToken = (await signIn(ctx, OTHER)).token;
    // A real report owned by OWNER to attempt to reach from another account.
    reportId = await createReport(ctx, ownerToken, 'A quiet mid-range hotel near Lisbon city centre for a weekend.');
  });

  test.afterAll(async () => { await ctx.dispose(); });

  test('the owner can read their own report', async ({ request }) => {
    const res = await request.get(`${API}/reports/${reportId}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    expect(res.status()).toBe(200);
  });

  test("a different customer gets 404 (no existence leak) on someone else's report", async ({ request }) => {
    const res = await request.get(`${API}/reports/${reportId}`, { headers: { Authorization: `Bearer ${otherToken}` } });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('REPORT_NOT_FOUND'); // same shape as a truly-missing id
  });

  test("the other customer's report list never contains the owner's report", async ({ request }) => {
    const rows = await listReports(request, otherToken);
    expect(rows.map((r) => r.id)).not.toContain(reportId); // list is scoped to the caller
  });

  test('an unauthenticated caller gets 401 (no token, no data)', async ({ request }) => {
    const res = await request.get(`${API}/reports/${reportId}`);
    expect(res.status()).toBe(401);
  });

  test('a non-admin customer cannot invoke operator controls (403 on cancel)', async ({ request }) => {
    const res = await request.post(`${API}/reports/${reportId}/cancel`, {
      headers: { Authorization: `Bearer ${otherToken}` }, data: {},
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('AUTH_FORBIDDEN'); // admin-gated, not merely ownership
  });

  test('the owner also cannot self-cancel via the admin-only route (privilege, not just ownership)', async ({ request }) => {
    const res = await request.post(`${API}/reports/${reportId}/cancel`, {
      headers: { Authorization: `Bearer ${ownerToken}` }, data: {},
    });
    expect(res.status()).toBe(403); // owning a report ≠ operating it; cancel stays admin-only
  });
});
