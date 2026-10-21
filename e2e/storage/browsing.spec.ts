import { test, expect } from '../support/fixtures.js';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  connectAndOpenPrefix,
  deleteKnownKeys,
  putDirectoryMarker,
  putTextObject,
  rowByName,
  uniquePrefix,
  waitForObjectsLoaded
} from './helpers.js';

test.describe('Storage S3 — Browsing', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('browses nested folders, uses breadcrumbs, and shows empty folders', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'browse');
    const cleanupKeys = [
      `${prefix}notes.txt`,
      `${prefix}reports/2026/q1.csv`,
      `${prefix}reports/2026/q2.csv`,
      `${prefix}empty-folder/`
    ];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}notes.txt`, 'root note');
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}reports/2026/q1.csv`,
        'quarter,revenue\n1,100\n',
        'text/csv'
      );
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}reports/2026/q2.csv`,
        'quarter,revenue\n2,200\n',
        'text/csv'
      );
      await putDirectoryMarker(client, credentials.bucket, `${prefix}empty-folder/`);

      await connectAndOpenPrefix(page, credentials, prefix);

      await expect(rowByName(page, 'notes.txt')).toBeVisible();
      await expect(rowByName(page, 'reports')).toBeVisible();
      await expect(rowByName(page, 'empty-folder')).toBeVisible();

      await rowByName(page, 'reports').click();
      await expect(rowByName(page, '2026')).toBeVisible();

      await rowByName(page, '2026').click();
      await expect(rowByName(page, 'q1.csv')).toBeVisible();
      await expect(rowByName(page, 'q2.csv')).toBeVisible();

      await page.getByRole('button', { name: 'reports' }).click();
      await expect(rowByName(page, '2026')).toBeVisible();
      await expect(rowByName(page, 'q1.csv')).not.toBeVisible();

      await rowByName(page, '...').click();
      await expect(rowByName(page, 'empty-folder')).toBeVisible();

      await rowByName(page, 'empty-folder').click();
      await expect(page.getByText('This folder is empty')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('double-clicking a folder or ".." moves exactly one level', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dblclick');
    const cleanupKeys = [`${prefix}outer/inner/deep.txt`];

    try {
      await putTextObject(client, credentials.bucket, cleanupKeys[0], 'deep');
      await connectAndOpenPrefix(page, credentials, prefix);
      const prefixUrl = page.url();
      const prefixPath = new URL(prefixUrl).pathname;

      // Split the double-click so its second click deterministically lands on
      // the "inner" row that replaces "outer" under the pointer
      const box = await rowByName(page, 'outer').boundingBox();
      if (!box) throw new Error('"outer" row has no bounding box');
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.click(x, y);
      await expect(page).not.toHaveURL(prefixUrl);
      await waitForObjectsLoaded(page);
      const outerUrl = page.url();
      // Only the second press: `mouse.click({ clickCount: 2 })` would press twice
      await page.mouse.down({ clickCount: 2 });
      await page.mouse.up({ clickCount: 2 });
      await expect(page.getByTestId('storage-object-list-loading')).toBeHidden();
      await expect(page).toHaveURL(outerUrl);
      await expect(rowByName(page, 'inner')).toBeVisible();
      await expect(rowByName(page, 'inner')).not.toHaveClass(/bg-primary/);

      // The ".." row stays in place, so both clicks hit it
      await rowByName(page, '...').dblclick();
      await expect(page).toHaveURL((url) => url.pathname === prefixPath);
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, 'outer')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('paginates bucket listings', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'paginate');
    const cleanupKeys: string[] = [];

    try {
      for (let index = 1; index <= 30; index += 1) {
        const fileName = `file-${String(index).padStart(2, '0')}.txt`;
        const key = `${prefix}${fileName}`;
        cleanupKeys.push(key);
        await putTextObject(client, credentials.bucket, key, `content ${index}`);
      }

      await connectAndOpenPrefix(page, credentials, prefix);

      await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
      await expect(rowByName(page, 'file-01.txt')).toBeVisible();
      await expect(rowByName(page, 'file-26.txt')).not.toBeVisible();

      await page.getByRole('button', { name: 'Next page' }).click();
      await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
      await expect(rowByName(page, 'file-26.txt')).toBeVisible();
      await expect(rowByName(page, 'file-01.txt')).not.toBeVisible();

      await page.getByRole('button', { name: 'Previous page' }).click();
      await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
      await expect(rowByName(page, 'file-01.txt')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('keeps page number and Prev/Next in sync with browser Back/Forward', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'paginate-history');
    // Default page size is 25, so 55 objects give three pages.
    const cleanupKeys = Array.from(
      { length: 55 },
      (_, index) => `${prefix}file-${String(index + 1).padStart(2, '0')}.txt`
    );

    const expectPage = async (pageNumber: number, visible: string, hidden: string[]) => {
      await expect(page.getByText(`Page ${pageNumber}`, { exact: true })).toBeVisible();
      await expect(rowByName(page, visible)).toBeVisible();
      for (const name of hidden) await expect(rowByName(page, name)).not.toBeVisible();
    };
    const page1 = () => expectPage(1, 'file-01.txt', ['file-26.txt', 'file-51.txt']);
    const page2 = () => expectPage(2, 'file-26.txt', ['file-01.txt', 'file-51.txt']);
    const page3 = () => expectPage(3, 'file-51.txt', ['file-01.txt', 'file-26.txt']);

    try {
      await Promise.all(
        cleanupKeys.map((key) => putTextObject(client, credentials.bucket, key, key))
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      await page1();

      await page.getByRole('button', { name: 'Next page' }).click();
      await page2();
      await page.getByRole('button', { name: 'Next page' }).click();
      await page3();

      await page.goBack();
      await page2();
      await page.goBack();
      await page1();
      await page.goForward();
      await page2();

      await page.getByRole('button', { name: 'Previous page' }).click();
      await page1();
      await page.getByRole('button', { name: 'Next page' }).click();
      await page2();
      await page.getByRole('button', { name: 'Next page' }).click();
      await page3();
      await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('refresh button reloads the file listing', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'refresh');
    const initialKey = `${prefix}initial.txt`;
    const addedKey = `${prefix}added-later.txt`;

    try {
      await putTextObject(client, credentials.bucket, initialKey, 'initial content');

      await connectAndOpenPrefix(page, credentials, prefix);

      // Only the initial file should be visible.
      await expect(rowByName(page, 'initial.txt')).toBeVisible();
      await expect(rowByName(page, 'added-later.txt')).not.toBeVisible();

      // Upload a second file directly via S3, bypassing the UI.
      await putTextObject(client, credentials.bucket, addedKey, 'added later');

      // The newly added file should not appear yet — the listing is stale.
      await expect(rowByName(page, 'added-later.txt')).not.toBeVisible();

      // Click the refresh button in the toolbar.
      await page.getByRole('button', { name: 'Refresh' }).click();

      // After refresh the newly added file should now be visible.
      await expect(rowByName(page, 'added-later.txt')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [initialKey, addedKey]);
    }
  });

  test('changes the page size and shows more items per page', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'page-size');
    const cleanupKeys: string[] = [];

    try {
      for (let index = 1; index <= 30; index += 1) {
        const key = `${prefix}item-${String(index).padStart(2, '0')}.txt`;
        cleanupKeys.push(key);
        await putTextObject(client, credentials.bucket, key, `item ${index}`);
      }

      await connectAndOpenPrefix(page, credentials, prefix);

      await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
      await expect(rowByName(page, 'item-01.txt')).toBeVisible();
      await expect(rowByName(page, 'item-26.txt')).not.toBeVisible();

      await page.getByLabel('Items per page').selectOption('50');

      await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
      await expect(rowByName(page, 'item-01.txt')).toBeVisible();
      await expect(rowByName(page, 'item-26.txt')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
