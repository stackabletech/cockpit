import { test, expect, type Page } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  bucketRoute,
  connectAndOpenPrefix,
  connectToStorage,
  deleteKnownKeys,
  putTextObject,
  rowByName,
  uniquePrefix,
  waitForObjectsLoaded,
  waitForStorageConnected
} from './helpers.js';

async function previewFile(page: Page, name: string) {
  await rowByName(page, name).dblclick();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(page.getByRole('heading', { name })).not.toBeVisible();
}

test.describe('Storage S3 — Recent Items', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('tracks recently visited locations in the Recent Locations tab', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');
    await page.goto(bucketRoute(new URL(credentials.endpoint).hostname, credentials.bucket));
    await waitForObjectsLoaded(page);

    await page.goto('/storage');
    await waitForStorageConnected(page);

    await page.getByRole('tab', { name: 'Recent Locations' }).click();

    await expect(
      page.locator('tbody').getByRole('link', { name: credentials.bucket }).first()
    ).toBeVisible();
  });

  test('tracks recently accessed files in the Recent Files tab', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'recent-files');
    const cleanupKeys = [`${prefix}recent.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}recent.txt`, 'recently accessed');

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'recent.txt').dblclick();
      await expect(page.getByRole('heading', { name: 'recent.txt' })).toBeVisible();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Close', exact: true })
        .click();

      await page.goto('/storage');
      await waitForStorageConnected(page);

      await expect(page.locator('tbody').getByText('recent.txt')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('removes a deleted file from Recent Files', async ({ page }, testInfo) => {
    test.slow(); // multiple navigations + deletion; Firefox is slow in CI
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'recent-delete-file');
    const key = `${prefix}to-delete.txt`;

    try {
      await putTextObject(client, credentials.bucket, key, 'ephemeral');

      // Visit the file so it appears in Recent Files
      await connectAndOpenPrefix(page, credentials, prefix);
      await previewFile(page, 'to-delete.txt');

      // Confirm it appears in Recent Files
      await page.goto('/storage');
      await waitForStorageConnected(page);
      await expect(page.locator('tbody').getByText('to-delete.txt')).toBeVisible();

      // Delete the file via the UI
      await page.goto(
        bucketRoute(new URL(credentials.endpoint).hostname, credentials.bucket, prefix)
      );
      await waitForObjectsLoaded(page);
      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select to-delete.txt').check();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByRole('button', { name: 'Delete permanently' }).click();
      await expect(page.getByText('This bucket is empty')).toBeVisible();

      // File should no longer appear in Recent Files
      await page.goto('/storage');
      await waitForStorageConnected(page);
      await expect(page.locator('tbody').getByText('to-delete.txt')).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [key]);
    }
  });

  test('removes files and location from recent lists when a directory is deleted', async ({
    page
  }, testInfo) => {
    test.slow(); // multiple navigations + directory deletion; Firefox is slow
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'recent-delete-dir');
    const nestedKey = `${prefix}sub/nested.txt`;

    try {
      await putTextObject(client, credentials.bucket, nestedKey, 'nested content');

      // Navigate into the sub-directory so it appears in Recent Locations
      await connectAndOpenPrefix(page, credentials, `${prefix}sub/`);

      // Preview the nested file so it appears in Recent Files
      await previewFile(page, 'nested.txt');

      // Confirm both lists contain the entries
      await page.goto('/storage');
      await waitForStorageConnected(page);
      await expect(page.locator('tbody').getByText('nested.txt')).toBeVisible();
      await page.getByRole('tab', { name: 'Recent Locations' }).click();
      await expect(page.locator('tbody').getByText('sub', { exact: true })).toBeVisible();

      // Delete the parent directory via the UI
      await page.goto(
        bucketRoute(new URL(credentials.endpoint).hostname, credentials.bucket, prefix)
      );
      await waitForObjectsLoaded(page);
      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select sub').check();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByRole('button', { name: 'Delete permanently' }).click();
      await expect(page.getByText('This bucket is empty')).toBeVisible();

      // Neither the file nor the location should appear in the recent lists
      await page.goto('/storage');
      await waitForStorageConnected(page);
      await expect(page.locator('tbody').getByText('nested.txt')).not.toBeVisible();
      await page.getByRole('tab', { name: 'Recent Locations' }).click();
      await expect(page.locator('tbody').getByText('sub', { exact: true })).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [nestedKey]);
    }
  });
});
