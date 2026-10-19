import { test, expect } from '../support/fixtures.js';
import {
  createGarageBucketCredentials,
  hasGarageAdmin,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import { connectToStorage } from './helpers.js';

test.describe('Storage S3 — Bucket order', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials() || !hasGarageAdmin(),
      'Skipped: requires a running Garage instance with admin access'
    );
  });

  test('lists buckets alphabetically in the sidebar and the overview', async ({
    page
  }, testInfo) => {
    const base = requireGarageCredentials();
    const suffix = `${testInfo.project.name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
    const keyName = `bucket-order-${suffix}`;
    // Created out of order; Garage does not list buckets in a fixed order.
    const buckets = ['order-zulu', 'order-alpha', 'order-mike'].map((name) => `${name}-${suffix}`);
    let credentials = base;
    for (const bucketName of buckets) {
      credentials = await createGarageBucketCredentials(base, {
        bucketName,
        keyName,
        permissions: { owner: false, read: true, write: false }
      });
    }

    await connectToStorage(page, credentials);

    const sorted = [...buckets].sort();
    const listed = async () =>
      (await page.getByRole('link').allTextContents())
        .map((text) => text.trim())
        .filter((text) => buckets.includes(text));
    // The sidebar comes first in the page, then the overview grid.
    await expect.poll(listed).toEqual([...sorted, ...sorted]);
  });
});
