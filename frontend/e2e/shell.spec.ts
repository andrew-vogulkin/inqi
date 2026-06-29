import { test, expect } from '@playwright/test';

// FE-01 UI-draw e2e: the shell renders, navigates, guards work, and /styleguide draws.

test('/styleguide draws tokens + components', async ({ page }) => {
  await page.goto('/#/styleguide');
  await expect(page.getByTestId('styleguide')).toBeVisible();
  await expect(page.getByText('inqi styleguide')).toBeVisible();
  await expect(page.getByText('Colour tokens')).toBeVisible();
  await expect(page.getByText('Stage pipeline')).toBeVisible();
});

test('home renders the customer shell + nav', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByText('Your AI is on it')).toBeVisible();
  await expect(page.getByRole('link', { name: 'My inquiries' })).toBeVisible();
});

test('navigates home → styleguide', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Styleguide' }).click();
  await expect(page.getByTestId('styleguide')).toBeVisible();
});

test('guarded admin route as a non-admin → 403 Forbidden', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('inqi.session', JSON.stringify({ token: 't', customer: { id: 'c', email: 'c@x.io', role: 'customer' } }));
  });
  await page.goto('/#/admin');
  await expect(page.getByText('For operators')).toBeVisible();
});

test('signed-out protected route → sign-in (401)', async ({ page }) => {
  await page.goto('/#/dashboard');
  await expect(page.getByText('Please sign in')).toBeVisible();
});

test('unknown route → 404 not found', async ({ page }) => {
  await page.goto('/#/totally/unknown');
  await expect(page.getByText("Can't find that inquiry")).toBeVisible();
});
