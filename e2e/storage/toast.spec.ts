import { test, expect } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  connectAndOpenPrefix,
  deleteKnownKeys,
  putTextObject,
  rowByName,
  uniquePrefix
} from './helpers.js';

test.describe('Storage S3 — Toast notifications', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('copying a file shows a success toast with a dismiss button', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'toast-copy');
    const srcFile = `${prefix}toast-test.txt`;
    const cleanupKeys = [srcFile];

    try {
      await putTextObject(client, credentials.bucket, srcFile, 'toast test content');

      await connectAndOpenPrefix(page, credentials, prefix);

      // Copy the file via context menu — triggers a success toast
      await rowByName(page, 'toast-test.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
      await page.waitForTimeout(500);

      // Verify the success toast appears with the correct role
      const toast = page.getByRole('alert').filter({ hasText: /copied/i });
      await expect(toast).toBeVisible();

      // Verify the toast has a Dismiss button
      const dismissBtn = toast.getByRole('button', { name: 'Dismiss' });
      await expect(dismissBtn).toBeVisible();

      // Click Dismiss and verify the toast disappears
      await dismissBtn.click();
      await expect(toast).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
