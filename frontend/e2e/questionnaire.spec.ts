import { test, expect, Route } from '@playwright/test';

// FE-05: login-free /q/:token — data-driven form, confirm gate, submit → Live report, token states.

const TOKEN = 'tok123';
const future = '2999-01-01T00:00:00Z';
const past = '2000-01-01T00:00:00Z';

function dto(over: Record<string, unknown> = {}) {
  return {
    id: 'q1', inquiryId: 'i1', token: TOKEN, confirmed: false, expiresAt: future, answers: null,
    questions: [
      { id: 'confirm', type: 'confirm', prompt: 'Is this what you are looking for?' },
      { id: 'budget', type: 'text', prompt: 'Whats your budget range?' },
      { id: 'days', type: 'multiselect', prompt: 'Which days work?', options: ['Mon', 'Tue', 'Wed'] },
    ],
    ...over,
  };
}

async function stubReportLive(page: import('@playwright/test').Page) {
  await page.route('**/api/inquiries/*/report-live', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ inquiryId: 'i1', state: 'PRE_RESEARCH', delivered: false, rawRequest: 'a used road bike, Amsterdam', reportToken: null, reusedFrom: null, summary: '', options: [] }) }));
}

test('renders the form from the payload; confirm-gate blocks then enables; submit routes to Live report', async ({ page }) => {
  await stubReportLive(page);
  await page.route('**/api/q/*', (r: Route) => {
    if (r.request().method() === 'POST') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dto()) });
  });

  await page.goto(`/#/q/${TOKEN}`);
  await expect(page.getByText("Here's what we understood")).toBeVisible();
  await expect(page.getByText('a used road bike, Amsterdam')).toBeVisible();
  await expect(page.getByText('A few details to get it right')).toBeVisible();
  await expect(page.getByPlaceholder('Your answer')).toBeVisible();              // text field (budget)
  await expect(page.getByRole('button', { name: 'Mon' })).toBeVisible();          // multi-select chip (days)

  const submit = page.getByRole('button', { name: /Confirm & start research/ });
  await expect(submit).toBeDisabled();
  await page.getByTestId('confirm-gate').check();
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(page).toHaveURL(/#\/i\/i1/);
});

test('expired token shows the friendly recovery', async ({ page }) => {
  await stubReportLive(page);
  await page.route('**/api/q/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dto({ expiresAt: past })) }));
  await page.goto(`/#/q/${TOKEN}`);
  await expect(page.getByText('This link has expired')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go to sign in' })).toBeVisible();
});

test('invalid token (404) shows recovery', async ({ page }) => {
  await page.route('**/api/q/*', (r: Route) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'QUESTIONNAIRE_NOT_FOUND', message: 'not found' } }) }));
  await page.goto(`/#/q/${TOKEN}`);
  await expect(page.getByText("This link isn't valid")).toBeVisible();
});
