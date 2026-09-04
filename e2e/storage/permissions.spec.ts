import { test, expect } from '@playwright/test';
import {
  createGarageBucketCredentials,
  createS3Client,
  hasGarageAdmin,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import { createTextUploadFixture } from '../support/storage-upload-fixtures.js';
import {
  connectAndOpenPrefix,
  connectToStorage,
  deleteKnownKeys,
  getObjectText,
  modalBox,
  objectExists,
  putTextObject,
  rowByName,
  uniqueBucketName,
  bucketRoute
} from './helpers.js';

test.describe('Storage S3 — Permissions', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('surfaces real Garage permission errors for a read-only bucket', async ({
    page
  }, testInfo) => {
    test.skip(
      !hasGarageAdmin(),
      'Skipped: Garage admin API is unavailable for per-test bucket setup'
    );

    const baseCredentials = requireGarageCredentials();
    const adminClient = createS3Client(baseCredentials);
    const restrictedBucket = uniqueBucketName(testInfo, 'readonly');
    const restrictedCredentials = await createGarageBucketCredentials(baseCredentials, {
      bucketName: restrictedBucket,
      keyName: `readonly-${testInfo.project.name}-${crypto.randomUUID()}`,
      permissions: { owner: false, read: true, write: false },
      ownerAccessKeyId: baseCredentials.accessKeyId
    });
    const uploadFixture = createTextUploadFixture(`${testInfo.title}-readonly-upload`);
    const existingKey = 'existing.txt';
    const blockedKey = uploadFixture.name;

    try {
      await putTextObject(adminClient, restrictedBucket, existingKey, 'keep me');

      await connectAndOpenPrefix(page, restrictedCredentials);
      await expect(rowByName(page, existingKey)).toBeVisible();

      await page.getByRole('button', { name: 'Upload' }).click();
      const uploadModal = modalBox(page);
      await uploadModal.locator('input[aria-label="Select files"]').setInputFiles(uploadFixture);
      await uploadModal.getByRole('button', { name: 'Upload' }).click();
      await expect(uploadModal.getByText('Upload complete')).toBeVisible();
      await expect(
        uploadModal.getByText('Access denied. You do not have permission to upload here.')
      ).toBeVisible();
      await uploadModal.getByRole('button', { name: 'Done' }).click();
      await expect(await objectExists(adminClient, restrictedBucket, blockedKey)).toBe(false);

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel(`Select ${existingKey}`).check();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByRole('button', { name: 'Delete permanently' }).click();

      const errorToast = page
        .getByRole('alert')
        .filter({ hasText: 'Access denied. You do not have permission to delete this item.' });
      await expect(errorToast).toBeVisible();
      await expect(rowByName(page, existingKey)).toBeVisible();
      await expect(await getObjectText(adminClient, restrictedBucket, existingKey)).toBe('keep me');
    } finally {
      await deleteKnownKeys(adminClient, restrictedBucket, [existingKey, blockedKey]);
    }
  });

  test('shows access denied error when browsing a write-only bucket', async ({
    page
  }, testInfo) => {
    test.skip(
      !hasGarageAdmin(),
      'Skipped: Garage admin API is unavailable for per-test bucket setup'
    );

    const baseCredentials = requireGarageCredentials();
    const writeonlyBucket = uniqueBucketName(testInfo, 'writeonly');
    const writeonlyCredentials = await createGarageBucketCredentials(baseCredentials, {
      bucketName: writeonlyBucket,
      keyName: `writeonly-${testInfo.project.name}-${crypto.randomUUID()}`,
      permissions: { owner: false, read: false, write: true },
      ownerAccessKeyId: baseCredentials.accessKeyId
    });

    await connectToStorage(page, writeonlyCredentials);
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();

    await page.goto(bucketRoute(new URL(baseCredentials.endpoint).hostname, writeonlyBucket));

    await expect(page.getByText('403')).toBeVisible();
    await expect(page.getByText('You do not have permission to access the bucket')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to storage' })).toBeVisible();
  });

  test('shows access denied error when browsing a no-access bucket', async ({ page }, testInfo) => {
    test.skip(
      !hasGarageAdmin(),
      'Skipped: Garage admin API is unavailable for per-test bucket setup'
    );

    const baseCredentials = requireGarageCredentials();
    const noAccessBucket = uniqueBucketName(testInfo, 'noaccess');
    const noAccessCredentials = await createGarageBucketCredentials(baseCredentials, {
      bucketName: noAccessBucket,
      keyName: `noaccess-${testInfo.project.name}-${crypto.randomUUID()}`,
      permissions: { owner: false, read: false, write: false },
      ownerAccessKeyId: baseCredentials.accessKeyId
    });

    await connectToStorage(page, noAccessCredentials);
    await expect(page).toHaveURL('/storage');
    await page.goto(bucketRoute(new URL(credentials.endpoint).hostname, noAccessBucket));

    await expect(page.getByText('403')).toBeVisible();
    await expect(page.getByText('You do not have permission to access the bucket')).toBeVisible();
  });
});
