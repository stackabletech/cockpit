import { test, expect } from '@playwright/test';
import { clearAllSavedConnections } from './storage/helpers.js';

declare const process: {
  env: Record<string, string | undefined>;
};

/**
 * Live S3 integration tests against a real Garage instance.
 *
 * These tests only run when s3-config.json exists in the project root —
 * written by the "Start Garage S3 and initialize bucket" CI step. They are
 * automatically skipped in all other environments.
 *
 * The global setup (global-setup.ts) reads s3-config.json and exposes its
 * values as S3_TEST_* environment variables.
 */
test.describe('Storage S3 (Garage)', () => {
  test.use({ locale: 'en-US' });

  async function openConnectForm(page: import('@playwright/test').Page) {
    await clearAllSavedConnections(page);
  }

  test('connects to Garage S3 bucket and lists buckets', async ({ page }) => {
    test.skip(
      !process.env.S3_TEST_ENDPOINT,
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );

    const endpoint = process.env.S3_TEST_ENDPOINT!;
    const region = process.env.S3_TEST_REGION!;
    const accessKeyId = process.env.S3_TEST_ACCESS_KEY_ID!;
    const secretAccessKey = process.env.S3_TEST_SECRET_ACCESS_KEY!;
    const bucket = process.env.S3_TEST_BUCKET!;

    await openConnectForm(page);

    // Fill in the connection form
    await page.getByLabel('Endpoint URL').fill(endpoint);
    await page.getByLabel('Region').fill(region);
    await page.getByLabel('Access key ID').fill(accessKeyId);
    await page.getByLabel('Secret access key').fill(secretAccessKey);

    // Path-style addressing is on by default (required for Garage) — verify it is checked
    await expect(page.getByLabel('Use path-style addressing')).toBeChecked();

    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    // After a successful connection the app redirects to /storage and shows the bucket list
    await expect(page).toHaveURL('/storage');
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Buckets' })).toBeVisible();

    // The bucket created during Garage setup must appear in the list
    await expect(main.getByRole('link', { name: bucket, exact: true })).toBeVisible();
  });

  test('disconnects from Garage S3', async ({ page }) => {
    test.skip(
      !process.env.S3_TEST_ENDPOINT,
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );

    const endpoint = process.env.S3_TEST_ENDPOINT!;
    const region = process.env.S3_TEST_REGION!;
    const accessKeyId = process.env.S3_TEST_ACCESS_KEY_ID!;
    const secretAccessKey = process.env.S3_TEST_SECRET_ACCESS_KEY!;

    // First connect
    await openConnectForm(page);
    await page.getByLabel('Endpoint URL').fill(endpoint);
    await page.getByLabel('Region').fill(region);
    await page.getByLabel('Access key ID').fill(accessKeyId);
    await page.getByLabel('Secret access key').fill(secretAccessKey);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();

    // Then disconnect
    await page.getByRole('button', { name: 'Disconnect' }).click();

    // Should return to the connect form
    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
  });
});
