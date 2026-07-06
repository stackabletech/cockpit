import { test, expect } from '@playwright/test';
import { hasGarageCredentials, requireGarageCredentials } from '../support/garage.js';
import { connectToStorage, openConnectForm, bucketRoute } from './helpers.js';

test.describe('Storage S3 — Connection', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('connects to Garage S3 bucket and lists buckets', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);

    await expect(page).toHaveURL('/storage');
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Buckets' })).toBeVisible();
    // Both the sidebar nav and the bucket grid render a link for each bucket — use first() to
    // avoid a strict-mode violation while still confirming the bucket is visible in the UI.
    await expect(
      main.getByRole('link', { name: credentials.bucket, exact: true }).first()
    ).toBeVisible();
  });

  test('shows an error for invalid Garage credentials', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await openConnectForm(page);
    const url = new URL(credentials.endpoint);
    await page.getByLabel('Host').fill(url.hostname);
    if (url.port) await page.getByLabel('Port').fill(url.port);
    const tlsToggle = page.getByLabel('Use TLS');
    if (url.protocol !== 'https:' && (await tlsToggle.isChecked())) await tlsToggle.uncheck();
    await page.getByLabel('Access style').selectOption('Path');
    await page.getByLabel('Region').fill(credentials.region);
    await page.getByLabel('Access key').fill(credentials.accessKeyId);
    await page.getByLabel('Secret key').fill(`${credentials.secretAccessKey}-wrong`);
    await page.getByRole('button', { name: 'Connect' }).click();

    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
    await expect(
      page.getByText('Could not connect — check the endpoint and credentials.')
    ).toBeVisible();
  });

  test('disconnects from Garage S3', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();

    // Click the sidebar Disconnect button — this opens a confirmation modal.
    await page.getByRole('button', { name: 'Disconnect' }).click();
    // Clicking Disconnect opens a confirmation modal; confirm by clicking the
    // Disconnect button inside the dialog.
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
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
      .getByRole('link', { name: credentials.bucket, exact: true })
      .first();
    await expect(bucketLink).toBeVisible();
    await bucketLink.click();

    await expect(page).toHaveURL(bucketRoute(credentials.bucket));
    await expect(page.locator('nav[aria-label="breadcrumb"] [aria-current="page"]')).toContainText(
      credentials.bucket
    );
  });
});
