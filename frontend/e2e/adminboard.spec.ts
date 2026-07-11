import { test, expect, Route, Page } from '@playwright/test';

// FE-10: admin live board — epics→inquiries, attention badge, live stream, epic detail routing, reconnect.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });
// The operator report picker (GET /admin/reports): i1 is the most recent → the default.
const searchRows = [
  { id: 'i1', ref: 'RPT-260711-01', rawRequest: 'a road bike, 56cm, Amsterdam', state: 'OUTREACH', customerEmail: 'c@x.io', createdAt: new Date().toISOString() },
  { id: 'i2', ref: 'RPT-260710-07', rawRequest: 'a padel coach in Bangkok', state: 'REPORT_DELIVERED', customerEmail: 'other@x.io', createdAt: new Date().toISOString() },
];
const boardBody = JSON.stringify({
  id: 'i1', rawRequest: 'a road bike, 56cm, Amsterdam', state: 'OUTREACH', customerEmail: 'c@x.io',
  subject: { title: 'Road bike, 56cm' },
  questionnaire: { confirmed: true,
    questions: [
      { id: 'terrain', type: 'select', prompt: 'What terrain will you ride?', options: ['Road', 'Gravel'] },
      { id: 'budget', type: 'select', prompt: 'Budget range?' },
    ],
    answers: { terrain: 'Gravel' } }, // budget deliberately left for us to decide
  epics: [{ id: 'e1', strategy: 'escalating', status: 'open', targetQualifiedOptions: 3, releasedWaves: [1], inquiries: [
    { id: 's1', epicId: 'e1', name: 'Velohaus', wave: 1, status: 'contacted', researchPending: true },
    { id: 's2', epicId: 'e1', name: 'Fietsfabriek', wave: 1, status: 'qualified', researchPending: false },
  ] }],
});

async function setup(page: Page) {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN);
  // Picker search: filters the fixture rows by q (ref / email / request text), like the API.
  await page.route('**/api/admin/reports*', (r: Route) => {
    const q = new URL(r.request().url()).searchParams.get('q')?.toLowerCase() ?? '';
    const rows = searchRows.filter((row) => !q || row.ref.toLowerCase().includes(q) || row.customerEmail.toLowerCase().includes(q) || row.rawRequest.toLowerCase().includes(q));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, nextCursor: null }) });
  });
  // The board embeds the FE-12 run-controls panel, which fetches /cost on mount — mock it
  // so the suite is hermetic (an unmocked authed call would 401 against a live backend).
  await page.route('**/api/reports/*/cost', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'USD', perModel: [], outreach: { emails: 0, replies: 0, discovery: 0, research: 0, embeddings: 0, estUsd: 0 }, tokenTotal: 0, grandTotalUsd: 0 }) }));
  await page.route('**/api/reports/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: boardBody }));
}
function dispatch(page: Page, event: Record<string, unknown>) {
  return page.evaluate((e) => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({ type: 'realtime/event', event: e }), event);
}

test('board renders; a failed inquiry raises the attention badge; live events update the stream', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await expect(page.getByText('escalating epic')).toBeVisible();
  await expect(page.getByText('1/3 qualified')).toBeVisible();
  await expect(page.getByText(/need attention/)).toHaveCount(0);

  await dispatch(page, { id: '50', type: 'inquiry.updated', reportId: 'i1', epicId: 'e1', inquiryId: 's1', at: 'now', data: { status: 'failed' } });
  await expect(page.getByText('1 need attention')).toBeVisible();

  await dispatch(page, { id: '51', type: 'wave.released', reportId: 'i1', epicId: 'e1', at: 'now', data: { wave: 2, count: 3 } });
  await expect(page.getByTestId('activity-stream')).toContainText('wave 2 released');
});

test('epic detail shows lineage and an inquiry routes to FE-11', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await page.getByTestId('epic-card').first().click();
  await expect(page.getByText('User request')).toBeVisible();
  await expect(page.getByText('Scope confirmed by the customer')).toBeVisible();
  // the confirmed-scope Q&A is exposed for the operator (prompt + the customer's answer)
  await expect(page.getByText('What terrain will you ride?')).toBeVisible();
  await expect(page.getByText('Gravel', { exact: true })).toBeVisible();
  await expect(page.getByText('Budget range?')).toBeVisible(); // unanswered question still listed
  await page.getByTestId('inquiry-row').first().click();
  await expect(page).toHaveURL(/#\/admin\/i\/s1/);
});

test('an inquiry with queued depth research shows the researching chip until the verdict lands', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await page.getByTestId('epic-card').first().click();
  await expect(page.getByTestId('research-pending-chip')).toHaveCount(1); // s1 pending, s2 done

  // the depth verdict lands → inquiry.updated clears the flag live
  await dispatch(page, { id: '60', type: 'inquiry.updated', reportId: 'i1', epicId: 'e1', inquiryId: 's1', at: 'now', data: { qualityScore: 0.7, researchPending: false } });
  await expect(page.getByTestId('research-pending-chip')).toHaveCount(0);
});

test('the report picker searches by ref and switches the board to the picked report', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  // The trigger shows the default (most recent) report's ref.
  await expect(page.getByTestId('report-picker-trigger')).toContainText('RPT-260711-01');

  await page.getByTestId('report-picker-trigger').click();
  await expect(page.getByTestId('report-picker-row')).toHaveCount(2); // default: the latest reports
  await page.getByTestId('report-search-input').fill('RPT-260710');
  await expect(page.getByTestId('report-picker-row')).toHaveCount(1); // narrowed by ref
  await expect(page.getByTestId('report-picker-row')).toContainText('a padel coach in Bangkok');

  await page.getByTestId('report-picker-row').click();
  await expect(page).toHaveURL(/#\/admin\/r\/i2/); // picking routes to that report's board
  await expect(page.getByTestId('report-picker-trigger')).toContainText('RPT-260710-07');
});

test('the report picker finds a report by customer email', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await page.getByTestId('report-picker-trigger').click();
  await page.getByTestId('report-search-input').fill('other@x.io');
  await expect(page.getByTestId('report-picker-row')).toHaveCount(1);
  await expect(page.getByTestId('report-picker-row')).toContainText('RPT-260710-07');
  // A query nothing matches says so instead of showing stale rows.
  await page.getByTestId('report-search-input').fill('zzz-no-such');
  await expect(page.getByTestId('report-picker-empty')).toBeVisible();
});

test('simulate reconnect raises the "no events missed" toast', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await expect(page.getByText('escalating epic')).toBeVisible();
  await page.evaluate(() => (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({ type: 'realtime/reconnected' }));
  await expect(page.getByText('Reconnected — no events missed.')).toBeVisible();
});
