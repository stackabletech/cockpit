import { test, expect } from '../support/fixtures.js';
import { hasGarageCredentials, requireGarageCredentials } from '../support/garage.js';
import { bucketRoute, connectAndOpenPrefix, uniquePrefix } from './helpers.js';

test.describe('Storage S3 — Links', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
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
