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
  putTextObject,
  rowByName,
  uniquePrefix
} from './helpers.js';

test.describe('Storage S3 — Context Menu', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('context menu appears on right-click and shows file actions', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-menu');
    const cleanupKeys = [`${prefix}ctx-file.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}ctx-file.txt`, 'menu test');

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'ctx-file.txt').click({ button: 'right' });

      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Preview' })).toBeEnabled();
      await expect(menu.getByRole('menuitem', { name: 'Download' })).toBeEnabled();
      await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeEnabled();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('context menu closes when the Escape key is pressed', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-escape');
    const cleanupKeys = [`${prefix}escape-test.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}escape-test.txt`,
        'escape test'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'escape-test.txt').click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(page.getByRole('menu')).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('deletes a single file via context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-delete');
    const cleanupKeys = [`${prefix}ctx-del.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}ctx-del.txt`, 'delete me');

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'ctx-del.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Delete' }).click();

      await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeVisible();
      await page.getByRole('button', { name: 'Delete permanently' }).click();

      await expect(page.getByText('This bucket is empty')).toBeVisible();
      await expect(await objectExists(client, credentials.bucket, `${prefix}ctx-del.txt`)).toBe(
        false
      );
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
