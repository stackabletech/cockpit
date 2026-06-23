import { test, expect } from '@playwright/test';
import path from 'path';
import { hasGarageCredentials, requireGarageCredentials } from '../support/garage.js';
import {
  connectToStorage,
  openConnectForm,
  bucketRoute,
  clearAllSavedConnections
} from './helpers.js';
import { waitForHydration } from '../support/helpers.js';

test.describe('Storage S3 — Connection', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
    await clearAllSavedConnections(page);
  });

  test('connects to Garage S3 bucket and lists buckets', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);

    await expect(page).toHaveURL('/storage');
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Buckets' })).toBeVisible();
    await expect(main.getByRole('link', { name: credentials.bucket, exact: true })).toBeVisible();
  });

  test('shows an error for invalid Garage credentials', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await openConnectForm(page);
    await page.getByLabel('Endpoint URL').fill(credentials.endpoint);
    await page.getByLabel('Region').fill(credentials.region);
    await page.getByLabel('Access key ID').fill(credentials.accessKeyId);
    await page.getByLabel('Secret access key').fill(`${credentials.secretAccessKey}-wrong`);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
    await expect(
      page.getByText('Could not connect — check the endpoint and credentials.')
    ).toBeVisible();
  });

  test('disconnects from Garage S3', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
  });

  test('saves a connection and reconnects from the saved connections list', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    await openConnectForm(page);

    const savedList = page.getByRole('list', { name: 'Saved connections' });
    await expect(savedList).toBeVisible();

    await savedList.getByRole('listitem').first().getByRole('button').first().click();

    await expect(page).toHaveURL('/storage');
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();
  });

  test('forgets a saved connection via the remove button', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    await openConnectForm(page);

    const savedList = page.getByRole('list', { name: 'Saved connections' });
    await expect(savedList).toBeVisible();

    await savedList.getByRole('listitem').first().getByRole('button').last().click();

    await expect(page.getByRole('button', { name: 'Forget', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Forget', exact: true }).click();

    await expect(savedList).not.toBeVisible();
    await expect(page.getByText('No saved connections yet')).toBeVisible();
  });

  test('clicking a bucket tile in the grid navigates to the bucket explorer', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    const bucketLink = page
      .locator('main')
      .getByRole('link', { name: credentials.bucket, exact: true });
    await expect(bucketLink).toBeVisible();
    await bucketLink.click();

    await expect(page).toHaveURL(bucketRoute(credentials.bucket));
    await expect(page.locator('nav[aria-label="breadcrumb"] [aria-current="page"]')).toContainText(
      credentials.bucket
    );
  });

  test('connection persists across a page reload', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();

    await page.reload();

    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();
  });

  test("two users cannot see each other's connections", async ({ page, browser }, testInfo) => {
    const credentials = requireGarageCredentials();

    // User 1 connects to storage
    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    // User 2: load the pre-authenticated session of a *different* browser project.
    // Each project authenticates as a distinct mock-OIDC user, so their
    // server-side storage connections are isolated by userId.
    // Reusing a saved auth state avoids the SSO redirect flow, which is
    // slow and unreliable when running in parallel with other projects.
    const origin = new URL(page.url()).origin;
    const user2Setup = testInfo.project.name === 'chromium' ? 'setup-firefox' : 'setup-chromium';
    const authFile = path.join(import.meta.dirname, `../.auth/user-${user2Setup}.json`);
    const context2 = await browser.newContext({ baseURL: origin, storageState: authFile });
    const page2 = await context2.newPage();

    try {
      // Clear any connections that parallel firefox tests may have created
      // for this user. Each browser project authenticates as a distinct
      // mock-OIDC user, but tests across projects run in parallel and share
      // the same auth state file, so connections accumulate in the DB.
      await clearAllSavedConnections(page2);

      await page2.goto('/storage?disconnected=1');
      await waitForHydration(page2);

      await expect(page2.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
      await expect(page2.getByText('No saved connections yet')).toBeVisible();
    } finally {
      await context2.close();
    }
  });

  test('deleting a saved connection redirects to the disconnected form', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    // Open the connect form (disconnects first if needed, then shows the carousel)
    await openConnectForm(page);

    const savedList = page.getByRole('list', { name: 'Saved connections' });
    await expect(savedList).toBeVisible();

    // Click the remove (X) button on the first saved connection to open confirmation
    await savedList.getByRole('listitem').first().getByRole('button').last().click();

    // Confirm the deletion
    await expect(page.getByRole('button', { name: 'Forget', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Forget', exact: true }).click();

    // Should redirect to /storage and show the disconnected form with no saved connections
    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
    await expect(page.getByText('No saved connections yet')).toBeVisible();
  });
});
