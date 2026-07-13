import { test, expect } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  connectAndOpenPrefix,
  connectToStorage,
  deleteKnownKeys,
  putDirectoryMarker,
  putTextObject,
  rowByName,
  uniquePrefix
} from './helpers.js';

test.describe('Storage S3 — Details Modal', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('opens file details modal from context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'details-file');
    const cleanupKeys = [`${prefix}test.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}test.txt`, 'file details test');

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'test.txt').click({ button: 'right' });

      await page.getByRole('menuitem', { name: 'Details' }).click();
      await expect(page.getByRole('heading', { name: 'File Details' })).toBeVisible();

      await expect(page.getByText('test.txt')).toBeVisible();
      await expect(
        page.getByText('s3://' + credentials.bucket + '/' + prefix + 'test.txt')
      ).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('opens directory details modal from context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'details-dir');
    const cleanupKeys = [`${prefix}subdir/`, `${prefix}subdir/file.txt`];

    try {
      await putDirectoryMarker(client, credentials.bucket, `${prefix}subdir/`);
      await putTextObject(client, credentials.bucket, `${prefix}subdir/file.txt`, 'nested');

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'subdir').click({ button: 'right' });

      await page.getByRole('menuitem', { name: 'Details' }).click();
      await expect(page.getByRole('heading', { name: 'Directory Details' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('opens bucket details from sidebar context menu', async ({ page }) => {
    const credentials = requireGarageCredentials();
    const bucket = credentials.bucket;

    try {
      await connectToStorage(page, credentials);
      await expect(page).toHaveURL('/storage');

      const sidebar = page.getByRole('navigation', { name: 'Buckets' });
      await sidebar.getByText(bucket).click({ button: 'right' });

      await page.getByRole('menuitem', { name: 'Details' }).click();
      await expect(page.getByRole('heading', { name: 'Bucket Details' })).toBeVisible();
    } finally {
      // no cleanup needed — using the shared test bucket
    }
  });
});
