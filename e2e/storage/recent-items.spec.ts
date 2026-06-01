import { test, expect } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import { waitForHydration } from '../support/helpers.js';
import {
  bucketRoute,
  connectAndOpenPrefix,
  connectToStorage,
  deleteKnownKeys,
  putTextObject,
  rowByName,
  uniquePrefix
} from './helpers.js';

test.describe('Storage S3 — Recent Items', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('tracks recently visited locations in the Recent Locations tab', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await page.goto(bucketRoute(credentials.bucket));
    await waitForHydration(page);

    await page.goto('/storage');
    await waitForHydration(page);

    await page.getByRole('tab', { name: 'Recent Locations' }).click();

    await expect(
      page.locator('tbody').getByRole('link', { name: credentials.bucket }).first()
    ).toBeVisible();
  });

  test('tracks recently accessed files in the Recent Files tab', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'recent-files');
    const cleanupKeys = [`${prefix}recent.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}recent.txt`, 'recently accessed');

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'recent.txt').dblclick();
      await expect(page.getByRole('heading', { name: 'recent.txt' })).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).last().click();

      await page.goto('/storage');
      await waitForHydration(page);

      const filesTab = page.getByRole('tab', { name: 'Recent Files' });
      await expect(filesTab).toBeVisible();
      await expect(page.locator('tbody').getByText('recent.txt')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
