import { test, expect } from '../support/fixtures.js';
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

  test('a right-click elsewhere replaces the open context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-replace');
    const cleanupKeys = [`${prefix}first.txt`, `${prefix}second.txt`];

    try {
      for (const key of cleanupKeys) await putTextObject(client, credentials.bucket, key, 'x');

      await connectAndOpenPrefix(page, credentials, prefix);

      const menu = page.getByRole('menu');
      await rowByName(page, 'first.txt').click({ button: 'right' });
      await expect(menu).toBeVisible();

      // Another row of the same list moves the menu and keeps that row selected.
      await rowByName(page, 'second.txt').click({ button: 'right', position: { x: 10, y: 10 } });
      await expect(menu).toHaveCount(1);
      await expect(menu.getByRole('menuitem', { name: 'Preview' })).toBeVisible();
      await expect(page.getByText('1 selected')).toBeVisible();

      // Another component's target opens its own menu instead.
      const sidebar = page.getByRole('navigation', { name: 'Buckets' });
      await sidebar.getByText(credentials.bucket).click({ button: 'right' });
      await expect(menu).toHaveCount(1);
      await expect(menu.getByRole('menuitem', { name: 'Details' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('a row actions button opens the menu next to it from the keyboard', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-keyboard');
    const cleanupKeys = [`${prefix}keyboard.txt`];

    try {
      await putTextObject(client, credentials.bucket, cleanupKeys[0], 'x');

      await connectAndOpenPrefix(page, credentials, prefix);

      const button = page.getByRole('button', { name: 'Actions for keyboard.txt', exact: true });
      await button.focus();
      await button.press('Enter');

      await expect(page.getByRole('menu')).toBeFocused();
      // Right below the button, not in the top-left corner. It opens at the button's bottom-right
      // corner, on whichever side of it fits into the viewport.
      const buttonBox = (await button.boundingBox())!;
      const panel = page.locator(':popover-open').filter({ has: page.getByRole('menu') });
      const menuBox = (await panel.boundingBox())!;
      const buttonRight = buttonBox.x + buttonBox.width;
      expect(menuBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height - 1);
      expect(menuBox.y - (buttonBox.y + buttonBox.height)).toBeLessThan(24);
      expect(menuBox.x).toBeLessThanOrEqual(buttonRight + 1);
      expect(menuBox.x + menuBox.width).toBeGreaterThanOrEqual(buttonRight - 1);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('unpins a pinned location from its sidebar menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-unpin');
    const cleanupKeys = [`${prefix}file.txt`];

    try {
      await putTextObject(client, credentials.bucket, cleanupKeys[0], 'x');
      await connectAndOpenPrefix(page, credentials, prefix);

      const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
      await breadcrumb.getByText(credentials.bucket).hover();
      await page
        .getByRole('button', { name: 'Pin this location' })
        .filter({ visible: true })
        .first()
        .click();
      const sidebar = page.getByRole('navigation', { name: 'Buckets' });
      await expect(sidebar.getByText('Pinned Access')).toBeVisible();

      await sidebar.getByRole('button', { name: 'More options' }).click({ force: true });
      const menu = page.getByRole('menu', { name: 'Actions' });
      await menu.getByRole('menuitem', { name: 'Unpin' }).click();

      await expect(menu).toHaveCount(0);
      await expect(sidebar.getByText('Pinned Access')).toHaveCount(0);
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

      await expect(page.getByText('This folder is empty')).toBeVisible();
      expect(await objectExists(client, credentials.bucket, `${prefix}ctx-del.txt`)).toBe(false);
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
