import { test, expect } from '@playwright/test';

// FE-03: owner-scoped list with the 6-stage pipeline + badges + balance, live transition, stage routing.

const SESSION = JSON.stringify({ token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });

test('empty state shows the first-run CTA', async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), SESSION);
  await page.route('**/api/inquiries', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/me/credits', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: 0, history: [] }) }));

  await page.goto('/#/dashboard');
  await expect(page.getByText('Nothing in flight yet')).toBeVisible();
});

test('lists inquiries, updates a row on a live transition, and routes by stage', async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), SESSION);
  const inquiries = [{ id: 'inq11111aaaa', rawRequest: 'a used road bike, Amsterdam', state: 'OUTREACH', customerEmail: 'c@x.io', createdAt: new Date().toISOString() }];
  await page.route('**/api/inquiries', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inquiries) }));
  await page.route('**/api/me/credits', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: 2, history: [] }) }));

  await page.goto('/#/dashboard');
  await expect(page.getByText('a used road bike, Amsterdam')).toBeVisible();
  await expect(page.getByText('2 credits')).toBeVisible();
  await expect(page.getByTestId('inquiry-status')).toHaveText('Researching');

  // HP-23: a stage-only transition (state holds at OUTREACH, ≥2 qualified) updates the pipeline live.
  await page.evaluate(() => {
    (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({
      type: 'realtime/event',
      event: { id: '98', type: 'inquiry.transitioned', inquiryId: 'inq11111aaaa', at: 'now', data: { from: 'OUTREACH', to: 'OUTREACH', stage: 'Partially ready', qualifiedCount: 2 } },
    });
  });
  await expect(page.getByTestId('inquiry-status')).toHaveText('Partially ready');

  // Live: dispatch inquiry.transitioned → row badge becomes Ready (real reducer path).
  await page.evaluate(() => {
    (window as unknown as { __inqiDispatch: (a: unknown) => void }).__inqiDispatch({
      type: 'realtime/event',
      event: { id: '99', type: 'inquiry.transitioned', inquiryId: 'inq11111aaaa', at: 'now', data: { to: 'REPORT_DELIVERED', stage: 'Ready' } },
    });
  });
  await expect(page.getByTestId('inquiry-status')).toHaveText('Ready');

  // Ready stage → routes to the live report (own view).
  await page.getByTestId('inquiry-row').click();
  await expect(page).toHaveURL(/#\/i\/inq11111aaaa/);
});
