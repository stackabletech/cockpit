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
      await putTextObject(client, credentials.bucket, `${prefix}escape-test.txt`, 'escape test');

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

  test('Copy filename copies the bare file name to the clipboard', async ({
    page,
    context,
    browserName
  }, testInfo) => {
    // Firefox does not support clipboard-read in grantPermissions.
    test.skip(browserName === 'firefox', 'Firefox does not support clipboard-read permission');

    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-copy-name');
    const cleanupKeys = [`${prefix}copy-name-test.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}copy-name-test.txt`,
        'copy name test'
      );

      // Playwright's grantPermissions for clipboard names only works in Chromium.
      // Firefox rejects both 'clipboard-read' and 'clipboard-write' with "Unknown permission".
      // In Firefox the clipboard write succeeds via user-gesture context without an explicit
      // grant, but reading back via navigator.clipboard.readText() is not possible in tests.
      if (browserName === 'chromium') {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      }
      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'copy-name-test.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy filename' }).click();

      await expect(page.getByText('Filename copied to clipboard')).toBeVisible();

      // clipboard.readText() requires the 'clipboard-read' permission which can only be granted
      // in Chromium via Playwright — skip the read-back check in Firefox.
      if (browserName === 'chromium') {
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toBe('copy-name-test.txt');
      }
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('Copy path copies the full s3:// URI to the clipboard', async ({
    page,
    context,
    browserName
  }, testInfo) => {
    // Firefox does not support clipboard-read in grantPermissions.
    test.skip(browserName === 'firefox', 'Firefox does not support clipboard-read permission');

    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-copy-path');
    const cleanupKeys = [`${prefix}copy-path-test.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}copy-path-test.txt`,
        'copy path test'
      );

      // See 'Copy filename' test above for explanation of the Chromium-only permission grant.
      if (browserName === 'chromium') {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      }
      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'copy-path-test.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy path' }).click();

      await expect(page.getByText('Path copied to clipboard')).toBeVisible();

      // Skip clipboard read-back in Firefox — see 'Copy filename' test above.
      if (browserName === 'chromium') {
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toBe(`s3://${credentials.bucket}/${prefix}copy-path-test.txt`);
      }
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
