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
  modalBox,
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

      await expect(page.getByText('test.txt').first()).toBeVisible();
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

  test('calculates the size of a directory', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'details-size');
    const cleanupKeys = [`${prefix}subdir/big.txt`, `${prefix}subdir/nested/small.txt`];

    try {
      await putTextObject(client, credentials.bucket, cleanupKeys[0], 'x'.repeat(2048));
      await putTextObject(client, credentials.bucket, cleanupKeys[1], 'tiny');

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'subdir').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Details' }).click();

      const modal = modalBox(page);
      await modal.getByRole('button', { name: 'Calculate directory size' }).click();
      await expect(modal.getByText('Total size')).toBeVisible();
      await expect(modal.getByText('2 files')).toBeVisible();
      await expect(modal.getByText('Stopped after')).toHaveCount(0);

      await modal.getByRole('tab', { name: 'Contents' }).click();
      await expect(modal.getByRole('cell', { name: 'big.txt' })).toBeVisible();
      await expect(modal.getByRole('cell', { name: 'nested/' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('shows partial results when the key limit is reached', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'details-truncated');
    const cleanupKeys = [`${prefix}subdir/file.txt`];

    try {
      await putTextObject(client, credentials.bucket, cleanupKeys[0], 'nested');
      // The real limit is far above what a test can list, so answer with a truncated result.
      const result = {
        type: 'complete',
        totalSize: 3000,
        totalKeys: 3,
        totalFiles: 3,
        totalDirectories: 0,
        tree: {
          name: 'subdir',
          size: 3000,
          children: [
            { name: 'a.bin', size: 2000, fullKey: `${prefix}subdir/a.bin` },
            { name: '', size: 1000, moreCount: 2 }
          ]
        },
        childrenByDepth: {
          1: {
            items: [{ name: 'a.bin', size: 2000, isDirectory: false }],
            omittedCount: 2,
            omittedSize: 1000
          }
        },
        maxDepth: 1,
        durationMs: 1,
        truncated: true
      };
      await page.route('**/api/storage/directory-size?*', (route) =>
        route.fulfill({
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify(result)}\n\n`
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'subdir').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Details' }).click();

      const modal = modalBox(page);
      await modal.getByRole('button', { name: 'Calculate directory size' }).click();
      await expect(modal.getByRole('status')).toContainText('Stopped after 3 objects');
      await expect(modal.getByText('2 more', { exact: true })).toBeVisible();

      await modal.getByRole('tab', { name: 'Contents' }).click();
      await expect(modal.getByText('2 smaller entries not shown')).toBeVisible();
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

  test('marks bucket details sections that could not be loaded', async ({ page }) => {
    const credentials = requireGarageCredentials();
    const bucket = credentials.bucket;

    await page.route(
      (url) =>
        url.pathname === '/api/storage/buckets' && url.searchParams.get('details') === 'true',
      (route) =>
        route.fulfill({
          json: { name: bucket, versioning: null, lifecycleRules: [], tags: null, acl: null }
        })
    );

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    const sidebar = page.getByRole('navigation', { name: 'Buckets' });
    await sidebar.getByText(bucket).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Details' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('heading', { name: 'Bucket Details' })).toBeVisible();
    // Versioning, owner and tags failed; lifecycle loaded and is genuinely empty.
    await expect(modal.getByText('Could not load')).toHaveCount(3);
    await expect(modal.getByText('Disabled')).toHaveCount(0);
    await expect(modal.getByText('No lifecycle rules')).toBeVisible();
  });
});
