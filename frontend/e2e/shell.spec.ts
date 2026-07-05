import { test, expect } from '@playwright/test';

// FE-01 UI-draw e2e: the shell renders, navigates, guards work, and /styleguide draws.

test('/styleguide draws tokens + components', async ({ page }) => {
  await page.goto('/#/styleguide');
  await expect(page.getByTestId('styleguide')).toBeVisible();
  await expect(page.getByText('inqi styleguide')).toBeVisible();
  await expect(page.getByText('Colour tokens')).toBeVisible();
  await expect(page.getByText('Stage pipeline')).toBeVisible();
});

test('root → role-aware home (→ sign-in when signed out)', async ({ page }) => {
  await page.goto('/#/');
  await expect(page).toHaveURL(/#\/signin$/);
  await expect(page.getByText('One report. AI agents on it.')).toBeVisible();
});

test('the styleguide stays reachable by direct URL (no visible link — dev tool)', async ({ page }) => {
  await page.goto('/#/signin');
  await expect(page.getByRole('link', { name: 'styleguide' })).toHaveCount(0); // hidden from the sign-in page
  await page.goto('/#/styleguide');
  await expect(page.getByTestId('styleguide')).toBeVisible();
});

test('guarded admin route as a non-admin → 403 Forbidden', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('inqi.session', JSON.stringify({ token: 't', customer: { id: 'c', email: 'c@x.io', role: 'customer' } }));
  });
  await page.goto('/#/admin');
  await expect(page.getByText('For operators')).toBeVisible();
});

test('signed-out protected route → sign-in (401), carrying returnTo to resume', async ({ page }) => {
  await page.goto('/#/dashboard');
  await expect(page).toHaveURL(/#\/signin\?returnTo=%2Fdashboard/);
  await expect(page.getByText('One report. AI agents on it.')).toBeVisible();
});

test('unknown route → role-aware home (→ sign-in when signed out)', async ({ page }) => {
  await page.goto('/#/totally/unknown');
  await expect(page).toHaveURL(/#\/signin$/);
});
