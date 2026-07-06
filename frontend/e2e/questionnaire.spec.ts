import { test, expect, Route } from '@playwright/test';

// FE-05 / HP-24: owner-gated /q/:token — data-driven form, confirm gate, submit → Live report, token states.

const SESSION = JSON.stringify({ token: 't', customer: { id: 'c1', email: 'c@x.io', role: 'customer' } });
test.beforeEach(async ({ page }) => { await page.addInitScript((s) => localStorage.setItem('inqi.session', s), SESSION); });

const TOKEN = 'tok123';
const future = '2999-01-01T00:00:00Z';
const past = '2000-01-01T00:00:00Z';

function dto(over: Record<string, unknown> = {}) {
  return {
    id: 'q1', reportId: 'i1', token: TOKEN, confirmed: false, expiresAt: future, answers: null,
    questions: [
      { id: 'confirm', type: 'confirm', prompt: 'Is this what you are looking for?' },
      { id: 'budget', type: 'text', prompt: 'Whats your budget range?' },
      { id: 'days', type: 'multiselect', prompt: 'Which days work?', options: ['Mon', 'Tue', 'Wed', 'Decide for me'] },
      { id: 'band', type: 'select', prompt: 'Which price band?', options: ['<500', '500-1500', '1500+', 'Decide for me'] },
    ],
    ...over,
  };
}

async function stubReportLive(page: import('@playwright/test').Page) {
  await page.route('**/api/reports/*/live', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reportId: 'i1', state: 'PRE_RESEARCH', delivered: false, rawRequest: 'a used road bike, Amsterdam', snapshotToken: null, reusedFrom: null, summary: '', options: [] }) }));
}

test('renders the form from the payload; confirm-gate blocks then enables; submit routes to Live report', async ({ page }) => {
  await stubReportLive(page);
  await page.route('**/api/q/*', (r: Route) => {
    if (r.request().method() === 'POST') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dto()) });
  });

  await page.goto(`/#/q/${TOKEN}`);
  await expect(page.getByText('inqi pre-researched your request')).toBeVisible();
  await expect(page.getByText('a used road bike, Amsterdam')).toBeVisible();
  await expect(page.getByText('A few details to get it right')).toBeVisible();
  await expect(page.getByPlaceholder('Your answer')).toBeVisible();              // text field (budget)
  await expect(page.getByRole('button', { name: 'Mon' })).toBeVisible();          // multi-select chip (days)

  const submit = page.getByRole('button', { name: /Confirm & start research/ });
  await expect(submit).toBeDisabled();
  await page.getByTestId('confirm-gate').check();
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(page).toHaveURL(/#\/r\/i1/);
});

test('multi-select toggles several chips; single-select is exclusive; "Decide for me" is offered on both', async ({ page }) => {
  await stubReportLive(page);
  let submitted: Record<string, string> | null = null;
  await page.route('**/api/q/*', (r: Route) => {
    if (r.request().method() === 'POST') {
      submitted = (r.request().postDataJSON() as { answers: Record<string, string> }).answers;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dto()) });
  });

  await page.goto(`/#/q/${TOKEN}`);
  // both question kinds carry the fallback option
  await expect(page.getByRole('button', { name: 'Decide for me' })).toHaveCount(2);

  // multi: Mon + Wed stay selected together
  await page.getByRole('button', { name: 'Mon' }).click();
  await page.getByRole('button', { name: 'Wed' }).click();
  // single: picking a second option replaces the first
  await page.getByRole('button', { name: '<500' }).click();
  await page.getByRole('button', { name: '1500+' }).click();

  await page.getByTestId('confirm-gate').check();
  await page.getByRole('button', { name: /Confirm & start research/ }).click();
  await expect(page).toHaveURL(/#\/r\/i1/);
  expect(submitted).toMatchObject({ days: 'Mon,Wed', band: '1500+' });
});

test('expired token shows the friendly recovery', async ({ page }) => {
  await stubReportLive(page);
  await page.route('**/api/q/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dto({ expiresAt: past })) }));
  await page.goto(`/#/q/${TOKEN}`);
  await expect(page.getByText('This link has expired')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
});

test('invalid token (404) shows recovery', async ({ page }) => {
  await page.route('**/api/q/*', (r: Route) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'QUESTIONNAIRE_NOT_FOUND', message: 'not found' } }) }));
  await page.goto(`/#/q/${TOKEN}`);
  await expect(page.getByText("This link isn't valid")).toBeVisible();
});
