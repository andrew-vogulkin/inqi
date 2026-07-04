import { test, expect, Route, Page } from '@playwright/test';

// FE-11: inquiry system view — score gating, outreach variant (incl. 550), history colour, live update.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });

function board(inquiries: Record<string, unknown>[]) {
  return { id: 'i1', rawRequest: 'a road bike', state: 'OUTREACH', customerEmail: 'c@x.io', subject: { title: 'Bike' }, questionnaire: { confirmed: true }, epics: [{ id: 'e1', strategy: 'escalating', status: 'open', targetQualifiedOptions: 3, releasedWaves: [1], inquiries }] };
}
async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN); }
function loadBoard(page: Page, b: ReturnType<typeof board>) {
  return page.evaluate((board) => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({ type: 'adminBoard/loaded', board }), b);
}

test('qualified inquiry shows the score + dossier link; chain renders; dossier routes (admin origin)', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'm1', inquiryId: 's1', direction: 'outbound', status: 'sent', body: 'Price + availability?', createdAt: '2026-06-28T12:00:00Z' },
    { id: 'm2', inquiryId: 's1', direction: 'inbound', status: 'received', body: 'In stock, 540 EUR.', createdAt: '2026-06-28T13:00:00Z' },
  ]) }));
  await page.goto('/#/admin/i/s1');
  await loadBoard(page, board([{ id: 's1', epicId: 'e1', name: 'Aurora', wave: 1, status: 'qualified', qualityScore: 0.9 }]));

  await expect(page.getByTestId('inquiry-view')).toBeVisible();
  await expect(page.getByTestId('score')).toBeVisible();
  await expect(page.getByTestId('chain')).toContainText('In stock, 540 EUR.');
  await page.getByTestId('dossier-link').click();
  await expect(page).toHaveURL(/#\/admin\/d\/i1\/Aurora/);
});

test('queued inquiry shows "not scored yet" and a status note (no chain)', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/#/admin/i/s2');
  await loadBoard(page, board([{ id: 's2', epicId: 'e1', name: 'Budget Co', wave: 1, status: 'pending' }]));

  await expect(page.getByTestId('not-scored')).toBeVisible();
  await expect(page.getByTestId('outreach-note')).toBeVisible();
});

test('a 550 bounce in the chain shows the Bounced note', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'm1', inquiryId: 's3', direction: 'outbound', status: 'bounced', body: 'undeliverable', createdAt: '2026-06-28T12:00:00Z' },
  ]) }));
  await page.goto('/#/admin/i/s3');
  await loadBoard(page, board([{ id: 's3', epicId: 'e1', name: 'Gone Co', wave: 1, status: 'failed' }]));

  await expect(page.getByTestId('outreach-note')).toContainText('550');
});

test('the source matrix renders (web / rating / email) and grows live on source.added', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/#/admin/i/s1');
  await loadBoard(page, board([{
    id: 's1', epicId: 'e1', name: 'Graph Coffee Co', wave: 1, status: 'qualified', qualityScore: 0.9,
    sources: [
      { id: 'src1', inquiryId: 's1', type: 'websearch', url: 'https://www.graphcoffeeco.com/', title: 'GRAPH COFFEE CO', snippet: 'Thailand specialty coffee', createdAt: '2026-07-02T10:00:00Z' },
      { id: 'src2', inquiryId: 's1', type: 'rating_feedback', url: 'ratings:Graph Coffee Co', title: 'Ratings & feedback digest', snippet: '4.9★ across 200 reviews', createdAt: '2026-07-02T10:01:00Z' },
      { id: 'src3', inquiryId: 's1', type: 'email', url: null, title: null, snippet: null, createdAt: '2026-07-02T10:02:00Z' },
    ],
  }]));

  const sources = page.getByTestId('sources');
  await expect(sources).toBeVisible();
  await expect(page.getByTestId('source-web')).toContainText('GRAPH COFFEE CO');
  await expect(page.getByTestId('source-rating')).toContainText('4.9★ across 200 reviews');
  await expect(page.getByTestId('source-email')).toContainText('Email thread');
  // the web source links out to the real page
  await expect(page.getByTestId('source-web').getByRole('link')).toHaveAttribute('href', 'https://www.graphcoffeeco.com/');

  // a depth task streams another source in — the matrix grows without a refetch
  await page.evaluate(() => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({
    type: 'realtime/event',
    event: {
      id: '91', type: 'source.added', reportId: 'i1', epicId: 'e1', inquiryId: 's1', at: 'now',
      data: { inquiryId: 's1', type: 'websearch', count: 1, sources: [{ id: 'src4', inquiryId: 's1', type: 'websearch', url: 'https://instagram.com/graphcoffee.co', title: 'Instagram', snippet: 'graphcoffee.co', createdAt: '2026-07-02T10:03:00Z' }] },
    },
  }));
  await expect(page.getByTestId('source-web').filter({ hasText: 'Instagram' })).toBeVisible();
});

test('an inquiry with no sources yet shows the empty note', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/#/admin/i/s2');
  await loadBoard(page, board([{ id: 's2', epicId: 'e1', name: 'Budget Co', wave: 1, status: 'pending' }]));
  await expect(page.getByTestId('no-sources')).toContainText('No sources recorded yet');
});

test('a live inquiry.updated updates status + history (and reveals the score)', async ({ page }) => {
  await seed(page);
  await page.route('**/api/comms/thread/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/#/admin/i/s1');
  await loadBoard(page, board([{ id: 's1', epicId: 'e1', name: 'Aurora', wave: 1, status: 'contacted' }]));
  await expect(page.getByTestId('not-scored')).toBeVisible();

  await page.evaluate(() => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({
    type: 'realtime/event',
    event: { id: '90', type: 'inquiry.updated', reportId: 'i1', epicId: 'e1', inquiryId: 's1', at: 'now', data: { status: 'qualified', qualityScore: 0.85 } },
  }));
  await expect(page.getByTestId('score')).toBeVisible();
  await expect(page.getByTestId('history').getByText('qualified')).toBeVisible();
});
