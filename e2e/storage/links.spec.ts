import { test, expect } from '../support/fixtures.js';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  bucketRoute,
  connectAndOpenPrefix,
  deleteKnownKeys,
  putTextObject,
  rowByName,
  uniquePrefix,
  waitForObjectsLoaded
} from './helpers.js';

test.describe('Storage S3 — Links', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('a link with an encoded slash opens the folder it names', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'encoded-slash');
    const key = `${prefix}sales/2026/july.csv`;

    try {
      await putTextObject(client, credentials.bucket, key, 'month\n7\n', 'text/csv');
      await connectAndOpenPrefix(page, credentials, prefix);

      const connection = new URL(credentials.endpoint).hostname;
      const route = bucketRoute(connection, credentials.bucket, prefix);
      await page.goto(`${route}/sales%2F2026`);
      await waitForObjectsLoaded(page);

      await expect(rowByName(page, 'july.csv')).toBeVisible();
      const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect(breadcrumb).toContainText('sales');
      await expect(breadcrumb).toContainText('2026');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, [key]);
    }
  });

  test('a link to a folder that does not exist calls it an empty folder', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const prefix = uniquePrefix(testInfo, 'missing-folder');

    await connectAndOpenPrefix(page, credentials, `${prefix}no/such/folder/`);

    await expect(page.getByText('This folder is empty')).toBeVisible();
    await expect(page.getByText('This bucket is empty')).toHaveCount(0);
  });

  test('a link to a storage that is not connected says so', async ({ page }) => {
    const credentials = requireGarageCredentials();
    await connectAndOpenPrefix(page, credentials);

    const response = await page.goto(bucketRoute('other-storage.example', credentials.bucket));

    expect(response?.status()).toBe(404);
    await expect(
      page.getByText('You are not connected to the storage “other-storage.example”.', {
        exact: false
      })
    ).toBeVisible();
    await expect(page.getByText('Internal Error')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to storage' })).toBeVisible();
  });
});
