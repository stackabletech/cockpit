import { test, expect } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import { connectAndOpenPrefix } from './helpers.js';

test.describe('Storage S3 — Tooltips', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('hovering over a sidebar bucket name shows a tooltip', async ({ page }, _testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);

    await connectAndOpenPrefix(page, credentials, '');

    // Find the sidebar bucket link for the configured bucket
    const bucketLink = page.locator('nav a').filter({ hasText: credentials.bucket }).first();
    await expect(bucketLink).toBeVisible();

    // Hover over the bucket link to trigger onmouseenter → showTooltip
    await bucketLink.hover();

    // Verify a tooltip element appears with the bucket name
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(credentials.bucket);
  });
});
