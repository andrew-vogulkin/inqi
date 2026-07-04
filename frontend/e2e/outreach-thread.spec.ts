import { test, expect, Route, Page } from '@playwright/test';

// FE-17: operator outreach thread — render, live inbound append (in order), queued/empty, Back routes.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });

function board(inquiries: Record<string, unknown>[]) {
  // persona lives on the report (one voice per report) — the board denormalizes it onto each inquiry VM
  return { id: 'i1', rawRequest: 'a road bike', state: 'OUTREACH', personaId: 'persona_amsterdam', customerEmail: 'c@x.io', subject: { title: 'Bike' }, questionnaire: { confirmed: true }, epics: [{ id: 'e1', strategy: 'escalating', status: 'open', targetQualifiedOptions: 3, releasedWaves: [1], inquiries }] };
}
const outbound = { id: 'm1', inquiryId: 's1', direction: 'outbound', status: 'sent', fromAddr: 'persona_ams@reply.inqi.io', toAddr: 'sales@acme.io', body: 'Price + availability?', createdAt: '2026-06-28T12:00:00Z' };
const inbound = { id: 'm2', inquiryId: 's1', direction: 'inbound', status: 'received', fromAddr: 'sales@acme.io', toAddr: 'persona_ams@reply.inqi.io', body: 'In stock, 540 EUR.', createdAt: '2026-06-28T13:00:00Z' };

async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN); }
function loadBoard(page: Page, b: ReturnType<typeof board>) {
  return page.evaluate((bd) => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({ type: 'adminBoard/loaded', board: bd }), b);
}
function dispatch(page: Page, event: Record<string, unknown>) {
  return page.evaluate((e) => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({ type: 'realtime/event', event: e }), event);
}

test('thread renders: header (persona/hub/route/status) + direction-aligned bubbles', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([outbound, inbound]) }));
  await page.goto('/#/admin/t/s1');
  await loadBoard(page, board([{ id: 's1', epicId: 'e1', name: 'Acme Bikes', wave: 1, status: 'replied', personaId: 'persona_amsterdam' }]));

  await expect(page.getByTestId('outreach-thread')).toBeVisible();
  await expect(page.getByTestId('thread-header')).toContainText('Acme Bikes');
  await expect(page.getByTestId('thread-header')).toContainText('persona_amsterdam');
  await expect(page.getByTestId('thread-header')).toContainText('persona_ams@reply.inqi.io → sales@acme.io');
  await expect(page.getByTestId('bubble')).toHaveCount(2);
  await expect(page.getByTestId('bubble').first()).toContainText('Price + availability?');
});

test('a live message.received appends a new inbound bubble in order (no refresh)', async ({ page }) => {
  await seed(page);
  // Initially the thread is just the outbound message.
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([outbound]) }));
  await page.goto('/#/admin/t/s1');
  await loadBoard(page, board([{ id: 's1', epicId: 'e1', name: 'Acme Bikes', wave: 1, status: 'contacted', personaId: 'persona_amsterdam' }]));
  await expect(page.getByTestId('bubble')).toHaveCount(1);

  // A reply arrives — the authoritative thread now includes the inbound message; the thin
  // message.received event triggers a refetch (real backend events carry no id/body).
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([outbound, inbound]) }));
  await dispatch(page, { id: '90', type: 'message.received', reportId: 'i1', epicId: 'e1', inquiryId: 's1', at: 'now', data: { from: 'sales@acme.io' } });
  await expect(page.getByTestId('bubble')).toHaveCount(2);
  const last = page.getByTestId('bubble').nth(1);
  await expect(last).toContainText('In stock, 540 EUR.');
  await expect(last).toHaveAttribute('data-direction', 'inbound');
});

test('an un-contacted inquiry shows the queued/empty state', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/#/admin/t/s2');
  await loadBoard(page, board([{ id: 's2', epicId: 'e1', name: 'Queued Co', wave: 1, status: 'pending' }]));

  await expect(page.getByText('Not contacted yet')).toBeVisible();
  await expect(page.getByTestId('bubble')).toHaveCount(0);
});

test('Back routes to the board', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([outbound]) }));
  await page.goto('/#/admin/t/s1');
  await loadBoard(page, board([{ id: 's1', epicId: 'e1', name: 'Acme Bikes', wave: 1, status: 'contacted' }]));
  await page.getByTestId('thread-back').click();
  await expect(page).toHaveURL(/#\/admin\/r\/i1/);
});
