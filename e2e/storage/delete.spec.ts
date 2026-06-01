import { test, expect } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  connectAndOpenPrefix,
  deleteKnownKeys,
  objectExists,
  putDirectoryMarker,
  putTextObject,
  rowByName,
  uniquePrefix
} from './helpers.js';

test.describe('Storage S3 — Delete & Selection', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('deletes files and folders recursively', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'delete');
    const cleanupKeys = [`${prefix}remove-me.txt`, `${prefix}archive/nested.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}remove-me.txt`, 'remove');
      await putTextObject(client, credentials.bucket, `${prefix}archive/nested.txt`, 'nested');

      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select remove-me.txt').check();
      await page.getByLabel('Select archive').check();

      await page.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByText('All contents will be permanently deleted')).toBeVisible();
      await page.getByRole('button', { name: 'Delete permanently' }).click();

      await expect(page.getByText('This bucket is empty')).toBeVisible();
      await expect(await objectExists(client, credentials.bucket, `${prefix}remove-me.txt`)).toBe(
        false
      );
      await expect(
        await objectExists(client, credentials.bucket, `${prefix}archive/nested.txt`)
      ).toBe(false);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('cancel delete does not remove the selected file', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'cancel-delete');
    const cleanupKeys = [`${prefix}keep-me.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}keep-me.txt`, 'do not delete');

      await connectAndOpenPrefix(page, credentials, prefix);
      await expect(rowByName(page, 'keep-me.txt')).toBeVisible();

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select keep-me.txt').check();
      await page.getByRole('button', { name: 'Delete' }).click();

      await expect(page.getByText('This action cannot be undone.')).toBeVisible();

      await page.getByRole('button', { name: 'Cancel' }).click();

      await expect(page.getByText('This action cannot be undone.')).not.toBeVisible();
      await expect(rowByName(page, 'keep-me.txt')).toBeVisible();
      await expect(await objectExists(client, credentials.bucket, `${prefix}keep-me.txt`)).toBe(
        true
      );
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('selects all items and deselects them with the header checkbox', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'select-all');
    const cleanupKeys = [`${prefix}alpha.txt`, `${prefix}beta.txt`, `${prefix}sub/`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}alpha.txt`, 'a');
      await putTextObject(client, credentials.bucket, `${prefix}beta.txt`, 'b');
      await putDirectoryMarker(client, credentials.bucket, `${prefix}sub/`);

      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();

      const selectAll = page.getByLabel('Select all');
      await selectAll.check();

      await expect(page.getByLabel('Select alpha.txt')).toBeChecked();
      await expect(page.getByLabel('Select beta.txt')).toBeChecked();
      await expect(page.getByLabel('Select sub')).toBeChecked();

      await selectAll.uncheck();

      await expect(page.getByLabel('Select alpha.txt')).not.toBeChecked();
      await expect(page.getByLabel('Select beta.txt')).not.toBeChecked();
      await expect(page.getByLabel('Select sub')).not.toBeChecked();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
