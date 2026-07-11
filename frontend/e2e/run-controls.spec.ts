import { test, expect, Route, Page } from '@playwright/test';

// FE-12: operator run controls — enablement state machine, confirm-gated actions,
// settlement preview, cancel→refund (live + toast), and confirm-abort makes no call.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });
// The report picker's search page — i1 is the most recent report → the board default.
const searchBody = JSON.stringify({ rows: [{ id: 'i1', ref: 'RPT-260711-01', rawRequest: 'a road bike, 56cm', state: 'OUTREACH', customerEmail: 'c@x.io', createdAt: new Date().toISOString() }], nextCursor: null });
const boardBody = JSON.stringify({
  id: 'i1', rawRequest: 'a road bike, 56cm', state: 'OUTREACH', customerEmail: 'c@x.io',
  subject: { title: 'Road bike' }, questionnaire: { confirmed: true },
  epics: [{ id: 'e1', strategy: 'escalating', status: 'open', targetQualifiedOptions: 3, releasedWaves: [1], inquiries: [
    { id: 's1', epicId: 'e1', name: 'Velohaus', wave: 1, status: 'contacted' },
    { id: 's2', epicId: 'e1', name: 'Fietsfabriek', wave: 1, status: 'researching' },
    { id: 's3', epicId: 'e1', name: 'Old Co', wave: 1, status: 'qualified' },
  ] }],
});
const costBody = JSON.stringify({ currency: 'USD', perModel: [], outreach: { emails: 0, replies: 0, discovery: 0, research: 0, embeddings: 0, estUsd: 0.5 }, tokenTotal: 0, grandTotalUsd: 0.5 });

async function setup(page: Page) {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN);
  await page.route('**/api/admin/reports*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: searchBody }));
  await page.route('**/api/reports/*/cost', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: costBody }));
  await page.route('**/api/reports/*/pause', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'i1', state: 'ON_HOLD' }) }));
  await page.route('**/api/reports/*/resume', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'i1', state: 'OUTREACH' }) }));
  await page.route('**/api/reports/*/cancel', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'i1', state: 'CANCELLED' }) }));
  // The board detail (single segment) — register last so the specific routes above win.
  await page.route('**/api/reports/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: boardBody }));
}
function dispatch(page: Page, event: Record<string, unknown>) {
  return page.evaluate((e) => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({ type: 'realtime/event', event: e }), event);
}

test('cancel (confirm) → CANCELLED + a refund toast', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await expect(page.getByTestId('run-controls')).toBeVisible();
  await expect(page.getByTestId('run-state')).toContainText('running');

  await page.getByTestId('run-cancel').click();
  await expect(page.getByTestId('settlement-preview')).toBeVisible();
  await page.getByTestId('run-confirm-yes').click();
  await expect(page.getByTestId('run-state')).toContainText('cancelled');

  // The cancel fires the refund as a live credits.refunded event.
  await dispatch(page, { id: '90', type: 'credits.refunded', reportId: 'i1', at: 'now', data: { amount: 1 } });
  await expect(page.getByText('Refunded 1 credit on cancel.')).toBeVisible();
});

test('pause disables Pause / enables Resume; resume continues', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await expect(page.getByTestId('run-controls')).toBeVisible();
  await expect(page.getByTestId('run-pause')).toBeEnabled();
  await expect(page.getByTestId('run-resume')).toBeDisabled();

  await page.getByTestId('run-pause').click();
  await page.getByTestId('run-confirm-yes').click();
  await expect(page.getByTestId('run-state')).toContainText('paused');
  await expect(page.getByTestId('run-pause')).toBeDisabled();
  await expect(page.getByTestId('run-resume')).toBeEnabled();

  await page.getByTestId('run-resume').click();
  await page.getByTestId('run-confirm-yes').click();
  await expect(page.getByTestId('run-state')).toContainText('running');
  await expect(page.getByTestId('run-resume')).toBeDisabled();
  await expect(page.getByTestId('run-pause')).toBeEnabled();
});

test('a confirm-cancel that is aborted makes no network call', async ({ page }) => {
  let cancelCalls = 0;
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN);
  await page.route('**/api/admin/reports*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: searchBody }));
  await page.route('**/api/reports/*/cost', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: costBody }));
  await page.route('**/api/reports/*/cancel', (r: Route) => { cancelCalls += 1; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'i1', state: 'CANCELLED' }) }); });
  await page.route('**/api/reports/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: boardBody }));

  await page.goto('/#/admin');
  await expect(page.getByTestId('run-controls')).toBeVisible();
  await page.getByTestId('run-cancel').click();
  await expect(page.getByTestId('settlement-preview')).toBeVisible();
  await page.getByTestId('run-confirm-no').click(); // abort

  await expect(page.getByTestId('settlement-preview')).toHaveCount(0);
  await expect(page.getByTestId('run-state')).toContainText('running');
  expect(cancelCalls).toBe(0);
});

test('the settlement preview renders from /cost (cost-so-far + refund + in-flight jobs)', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await page.getByTestId('run-cancel').click();
  await expect(page.getByTestId('preview-cost')).toContainText('0.5000');
  await expect(page.getByTestId('preview-credit')).toContainText('+1');
  await expect(page.getByTestId('preview-inflight')).toContainText('2'); // contacted + researching
});
