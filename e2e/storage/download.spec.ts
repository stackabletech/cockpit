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
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('cancels a running download operation from the operations panel', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dl-cancel');
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

      // Keep the job "running" so there is time to cancel it before it finishes.
      await page.route('**/api/storage/download/jobs/*', async (route) => {
        if (route.request().method() !== 'GET') {
          return route.continue();
        }
        const response = await route.fetch();
        const job = await response.json();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...job, status: 'running', files: [] })
        });
      });

      await page.getByRole('button', { name: 'Download', exact: true }).click();

      await expect(page.getByRole('button', { name: 'Operations' })).toBeVisible();
      await page.getByRole('button', { name: 'Operations' }).click();
      await page.getByRole('button', { name: 'Cancel operation' }).click();

      await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('shows a compressing status while the archive is being compressed', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dl-compress');
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

      // Keep the job "running" and report the compressing phase so the UI
      // replaces the download-speed display with "Compressing…".
      await page.route('**/api/storage/download/jobs/*', async (route) => {
        if (route.request().method() !== 'GET') {
          return route.continue();
        }
        const response = await route.fetch();
        const job = await response.json();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...job,
            status: 'running',
            files: [],
            progress: { ...job.progress, phase: 'compressing' }
          })
        });
      });

      await page.getByRole('button', { name: 'Download', exact: true }).click();

      await expect(page.getByRole('button', { name: 'Operations' })).toBeVisible();
      await page.getByRole('button', { name: 'Operations' }).click();

      await expect(page.getByText('Compressing…')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('shows which files are currently being downloaded in the operations panel', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dl-active');
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

      // Keep the job "running" and report a set of files in flight, mimicking
      // the parallel staging workers of an archive download.
      await page.route('**/api/storage/download/jobs/*', async (route) => {
        if (route.request().method() !== 'GET') {
          return route.continue();
        }
        const response = await route.fetch();
        const job = await response.json();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...job,
            status: 'running',
            files: [],
            progress: { ...job.progress, activeFiles: ['one.txt', 'two.txt'] }
          })
        });
      });

      await page.getByRole('button', { name: 'Download', exact: true }).click();

      await expect(page.getByRole('button', { name: 'Operations' })).toBeVisible();
      await page.getByRole('button', { name: 'Operations' }).click();

      await expect(page.getByText('one.txt, two.txt', { exact: true })).toBeVisible();
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
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
