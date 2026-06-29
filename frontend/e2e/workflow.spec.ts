import { test, expect, Route, Page } from '@playwright/test';

// FE-15: workflow versions — tree, diagram↔diff toggle (colored), publish→refresh, cancel makes no call.

const ADMIN = JSON.stringify({ token: 't', customer: { id: 'a1', email: 'ops@x.io', role: 'admin' } });
const listV = (v2: string, v1: string) => JSON.stringify([
  { id: 'v2', key: 'standard_inquiry', version: 2, status: v2, pinnedInquiries: 0 },
  { id: 'v1', key: 'standard_inquiry', version: 1, status: v1, pinnedInquiries: 3 },
]);
const inspectBody = JSON.stringify({ id: 'v2', key: 'standard_inquiry', version: 2, status: 'draft', states: [{ name: 'RECEIVED', isInitial: true, isTerminal: false }, { name: 'DONE', isInitial: false, isTerminal: true }], transitions: [{ fromState: 'RECEIVED', toState: 'DONE', event: 'FINISH' }], validation: { valid: true, errors: [] } });
const diffBody = JSON.stringify({ from: { id: 'v1', version: 1 }, to: { id: 'v2', version: 2 }, diff: { states: { added: ['NEWSTATE'], removed: [] }, transitions: { added: ['A --go--> C'], removed: ['A --go--> B'] } } });

async function setup(page: Page, opts: { publishCounter?: { n: number } } = {}) {
  await page.addInitScript((s) => localStorage.setItem('inqi.session', s), ADMIN);
  let published = false; // keyed on an actual publish (robust to StrictMode's double mount-fetch)
  await page.route('**/api/workflows', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: published ? listV('active', 'archived') : listV('draft', 'active') }));
  await page.route('**/api/workflows/*/diff', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: diffBody }));
  await page.route('**/api/workflows/*/publish', (r: Route) => { published = true; if (opts.publishCounter) opts.publishCounter.n += 1; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'v2', version: 2, status: 'active', alreadyActive: false }) }); });
  await page.route('**/api/workflows/*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: inspectBody }));
}

test('tree → select version → toggle diff (colored) → publish → list refreshes to new Active/Archived', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin/workflows');
  await expect(page.getByTestId('workflow-versions')).toBeVisible();
  await expect(page.getByTestId('wf-version-v1')).toBeVisible();

  await page.getByTestId('wf-version-v2').click();
  await expect(page.getByTestId('wf-diagram')).toBeVisible();
  await expect(page.getByTestId('wf-diagram')).toContainText('RECEIVED');

  await page.getByTestId('wf-tab-diff').click();
  await expect(page.getByTestId('wf-diff')).toBeVisible();
  await expect(page.getByTestId('wf-diff-added')).toContainText('NEWSTATE');
  await expect(page.getByTestId('wf-diff-changed')).toContainText('A —go→ B ⇒ C');

  await page.getByTestId('wf-publish').click();
  await page.getByTestId('wf-publish-yes').click();
  // After publish the list refreshes: v2 is now active in the tree.
  await expect(page.getByTestId('wf-version-v2')).toContainText('active');
  await expect(page.getByTestId('wf-version-v1')).toContainText('archived');
});

test('cancelling the publish confirm makes no call', async ({ page }) => {
  const publishCounter = { n: 0 };
  await setup(page, { publishCounter });
  await page.goto('/#/admin/workflows');
  await expect(page.getByTestId('wf-version-v2')).toBeVisible();
  await page.getByTestId('wf-version-v2').click();
  await page.getByTestId('wf-publish').click();
  await page.getByTestId('wf-publish-no').click();
  await expect(page.getByTestId('wf-publish-yes')).toHaveCount(0); // dialog closed
  expect(publishCounter.n).toBe(0);
});
