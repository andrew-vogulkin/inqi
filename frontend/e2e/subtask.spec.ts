import { test, expect, Route, Page } from '@playwright/test';

// FE-11: subtask system view — score gating, outreach variant (incl. 550), history colour, live update.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });

function board(subtasks: Record<string, unknown>[]) {
  return { id: 'i1', rawRequest: 'a road bike', state: 'OUTREACH', customerEmail: 'c@x.io', subject: { title: 'Bike' }, questionnaire: { confirmed: true }, epics: [{ id: 'e1', strategy: 'escalating', status: 'open', targetQualifiedOptions: 3, releasedWaves: [1], subtasks }] };
}
async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN); }
function loadBoard(page: Page, b: ReturnType<typeof board>) {
  return page.evaluate((board) => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({ type: 'adminBoard/loaded', board }), b);
}

test('qualified subtask shows the score + dossier link; chain renders; dossier routes (admin origin)', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'm1', subtaskId: 's1', direction: 'outbound', status: 'sent', body: 'Price + availability?', createdAt: '2026-06-28T12:00:00Z' },
    { id: 'm2', subtaskId: 's1', direction: 'inbound', status: 'received', body: 'In stock, 540 EUR.', createdAt: '2026-06-28T13:00:00Z' },
  ]) }));
  await page.goto('/#/admin/s/s1');
  await loadBoard(page, board([{ id: 's1', epicId: 'e1', subjectProviderName: 'Aurora', wave: 1, status: 'qualified', qualityScore: 0.9 }]));

  await expect(page.getByTestId('subtask-view')).toBeVisible();
  await expect(page.getByTestId('score')).toBeVisible();
  await expect(page.getByTestId('chain')).toContainText('In stock, 540 EUR.');
  await page.getByTestId('dossier-link').click();
  await expect(page).toHaveURL(/#\/admin\/d\/i1\/Aurora/);
});

test('queued subtask shows "not scored yet" and a status note (no chain)', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/#/admin/s/s2');
  await loadBoard(page, board([{ id: 's2', epicId: 'e1', subjectProviderName: 'Budget Co', wave: 1, status: 'pending' }]));

  await expect(page.getByTestId('not-scored')).toBeVisible();
  await expect(page.getByTestId('outreach-note')).toBeVisible();
});

test('a 550 bounce in the chain shows the Bounced note', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'm1', subtaskId: 's3', direction: 'outbound', status: 'bounced', body: 'undeliverable', createdAt: '2026-06-28T12:00:00Z' },
  ]) }));
  await page.goto('/#/admin/s/s3');
  await loadBoard(page, board([{ id: 's3', epicId: 'e1', subjectProviderName: 'Gone Co', wave: 1, status: 'failed' }]));

  await expect(page.getByTestId('outreach-note')).toContainText('550');
});

test('a live subtask.updated updates status + history (and reveals the score)', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/#/admin/s/s1');
  await loadBoard(page, board([{ id: 's1', epicId: 'e1', subjectProviderName: 'Aurora', wave: 1, status: 'contacted' }]));
  await expect(page.getByTestId('not-scored')).toBeVisible();

  await page.evaluate(() => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({
    type: 'realtime/event',
    event: { id: '90', type: 'subtask.updated', inquiryId: 'i1', epicId: 'e1', subtaskId: 's1', at: 'now', data: { status: 'qualified', qualityScore: 0.85 } },
  }));
  await expect(page.getByTestId('score')).toBeVisible();
  await expect(page.getByTestId('history').getByText('qualified')).toBeVisible();
});
