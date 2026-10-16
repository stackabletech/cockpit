import { test, expect } from '../support/fixtures.js';
import { readFile } from 'node:fs/promises';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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
      await page.getByLabel('Select archive', { exact: true }).check();

      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByText('All contents will be permanently deleted')).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();

      await expect(page.getByText('This folder is empty')).toBeVisible();
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

  test('deletes files whose keys use characters and segments S3 allows', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'delete-odd-keys');
    const names = ['what?.csv', 'a"b<c>d|e\\f.txt', '..'];
    const cleanupKeys = names.map((name) => `${prefix}${name}`);

    try {
      for (const key of cleanupKeys) {
        await putTextObject(client, credentials.bucket, key, 'odd');
      }

      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      for (const name of names) {
        await page.getByLabel(`Select ${name}`, { exact: true }).check();
      }

      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();

      await expect(page.getByText('This folder is empty')).toBeVisible();
      for (const key of cleanupKeys) {
        expect(await objectExists(client, credentials.bucket, key)).toBe(false);
      }
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('lists, previews, downloads and deletes keys with control characters, spaces, "+" and "%"', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'delete-encoded-keys');
    // Displayed names collapse whitespace, as Playwright's text matching does.
    const files = [
      { name: 'tab\there.txt', shown: 'tab here.txt', body: 'tab body' },
      { name: 'new\nline.txt', shown: 'new line.txt', body: 'newline body' },
      { name: 'carriage\rreturn.txt', shown: 'carriage return.txt', body: 'return body' },
      // XML cannot carry U+0001, so it is deleted outside the DeleteObjects batch.
      { name: 'start\u0001of-heading.txt', shown: 'start\u0001of-heading.txt', body: 'soh body' },
      { name: 'with space.txt', shown: 'with space.txt', body: 'space body' },
      { name: 'plus+sign.txt', shown: 'plus+sign.txt', body: 'plus body' },
      { name: '100%.txt', shown: '100%.txt', body: 'percent body' }
    ];
    const cleanupKeys = files.map(({ name }) => `${prefix}${name}`);

    try {
      for (const { name, body } of files) {
        await putTextObject(client, credentials.bucket, `${prefix}${name}`, body);
      }

      // Garage supports url-encoded listings, echoes the encoding type the app checks before
      // decoding, and its encoding decodes back to the stored keys with the app's rule (`+` is a
      // space, then percent-decoding).
      const listing = await client.send(
        new ListObjectsV2Command({
          Bucket: credentials.bucket,
          Prefix: prefix,
          EncodingType: 'url'
        })
      );
      expect(listing.EncodingType).toBe('url');
      const decoded = (listing.Contents ?? []).map(({ Key }) =>
        decodeURIComponent((Key ?? '').replaceAll('+', ' '))
      );
      expect(decoded.sort()).toEqual([...cleanupKeys].sort());

      await connectAndOpenPrefix(page, credentials, prefix);
      for (const { shown } of files) {
        await expect(rowByName(page, shown)).toBeVisible();
      }

      for (const { shown, body } of files) {
        await rowByName(page, shown).dblclick();
        await expect(page.getByRole('heading', { name: shown })).toBeVisible();
        await expect(page.getByText(body, { exact: true })).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
        await expect(page.getByRole('heading', { name: shown })).not.toBeVisible();
      }

      for (const { shown, body } of files) {
        await rowByName(page, shown).click({ button: 'right' });
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByRole('menuitem', { name: 'Download' }).click()
        ]);
        expect(await download.failure()).toBeNull();
        expect(await readFile((await download.path())!, 'utf8')).toBe(body);
      }

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select all').check();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();

      await expect(page.getByText('This folder is empty')).toBeVisible();
      for (const key of cleanupKeys) {
        expect(await objectExists(client, credentials.bucket, key)).toBe(false);
      }
    } finally {
      // DeleteObjects cannot name the U+0001 key, so every key is deleted on its own.
      for (const key of cleanupKeys) {
        await client.send(new DeleteObjectCommand({ Bucket: credentials.bucket, Key: key }));
      }
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
      await page.getByRole('button', { name: 'Delete', exact: true }).click();

      await expect(page.getByText('This action cannot be undone.')).toBeVisible();

      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

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

  test('Delete keyboard shortcut opens the delete confirmation modal', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'kb-delete');
    const cleanupKeys = [`${prefix}delete-me.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}delete-me.txt`, 'delete me');

      await connectAndOpenPrefix(page, credentials, prefix);

      // Select the file by clicking on the row
      await rowByName(page, 'delete-me.txt').click();
      await expect(page.getByLabel('Select delete-me.txt')).toBeChecked();

      // Press Delete key
      await page.keyboard.press('Delete');

      // Delete confirmation modal should appear
      await expect(page.getByRole('heading', { name: /Delete.*delete-me.txt/i })).toBeVisible();
      await expect(page.getByText('This action cannot be undone.')).toBeVisible();

      // Cancel the delete
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('heading', { name: /Delete.*delete-me.txt/i })).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('Delete outside the file listing does not open the delete modal', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'kb-delete-scope');
    const cleanupKeys = [`${prefix}keep-me.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}keep-me.txt`, 'keep me');

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'keep-me.txt').click();
      await expect(page.getByLabel('Select keep-me.txt')).toBeChecked();

      // Delete on the (only) tab in the tab bar must not reach the file shortcuts
      await page.getByRole('tab').first().focus();
      await page.keyboard.press('Delete');

      await expect(page.getByText('This action cannot be undone.')).not.toBeVisible();
      await expect(page.getByLabel('Select keep-me.txt')).toBeChecked();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('Enter on the focused Cancel button cancels the delete', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'kb-delete-cancel');
    const cleanupKeys = [`${prefix}keep-me.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}keep-me.txt`, 'keep me');

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'keep-me.txt').click();
      await page.keyboard.press('Delete');
      await expect(page.getByText('This action cannot be undone.')).toBeVisible();

      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).focus();
      await page.keyboard.press('Enter');

      await expect(page.getByText('This action cannot be undone.')).not.toBeVisible();
      await expect(rowByName(page, 'keep-me.txt')).toBeVisible();
      expect(await objectExists(client, credentials.bucket, `${prefix}keep-me.txt`)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('deleting a folder closes the tabs that showed it', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'delete-open-folder');
    const cleanupKeys = [`${prefix}archive/2025/part-1.csv`];

    try {
      await putTextObject(client, credentials.bucket, cleanupKeys[0], 'part\n1\n', 'text/csv');
      await connectAndOpenPrefix(page, credentials, prefix);

      // A second tab shows the folder that is deleted from the first one.
      const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
      await page.getByRole('button', { name: 'New Tab' }).click();
      await rowByName(page, 'archive').click();
      await rowByName(page, '2025').click();
      await expect(rowByName(page, 'part-1.csv')).toBeVisible();
      await expect(tablist.getByRole('tab', { name: '2025' })).toBeVisible();
      await tablist.getByRole('tab').first().click();
      await expect(rowByName(page, 'archive')).toBeVisible();

      await page.getByRole('button', { name: 'Actions for archive', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();

      await expect(rowByName(page, 'archive')).toHaveCount(0);
      await expect(tablist.getByRole('tab')).toHaveCount(1);
      await expect(tablist.getByRole('tab', { name: '2025' })).toHaveCount(0);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
