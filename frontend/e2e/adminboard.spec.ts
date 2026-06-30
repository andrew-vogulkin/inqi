import { test, expect, Route, Page } from '@playwright/test';

// FE-10: admin live board — epics→subtasks, attention badge, live stream, epic detail routing, reconnect.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });
const listBody = JSON.stringify([{ id: 'i1', rawRequest: 'a road bike, 56cm, Amsterdam', state: 'OUTREACH', customerEmail: 'c@x.io', createdAt: new Date().toISOString() }]);
const boardBody = JSON.stringify({
  id: 'i1', rawRequest: 'a road bike, 56cm, Amsterdam', state: 'OUTREACH', customerEmail: 'c@x.io',
  subject: { title: 'Road bike, 56cm' }, questionnaire: { confirmed: true },
  epics: [{ id: 'e1', strategy: 'escalating', status: 'open', targetQualifiedOptions: 3, releasedWaves: [1], subtasks: [
    { id: 's1', epicId: 'e1', subjectProviderName: 'Velohaus', wave: 1, status: 'contacted' },
    { id: 's2', epicId: 'e1', subjectProviderName: 'Fietsfabriek', wave: 1, status: 'qualified' },
  ] }],
});

async function setup(page: Page) {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN);
  await page.route('**/api/inquiries', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: listBody }));
  // The board embeds the FE-12 run-controls panel, which fetches /cost on mount — mock it
  // so the suite is hermetic (an unmocked authed call would 401 against a live backend).
  await page.route('**/api/inquiries/*/cost', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'USD', perModel: [], outreach: { emails: 0, replies: 0, discovery: 0, research: 0, embeddings: 0, estUsd: 0 }, tokenTotal: 0, grandTotalUsd: 0 }) }));
  await page.route('**/api/inquiries/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: boardBody }));
}
function dispatch(page: Page, event: Record<string, unknown>) {
  return page.evaluate((e) => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({ type: 'realtime/event', event: e }), event);
}

test('board renders; a failed subtask raises the attention badge; live events update the stream', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await expect(page.getByText('escalating epic')).toBeVisible();
  await expect(page.getByText('1/3 qualified')).toBeVisible();
  await expect(page.getByText(/need attention/)).toHaveCount(0);

  await dispatch(page, { id: '50', type: 'subtask.updated', inquiryId: 'i1', epicId: 'e1', subtaskId: 's1', at: 'now', data: { status: 'failed' } });
  await expect(page.getByText('1 need attention')).toBeVisible();

  await dispatch(page, { id: '51', type: 'wave.released', inquiryId: 'i1', epicId: 'e1', at: 'now', data: { wave: 2, count: 3 } });
  await expect(page.getByTestId('activity-stream')).toContainText('wave 2 released');
});

test('epic detail shows lineage and a subtask routes to FE-11', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await page.getByTestId('epic-card').first().click();
  await expect(page.getByText('User request')).toBeVisible();
  await expect(page.getByText('Scope confirmed by the customer')).toBeVisible();
  await page.getByTestId('subtask-row').first().click();
  await expect(page).toHaveURL(/#\/admin\/s\/s1/);
});

test('simulate reconnect raises the "no events missed" toast', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await expect(page.getByText('escalating epic')).toBeVisible();
  await page.evaluate(() => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({ type: 'realtime/reconnected' }));
  await expect(page.getByText('Reconnected — no events missed.')).toBeVisible();
});
