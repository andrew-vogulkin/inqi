import { test, expect, Route, Page } from '@playwright/test';

// FE-06: live report — snapshot/stream, layouts, BEST MATCH, reused banner, reconnect toast.

const SESSION = JSON.stringify({ token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });

const OPTIONS = [
  { subjectProvider: 'Aurora Studio', price: 200, currency: 'EUR', qualityScore: 0.9, availability: 'in stock', leadTime: '1-2w' },
  { subjectProvider: 'Budget Co', price: 100, currency: 'EUR', qualityScore: 0.4 },
  { subjectProvider: 'Mid Co', price: 300, currency: 'EUR', qualityScore: 0.7 },
];

function liveBody(over: Record<string, unknown> = {}) {
  return JSON.stringify({ reportId: 'i1', state: 'OUTREACH', delivered: false, rawRequest: 'a used road bike, Amsterdam', snapshotToken: null, reusedFrom: null, summary: 'in progress', options: OPTIONS, ...over });
}

async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), SESSION); }

test('freemium-locked: stubs never render as empty cards — they collapse into the unlock banner', async ({ page }) => {
  await seed(page);
  // The server redacts a locked freemium report: 4 locked stubs (no name/price) + the #5 taster.
  const lockedOptions = [
    { id: 'locked-1', locked: true, rank: 1 },
    { id: 'locked-2', locked: true, rank: 2 },
    { id: 'locked-3', locked: true, rank: 3 },
    { id: 'locked-4', locked: true, rank: 4 },
    { subjectProvider: 'Taster Bar', price: 5000, currency: 'THB', qualityScore: 0.7, id: 'op5', locked: false, rank: 5 },
  ];
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: liveBody({ delivered: true, state: 'REPORT_DELIVERED', personaId: 'ari', freemium: true, unlocked: false, lockedCount: 4, options: lockedOptions, summary: 'Found 5 bars.' }),
  }));
  await page.goto('/#/r/i1');

  // only the named taster renders as a full card, UNDER the locked rows, with its TRUE rank (5)…
  await expect(page.getByTestId('option-row')).toHaveCount(1);
  await expect(page.getByTestId('option-row')).toContainText('Taster Bar');
  await expect(page.getByTestId('option-row')).toContainText('5'); // real rank badge, not #1
  await expect(page.getByText('BEST MATCH')).toHaveCount(0); // the taster is #5, not the best
  // …the 4 better ranks render as locked placeholder rows above it (no data leaked)
  await expect(page.getByTestId('locked-row')).toHaveCount(4);
  const rows = page.locator('[data-testid="locked-row"], [data-testid="option-row"]');
  await expect(rows.last()).toHaveAttribute('data-testid', 'option-row'); // taster is visually last
  // …plus the unlock banner that routes to the unlock flow
  await expect(page.getByTestId('unlock-banner')).toContainText('4 better-ranked options locked');
  await expect(page.getByTestId('unlock-link')).toHaveAttribute('href', '#/f/i1');
  await expect(page.getByText('1 option · 4 locked')).toBeVisible();
  // the persona who ran the research shows on the header (Report 1:1 persona)
  await expect(page.getByTestId('persona-chip')).toContainText('Researched by Ari · Singapore hub');
});

test('streaming: ranks options with BEST MATCH and switches layouts', async ({ page }) => {
  await seed(page);
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: liveBody() }));
  await page.goto('/#/r/i1');

  await expect(page.getByRole('heading', { name: 'a used road bike, Amsterdam' })).toBeVisible();
  await expect(page.getByTestId('report-status')).toContainText('Researching');
  await expect(page.getByText('Aurora Studio').first()).toBeVisible();
  await expect(page.getByText('BEST MATCH')).toBeVisible(); // on the top-ranked option

  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByText('Provider')).toBeVisible();
  await page.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByText('Aurora Studio').first()).toBeVisible();
});

test('the original prompt section expands to the verbatim request (+focus chip)', async ({ page }) => {
  await seed(page);
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: liveBody({ focus: 'quality' }) }));
  await page.goto('/#/r/i1');

  const section = page.getByTestId('prompt-section');
  await expect(section).toContainText('Original prompt');
  await expect(section).toContainText('focus: quality');
  await section.getByRole('button').click(); // expand → full verbatim prompt below the header
  await expect(section.getByText('a used road bike, Amsterdam').nth(1)).toBeVisible();
});

test('final: delivered shows the summary + reused-report banner + Ready pill', async ({ page }) => {
  await seed(page);
  await page.route('**/api/reports/*/live', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: liveBody({ delivered: true, state: 'REPORT_DELIVERED', reusedFrom: 'rep_old', summary: 'Found 3 qualified options.' }) }));
  await page.goto('/#/r/i1');

  await expect(page.getByText('Reused from a similar recent report')).toBeVisible();
  await expect(page.getByText('Found 3 qualified options.')).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
});

test('live: a streamed event appears in the activity timeline', async ({ page }) => {
  await seed(page);
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: liveBody() }));
  await page.goto('/#/r/i1');
  await expect(page.getByRole('heading', { name: 'a used road bike, Amsterdam' })).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({
      type: 'realtime/event',
      event: { id: '500', type: 'agent.progress', reportId: 'i1', at: 'now', data: { stage: 'outreach', message: 'emailing providers' } },
    });
  });
  await expect(page.getByText(/emailing providers/)).toBeVisible();
});

test('simulate reconnect raises the "no events missed" toast', async ({ page }) => {
  await seed(page);
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: liveBody() }));
  await page.goto('/#/r/i1');
  await page.getByTestId('reconnect').click();
  await expect(page.getByText('Reconnected — no events missed.')).toBeVisible();
});
