import { test, expect, Route, Page } from '@playwright/test';

// FE-06: live report — snapshot/stream, layouts, BEST MATCH, reused banner, reconnect toast.

const SESSION = JSON.stringify({ token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });

const OPTIONS = [
  { subjectProvider: 'Aurora Studio', price: 200, currency: 'EUR', qualityScore: 0.9, availability: 'in stock', leadTime: '1-2w' },
  { subjectProvider: 'Budget Co', price: 100, currency: 'EUR', qualityScore: 0.4 },
  { subjectProvider: 'Mid Co', price: 300, currency: 'EUR', qualityScore: 0.7 },
];

function liveBody(over: Record<string, unknown> = {}) {
  return JSON.stringify({ inquiryId: 'i1', state: 'OUTREACH', delivered: false, rawRequest: 'a used road bike, Amsterdam', reportToken: null, reusedFrom: null, summary: 'in progress', options: OPTIONS, ...over });
}

async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), SESSION); }

test('streaming: ranks options with BEST MATCH and switches layouts', async ({ page }) => {
  await seed(page);
  await page.route('**/api/inquiries/*/report-live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: liveBody() }));
  await page.goto('/#/i/i1');

  await expect(page.getByText('Your report')).toBeVisible();
  await expect(page.getByText('Research in progress')).toBeVisible();
  await expect(page.getByText('Aurora Studio').first()).toBeVisible();
  await expect(page.getByText('BEST MATCH')).toBeVisible(); // on the top-ranked option

  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('columnheader', { name: 'Provider' })).toBeVisible();
  await page.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByText('Aurora Studio').first()).toBeVisible();
});

test('final: delivered shows the summary + reused-report banner + Ready pill', async ({ page }) => {
  await seed(page);
  await page.route('**/api/inquiries/*/report-live', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: liveBody({ delivered: true, state: 'REPORT_DELIVERED', reusedFrom: 'rep_old', summary: 'Found 3 qualified options.' }) }));
  await page.goto('/#/i/i1');

  await expect(page.getByText('Reused from a similar recent report')).toBeVisible();
  await expect(page.getByText('Found 3 qualified options.')).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
});

test('live: a streamed event appears in the activity timeline', async ({ page }) => {
  await seed(page);
  await page.route('**/api/inquiries/*/report-live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: liveBody() }));
  await page.goto('/#/i/i1');
  await expect(page.getByText('Your report')).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({
      type: 'realtime/event',
      event: { id: '500', type: 'agent.progress', inquiryId: 'i1', at: 'now', data: { stage: 'outreach', message: 'emailing providers' } },
    });
  });
  await expect(page.getByText(/outreach: emailing providers/)).toBeVisible();
});

test('simulate reconnect raises the "no events missed" toast', async ({ page }) => {
  await seed(page);
  await page.route('**/api/inquiries/*/report-live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: liveBody() }));
  await page.goto('/#/i/i1');
  await page.getByRole('button', { name: '↻ reconnect' }).click();
  await expect(page.getByText('Reconnected — no events missed.')).toBeVisible();
});
