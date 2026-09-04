import { test, expect } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import { connectAndOpenPrefix, deleteKnownKeys, objectExists, uniquePrefix } from './helpers.js';

test.describe('Storage S3 — Create via context menu', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('creates a text file via empty-space right-click context menu', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'create-file');
    const newFile = `${prefix}hello.txt`;
    const cleanupKeys = [newFile];

    try {
      await connectAndOpenPrefix(page, credentials, prefix);

      // Right-click on the empty-state row to trigger the empty-space context menu
      await page.getByText('This bucket is empty').click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();

      await page.getByRole('menuitem', { name: 'New text file' }).click();

      // The create modal appears with the name pre-filled
      const input = page.locator('.modal-box input');
      await expect(input).toBeVisible();
      await input.fill('hello.txt');

      await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();

      // Wait for the file to appear in the listing
      await page.waitForTimeout(1500);

      expect(await objectExists(client, credentials.bucket, newFile)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('creates a folder via empty-space right-click context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'create-folder');
    const newFolder = `${prefix}my-folder/`;
    const cleanupKeys = [newFolder];

    try {
      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByText('This bucket is empty').click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();

      await page.getByRole('menuitem', { name: 'New directory' }).click();

      const input = page.locator('.modal-box input');
      await expect(input).toBeVisible();
      await input.fill('my-folder');

      await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();

      // Wait for the folder to appear in the listing
      await page.waitForTimeout(1500);

      expect(await objectExists(client, credentials.bucket, newFolder)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
