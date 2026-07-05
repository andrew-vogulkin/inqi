import { test, expect, Route, Page } from '@playwright/test';

// FE-08: research dossier — customer-redacted vs admin chain; outreach variants; Back routing.

const CUSTOMER = JSON.stringify({ token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });
const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });

function live(option: Record<string, unknown>) {
  return JSON.stringify({ reportId: 'i1', state: 'OUTREACH', delivered: false, rawRequest: 'a bike', snapshotToken: null, reusedFrom: null, summary: '', options: [option] });
}
const repliedOption = { subjectProvider: 'Aurora', price: 200, currency: 'EUR', qualityScore: 0.9, availability: 'in stock', leadTime: '1w', background: { rating: 4.7, reviewsCount: 120, eligibility: 'eligible', redFlags: ['late once'], sources: ['ratings.example', 'maps.example'] } };

async function seed(page: Page, s: string) { await page.addInitScript((v) => localStorage.setItem('inqi.session', v), s); }

test('customer dossier renders 4 steps with the real email chain from provenance, and makes NO admin call', async ({ page }) => {
  await seed(page, CUSTOMER);
  let threadCalled = false;
  let provenanceCalled = false;
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: live(repliedOption) }));
  await page.route('**/api/comms/thread/**', (r: Route) => { threadCalled = true; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }); });
  // The customer's provenance carries the chain — /comms/thread stays admin-only.
  await page.route('**/api/reports/*/options/*/provenance', (r: Route) => {
    provenanceCalled = true;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      web: [{ source: 'TrustSite', url: 'http://x/y', snippet: 'highly rated' }],
      feedback: { rating: 4.6, sentiment: 0.8, themes: ['fast shipping'], quotes: ['great service'] },
      scoring: { feedbackScore: 0.8, priceScore: 0.5, blendedScore: 0.68, rank: 1 },
      outreach: { persona: 'ellis', route: 'via inqi', outcome: 'replied', chain: [
        { direction: 'outbound', body: 'Hi, do you have it in stock?', at: '2026-07-02T16:00:00Z' },
        { direction: 'inbound', body: 'Yes — 200 EUR, ships this week.', at: '2026-07-02T16:05:00Z' },
      ] },
      depth: 'WebOutreachFeedback',
    }) });
  });

  await page.goto('/#/d/i1/Aurora');
  await expect(page.getByTestId('dossier')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Web search' })).toBeVisible();
  await expect(page.getByText('fast shipping')).toBeVisible();      // provenance feedback themes overlaid
  await expect(page.getByText('highly rated')).toBeVisible();        // provenance web snippet overlaid
  await expect(page.getByTestId('outreach-chain')).toBeVisible();    // the conversation as it happened
  await expect(page.getByText('Hi, do you have it in stock?')).toBeVisible();
  await expect(page.getByText('Yes — 200 EUR, ships this week.')).toBeVisible();
  expect(provenanceCalled).toBe(true);
  expect(threadCalled).toBe(false);                                 // never the admin-gated endpoint
});

test('researchPending provenance shows the in-progress note instead of empty web sources', async ({ page }) => {
  await seed(page, CUSTOMER);
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: live({ subjectProvider: 'Fresh', price: 150, currency: 'EUR', qualityScore: 0, availability: 'in stock', background: {} }) }));
  await page.route('**/api/reports/*/options/*/provenance', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    web: [],
    feedback: { rating: 0, sentiment: 0.5, themes: [], quotes: [] },
    scoring: { feedbackScore: 0, priceScore: 0.7, blendedScore: 0.28, rank: 2 },
    outreach: { persona: 'persona_ams', route: 'via inqi', outcome: 'replied' },
    depth: 'WebOnly',
    researchPending: true,
  }) }));

  await page.goto('/#/d/i1/Fresh');
  await expect(page.getByTestId('research-pending')).toBeVisible();
  await expect(page.getByText(/Depth research is still running/)).toBeVisible();
  await expect(page.getByText('research in progress')).toBeVisible(); // the step-1 result label
  await expect(page.getByText('No web sources recorded.')).toHaveCount(0);
});

test('outreach variants render by status', async ({ page }) => {
  await seed(page, CUSTOMER);
  // provenance is optional polish — 404 so the option-derived variant stands (hermetic; no live backend hit).
  await page.route('**/api/reports/*/options/*/provenance', (r: Route) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REPORT_NOT_FOUND' } }) }));
  // pending: contacted (leadTime) but no reply (availability)
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: live({ subjectProvider: 'P', price: 100, currency: 'EUR', qualityScore: 0.5, leadTime: '2w', background: { sources: ['a'] } }) }));
  await page.goto('/#/d/i1/P');
  await expect(page.getByTestId('outreach-redacted').getByText('Awaiting reply')).toBeVisible();

  // not-contacted: neither availability nor leadTime
  await page.unroute('**/api/reports/*/live');
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: live({ subjectProvider: 'N', price: 90, currency: 'EUR', qualityScore: 0.4, background: { sources: ['a'] } }) }));
  await page.goto('/#/d/i1/N');
  await expect(page.getByText(/Not contacted/)).toBeVisible();
});

test('multi-channel outreach renders one section per contact, exchanges as email boxes, and spins until provenance lands', async ({ page }) => {
  await seed(page, CUSTOMER);
  const reserveOption = { ...repliedOption, background: { ...repliedOption.background, eligibility: 'eligible with reservations — no 2-day package advertised', redFlags: ['No 2-day package advertised'] } };
  const liveBody = JSON.stringify({
    reportId: 'i1', state: 'OUTREACH', delivered: false, rawRequest: 'a bike', snapshotToken: null, reusedFrom: null, summary: '',
    options: [reserveOption],
    questionnaire: { confirmed: true, questions: [{ id: 'q1', type: 'select', prompt: 'Package length?' }], answers: { q1: '2-day weekend' } },
  });
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: liveBody }));
  // Delay provenance so the pending spinner is observable before the reveal.
  await page.route('**/api/reports/*/options/*/provenance', async (r: Route) => {
    await new Promise((res) => setTimeout(res, 700));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      web: [], feedback: { rating: 4.6, sentiment: 0.8, themes: [], quotes: [] },
      scoring: { feedbackScore: 0.8, priceScore: 0.5, blendedScore: 0.68, rank: 1 },
      outreach: { persona: 'nour', route: 'via inqi', outcome: 'replied', chain: [
        { direction: 'outbound', subject: 'Inquiry: bike', body: 'Sales: price?', at: '2026-07-05T10:00:00Z', channel: 'sales' },
        { direction: 'inbound', subject: 'Re: Inquiry: bike', body: 'Sales: 200 EUR.', at: '2026-07-05T10:05:00Z', channel: 'sales' },
        { direction: 'outbound', subject: 'Inquiry: bike', body: 'Booking: availability?', at: '2026-07-05T10:01:00Z', channel: 'booking' },
        { direction: 'inbound', subject: 'Re: Inquiry: bike', body: 'Booking: next week works.', at: '2026-07-05T10:06:00Z', channel: 'booking' },
      ] },
      depth: 'WebOutreachFeedback',
    }) });
  });

  await page.goto('/#/d/i1/Aurora');
  // While provenance is in flight the outreach section holds a compact spinner, never the fallback card.
  await expect(page.getByTestId('section-pending')).toBeVisible();
  await expect(page.getByTestId('outreach-redacted')).toHaveCount(0);
  // Then it unfolds into one section per channel, each message a verbatim email box.
  await expect(page.getByTestId('outreach-channel')).toHaveCount(2);
  await expect(page.getByText('Outreach — sales contact')).toBeVisible();
  await expect(page.getByText('Outreach — booking contact')).toBeVisible();
  await expect(page.getByTestId('email-outbound')).toHaveCount(2);
  await expect(page.getByTestId('email-inbound')).toHaveCount(2);
  // Reserve option: qualification shows the unmet constraints next to the confirmed scope.
  await expect(page.getByTestId('constraints-panel')).toContainText('did not evidence all of your confirmed constraints');
  await expect(page.getByTestId('constraints-panel')).toContainText('2-day weekend');
});

test('customer Back routes to the live report', async ({ page }) => {
  await seed(page, CUSTOMER);
  await page.route('**/api/reports/*/options/*/provenance', (r: Route) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REPORT_NOT_FOUND' } }) }));
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: live(repliedOption) }));
  await page.goto('/#/d/i1/Aurora');
  await page.getByRole('link', { name: /Back to report/ }).click();
  await expect(page).toHaveURL(/#\/r\/i1/);
});

test('admin dossier shows the full email chain', async ({ page }) => {
  await seed(page, ADMIN);
  await page.route('**/api/reports/*/live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: live({ ...repliedOption, inquiryId: 'sub1' }) }));
  await page.route('**/api/comms/thread/**', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'm1', inquiryId: 'sub1', direction: 'outbound', status: 'sent', body: 'Hi, do you have it in stock?', createdAt: '2026-06-28T12:00:00Z' }, { id: 'm2', inquiryId: 'sub1', direction: 'inbound', status: 'received', body: 'Yes, 200 EUR.', createdAt: '2026-06-28T13:00:00Z' }]) }));

  await page.goto('/#/admin/d/i1/Aurora');
  await expect(page.getByTestId('admin-chain')).toBeVisible();
  await expect(page.getByText('Hi, do you have it in stock?')).toBeVisible();
  await page.getByRole('link', { name: /Back to board/ }).click();
  await expect(page).toHaveURL(/#\/admin$/);
});
