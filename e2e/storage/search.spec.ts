import { test, expect } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  bucketRoute,
  connectAndOpenPrefix,
  connectToStorage,
  deleteKnownKeys,
  putDirectoryMarker,
  putTextObject,
  uniquePrefix
} from './helpers.js';

test.describe('Storage Search', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('searches the current bucket, runs parallel sessions, and opens matching results', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'search');
    const directory = `${prefix}reports/`;
    const file = `${directory}final-report.txt`;

    try {
      await putDirectoryMarker(client, credentials.bucket, directory);
      await putTextObject(client, credentials.bucket, file, 'search preview');
      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Open search' }).click();
      await page.getByLabel('Search query').fill('report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();

      await expect(page.getByText(/2 results/)).toBeVisible();
      await page.getByRole('button', { name: /reports.*\/reports\// }).click();
      await expect(page).toHaveURL(bucketRoute(credentials.bucket, directory));

      await page.getByRole('button', { name: 'Open search' }).click();
      await page.getByRole('button', { name: 'Parallel search' }).click();
      await expect(page.getByRole('navigation', { name: 'Search sessions' })).toBeVisible();
      await page.getByLabel('Search query').fill('final-report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page
        .getByRole('button', { name: /final-report\.txt.*\/reports\/final-report\.txt/ })
        .click();
      const previewDialog = page.getByRole('dialog').filter({ hasText: 'final-report.txt' });
      await expect(previewDialog).toContainText('final-report.txt');
      await previewDialog.getByLabel('Close', { exact: true }).click();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [directory, file]);
    }
  });

  test('searches all buckets from the landing page', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'landing-search');
    const file = `${prefix}landing-report.txt`;

    try {
      await putTextObject(client, credentials.bucket, file, 'landing search');
      await connectToStorage(page, credentials);

      await page.getByRole('button', { name: 'Open search' }).click();
      await page.getByLabel('Search query').fill('landing-report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();

      await expect(page.getByRole('button', { name: 'landing-report.txt' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [file]);
    }
  });

  test('filters and selects buckets via the bucket dropdown', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'bucket-scope');
    const file = `${prefix}scoped-report.txt`;

    try {
      await putTextObject(client, credentials.bucket, file, 'scoped search');
      await connectToStorage(page, credentials);

      await page.getByRole('button', { name: 'Open search' }).click();

      const trigger = page.getByRole('button', { name: 'all buckets', exact: true });
      await expect(trigger).toBeVisible();
      await trigger.click();

      await page.getByLabel('Filter buckets').fill(credentials.bucket);
      await page
        .getByRole('button', { name: `Include ${credentials.bucket} in search`, exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: credentials.bucket, exact: true })
      ).toBeVisible();

      await page.getByLabel('Search query').fill('scoped-report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('button', { name: 'scoped-report.txt' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [file]);
    }
  });
});
