import { test, expect } from '@playwright/test';
import { hasGarageCredentials, requireGarageCredentials } from '../support/garage.js';
import { connectToStorage } from './helpers.js';
import { waitForHydration } from '../support/helpers.js';

test.describe('Storage S3 — Sidebar', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('shows loading spinner when disconnected and bucket list after connect', async ({
    page
  }) => {
    const credentials = requireGarageCredentials();

    await page.goto('/storage?disconnected=1');
    await waitForHydration(page);

    const sidebar = page.locator('nav[aria-label="Buckets"]');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('.loading-spinner')).toBeVisible();

    await connectToStorage(page, credentials);

    await expect(sidebar.locator('.loading-spinner')).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: credentials.bucket }).first()).toBeVisible();
  });
});
