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

  test('searches the current bucket, replays history, and opens matching results', async ({
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
      await expect(page.getByLabel('Bucket', { exact: true })).toHaveValue(credentials.bucket);
      await page.getByLabel('Search query').fill('report');
      await page.getByRole('button', { name: 'Search', exact: true }).click();

      await expect(page.getByText('2 results')).toBeVisible();
      await page.getByRole('button', { name: /reports .*\/reports\/$/ }).click();
      await expect(page).toHaveURL(bucketRoute(credentials.bucket, directory));

      await page.getByRole('button', { name: 'Open search' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: `report ${credentials.bucket}`, exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /final-report\.txt .*\/reports\/final-report\.txt/ })
        .click();
      const previewDialog = page.getByRole('dialog').filter({ hasText: 'final-report.txt' });
      await expect(previewDialog).toContainText('final-report.txt');
      await previewDialog.getByLabel('Close', { exact: true }).click();

      await page.getByRole('button', { name: 'Open search' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: `report ${credentials.bucket}`, exact: true })
        .click();
      await expect(page.getByText('2 results')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [directory, file]);
    }
  });

  test('requires an explicit scope when searching from the landing page', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'landing-search');
    const file = `${prefix}landing-report.txt`;

    try {
      await putTextObject(client, credentials.bucket, file, 'landing search');
      await connectToStorage(page, credentials);

      await page.getByRole('button', { name: 'Open search' }).click();
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
      await page.getByLabel('Search query').fill('landing-report');
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
      await page.getByLabel('Bucket', { exact: true }).selectOption(credentials.bucket);
      await page.getByRole('button', { name: 'Search', exact: true }).click();

      await expect(page.getByRole('button', { name: 'landing-report.txt' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [file]);
    }
  });
});
