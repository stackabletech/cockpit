import { test, expect } from '../support/fixtures.js';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import { connectAndOpenPrefix, deleteKnownKeys, putTextObject, uniquePrefix } from './helpers.js';

test.describe('Storage S3 — Pinned locations', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('unpins a pinned location with its sidebar button', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'unpin');
    const cleanupKeys = [`${prefix}file.txt`];

    try {
      await putTextObject(client, credentials.bucket, cleanupKeys[0], 'x');
      await connectAndOpenPrefix(page, credentials, prefix);

      const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
      await breadcrumb.getByText(credentials.bucket).hover();
      await page
        .getByRole('button', { name: 'Pin this location' })
        .filter({ visible: true })
        .first()
        .click();
      const sidebar = page.getByRole('navigation', { name: 'Buckets' });
      await expect(sidebar.getByText('Pinned Access')).toBeVisible();

      await sidebar.getByRole('button', { name: `Unpin ${credentials.bucket}` }).click({
        force: true
      });

      await expect(sidebar.getByText('Pinned Access')).toHaveCount(0);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
