import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
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

test.describe('Storage S3 — Download', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('downloads a file via the selection toolbar', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dl-toolbar');
    const cleanupKeys = [`${prefix}download-me.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}download-me.txt`,
        'download content'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select download-me.txt').check();

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download', exact: true }).click()
      ]);

      expect(download.suggestedFilename()).toBe('download-me.txt');
      expect(await download.failure()).toBeNull();
      expect(await readFile((await download.path())!, 'utf8')).toBe('download content');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('downloads a file via the context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dl-ctx');
    const cleanupKeys = [`${prefix}ctx-download.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}ctx-download.txt`,
        'ctx download content'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'ctx-download.txt').click({ button: 'right' });

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('menuitem', { name: 'Download' }).click()
      ]);

      expect(download.suggestedFilename()).toBe('ctx-download.txt');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('downloads up to three selected files individually', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dl-multiple');
    const cleanupKeys = ['one.txt', 'two.txt', 'three.txt'].map((name) => `${prefix}${name}`);

    try {
      await Promise.all(
        cleanupKeys.map((key) => putTextObject(client, credentials.bucket, key, key))
      );
      await connectAndOpenPrefix(page, credentials, prefix);
      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      for (const name of ['one.txt', 'two.txt', 'three.txt']) {
        await page.getByLabel(`Select ${name}`).check();
      }

      const downloads: string[] = [];
      page.on('download', (download) => downloads.push(download.suggestedFilename()));
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await expect.poll(() => downloads.sort()).toEqual(['one.txt', 'three.txt', 'two.txt']);
      expect(downloads.sort()).toEqual(['one.txt', 'three.txt', 'two.txt']);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('archives a selection larger than three files', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dl-archive');
    const cleanupKeys = ['one.txt', 'two.txt', 'three.txt', 'four.txt'].map(
      (name) => `${prefix}${name}`
    );

    try {
      await Promise.all(
        cleanupKeys.map((key) => putTextObject(client, credentials.bucket, key, key))
      );
      await connectAndOpenPrefix(page, credentials, prefix);
      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      for (const name of ['one.txt', 'two.txt', 'three.txt', 'four.txt']) {
        await page.getByLabel(`Select ${name}`).check();
      }

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download', exact: true }).click()
      ]);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
      expect(await download.failure()).toBeNull();
      const zip = new AdmZip(await readFile((await download.path())!));
      expect(
        zip
          .getEntries()
          .map((entry) => entry.entryName)
          .sort()
      ).toEqual([...cleanupKeys].sort());
      for (const key of cleanupKeys) expect(zip.readAsText(key)).toBe(key);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const operations = JSON.parse(
              localStorage.getItem('storage_operations_history') ?? '[]'
            ) as Array<{ type: string; status: string; sourceNames: string[] }>;
            return operations
              .filter(
                (operation) =>
                  operation.type === 'download' && operation.sourceNames.includes('four.txt')
              )
              .at(-1)?.status;
          })
        )
        .toBe('done');
      await page.getByRole('button', { name: 'Operations', exact: true }).click();
      const history = page.getByRole('region', { name: 'Download history' });
      await history.getByRole('button').filter({ hasText: credentials.bucket }).first().click();
      const [redownload] = await Promise.all([
        page.waitForEvent('download'),
        history.getByRole('button', { name: 'Download all', exact: true }).first().click()
      ]);
      expect(await redownload.failure()).toBeNull();
      const recreatedZip = new AdmZip(await readFile((await redownload.path())!));
      for (const key of cleanupKeys) expect(recreatedZip.readAsText(key)).toBe(key);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('downloads a folder via its context menu when not in selection mode', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dl-folder');
    const cleanupKeys = [`${prefix}folder1/one.txt`, `${prefix}folder1/two.txt`];

    try {
      await Promise.all(
        cleanupKeys.map((key) => putTextObject(client, credentials.bucket, key, key))
      );
      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'folder1').click({ button: 'right' });

      const downloadBtn = page.getByRole('menuitem', { name: 'Download' });
      await expect(downloadBtn).not.toHaveAttribute('disabled');

      const [download] = await Promise.all([page.waitForEvent('download'), downloadBtn.click()]);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
      expect(await download.failure()).toBeNull();
      const zip = new AdmZip(await readFile((await download.path())!));
      for (const key of cleanupKeys) expect(zip.readAsText(key)).toBe(key);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
