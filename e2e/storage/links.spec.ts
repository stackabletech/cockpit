import { test, expect } from '../support/fixtures.js';
import { hasGarageCredentials, requireGarageCredentials } from '../support/garage.js';
import { connectAndOpenPrefix, uniquePrefix } from './helpers.js';

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
});
