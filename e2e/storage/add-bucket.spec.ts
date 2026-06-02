import { test, expect } from '@playwright/test';
import {
  createGarageBucketCredentials,
  hasGarageAdmin,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import { connectToStorage, modalBox, uniqueBucketName } from './helpers.js';

test.describe('Storage S3 — Add bucket manually', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  async function openAddBucketModal(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Add bucket' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect to a bucket' })).toBeVisible();
  }

  test('opens and closes the Add bucket modal', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    await openAddBucketModal(page);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('Connect button is disabled when input is empty', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);

    await openAddBucketModal(page);

    await expect(modalBox(page).getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  test('navigates into bucket after successful connection', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    await openAddBucketModal(page);
    await modalBox(page).getByLabel('Bucket name').fill(credentials.bucket);
    await modalBox(page).getByRole('button', { name: 'Connect' }).click();

    await expect(page).toHaveURL(`/storage/${encodeURIComponent(credentials.bucket)}`);
  });

  test('bucket appears in the bucket grid after successful connection', async ({
    page
  }, testInfo) => {
    test.skip(
      !hasGarageAdmin(),
      'Skipped: Garage admin API is unavailable for per-test bucket setup'
    );

    const baseCredentials = requireGarageCredentials();
    const extraBucketName = uniqueBucketName(testInfo, 'manual-add');

    // Connect before the extra bucket is created so it is absent from the initial listing.
    // In Garage, AllowBucketKey with any permission causes the bucket to appear in ListBuckets,
    // so we must create the bucket *after* the page has loaded to ensure it is not pre-listed.
    await connectToStorage(page, baseCredentials);
    await expect(page).toHaveURL('/storage');

    // Create the extra bucket and grant the base key access now that the page is already loaded.
    await createGarageBucketCredentials(baseCredentials, {
      bucketName: extraBucketName,
      keyName: `manual-${testInfo.project.name}-${crypto.randomUUID()}`,
      permissions: { owner: false, read: true, write: false },
      ownerAccessKeyId: baseCredentials.accessKeyId
    });

    // The extra bucket should not be listed — it was created after the page loaded
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: extraBucketName, exact: true })).not.toBeVisible();

    // Add it manually
    await openAddBucketModal(page);
    await modalBox(page).getByLabel('Bucket name').fill(extraBucketName);
    await modalBox(page).getByRole('button', { name: 'Connect' }).click();

    // Should navigate into the bucket
    await expect(page).toHaveURL(`/storage/${encodeURIComponent(extraBucketName)}`);

    // Go back to the bucket grid and confirm the bucket is now shown
    await page.goto('/storage');
    await expect(main.getByRole('link', { name: extraBucketName, exact: true })).toBeVisible();
  });

  test('shows access denied error for a bucket without read permission', async ({
    page
  }, testInfo) => {
    test.skip(
      !hasGarageAdmin(),
      'Skipped: Garage admin API is unavailable for per-test bucket setup'
    );

    const baseCredentials = requireGarageCredentials();
    const blockedBucket = uniqueBucketName(testInfo, 'no-access');
    const noAccessCredentials = await createGarageBucketCredentials(baseCredentials, {
      bucketName: blockedBucket,
      keyName: `noaccess-${testInfo.project.name}-${crypto.randomUUID()}`,
      permissions: { owner: false, read: false, write: false },
      ownerAccessKeyId: baseCredentials.accessKeyId
    });

    await connectToStorage(page, noAccessCredentials);
    await expect(page).toHaveURL('/storage');

    await openAddBucketModal(page);
    await modalBox(page).getByLabel('Bucket name').fill(blockedBucket);
    await modalBox(page).getByRole('button', { name: 'Connect' }).click();

    await expect(modalBox(page).getByRole('alert')).toContainText('Access denied');

    // Modal should remain open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL('/storage');
  });

  test('shows not found error for a non-existent bucket', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    await openAddBucketModal(page);
    await modalBox(page).getByLabel('Bucket name').fill('this-bucket-does-not-exist-xyz-99999');
    await modalBox(page).getByRole('button', { name: 'Connect' }).click();

    await expect(modalBox(page).getByRole('alert')).toContainText('Bucket not found');

    // Modal should remain open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL('/storage');
  });

  test('resets form state after closing and reopening the modal', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectToStorage(page, credentials);

    await openAddBucketModal(page);
    await modalBox(page).getByLabel('Bucket name').fill('some-value');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await openAddBucketModal(page);
    await expect(modalBox(page).getByLabel('Bucket name')).toHaveValue('');
  });
});
