import { test, expect, Route, Page } from '@playwright/test';

// FE-07: freemium teaser — locked top-4 (no leaked data) + unlock-with-credit; 0-balance path.

const SESSION = JSON.stringify({ token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });
const HIDDEN = 'Secret Top Co'; // present only in the unlocked (full) snapshot — must NOT leak pre-unlock

const freemiumBody = JSON.stringify({
  inquiryId: 'i1', state: 'OUTREACH', delivered: false, rawRequest: 'a weekly tennis coach near Porto', reportId: 'rep1', reportToken: null, reusedFrom: null, summary: 'partial', freemium: true, lockedCount: 4,
  options: [
    { id: 'o1', locked: true, rank: 1, subjectProvider: '' },
    { id: 'o2', locked: true, rank: 2, subjectProvider: '' },
    { id: 'o3', locked: true, rank: 3, subjectProvider: '' },
    { id: 'o4', locked: true, rank: 4, subjectProvider: '' },
    { id: 'Taster Co', subjectProvider: 'Taster Co', locked: false, rank: 5, price: 360, currency: 'EUR', qualityScore: 0.5 },
  ],
});
const fullBody = JSON.stringify({
  inquiryId: 'i1', state: 'REPORT_DELIVERED', delivered: true, rawRequest: 'a weekly tennis coach near Porto', reportId: 'rep1', reportToken: 'tok', reusedFrom: null, summary: 'Found 5 options', freemium: false, unlocked: true,
  options: [
    { subjectProvider: HIDDEN, price: 400, currency: 'EUR', qualityScore: 0.95 },
    { subjectProvider: 'Taster Co', price: 360, currency: 'EUR', qualityScore: 0.5 },
  ],
});

async function seed(page: Page) { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), SESSION); }

test('locked teaser leaks no hidden data; unlocking with credits reveals the full report', async ({ page }) => {
  await seed(page);
  let unlocked = false;
  await page.route('**/api/inquiries/*/report-live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: unlocked ? fullBody : freemiumBody }));
  await page.route('**/api/reports/*/unlock', (r: Route) => { unlocked = true; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'rep1', unlocked: true, balance: 0 }) }); });
  await page.route('**/api/me/credits', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: unlocked ? 0 : 1, history: [] }) }));

  await page.goto('/#/f/i1');
  await expect(page.getByTestId('freemium-teaser')).toBeVisible();
  await expect(page.getByText('+4 better options')).toBeVisible();
  await expect(page.getByText('Taster Co').first()).toBeVisible();
  await expect(page.getByText('🔒 locked')).toHaveCount(4);

  // The guardrail: hidden options are NOT in the DOM before unlock.
  await expect(page.getByText(HIDDEN)).toHaveCount(0);

  await page.getByRole('button', { name: /Unlock full report/ }).click();
  await expect(page.getByText('Your full report')).toBeVisible();
  await expect(page.getByText(HIDDEN)).toBeVisible(); // revealed only after unlock
});

test('zero balance shows the not-enough-credits path and routes to Credits', async ({ page }) => {
  await seed(page);
  await page.route('**/api/inquiries/*/report-live', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: freemiumBody }));
  await page.route('**/api/me/credits', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: 0, history: [] }) }));

  await page.goto('/#/f/i1');
  await expect(page.getByText('You have 0 credits')).toBeVisible();
  await page.getByRole('button', { name: /Unlock full report/ }).click();
  await expect(page.getByText('Not enough credits — top up to unlock.')).toBeVisible();
  await expect(page).toHaveURL(/#\/credits/);
});
