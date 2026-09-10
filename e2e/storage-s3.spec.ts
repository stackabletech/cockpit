import { test, expect } from '@playwright/test';
import { waitForHydration } from './support/helpers';

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
    await page.goto('/storage');
    await waitForHydration(page);

    const disconnectButton = page.getByRole('button', { name: 'Disconnect' });
    if (await disconnectButton.isVisible().catch(() => false)) {
      await disconnectButton.click();
      await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
    }

    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();

    // Clear all saved connections so tests start from a clean state.
    const savedList = page.getByRole('list', { name: 'Saved connections' });
    while (await savedList.isVisible().catch(() => false)) {
      const items = savedList.getByRole('listitem');
      if ((await items.count()) === 0) break;
      if (
        await items
          .first()
          .filter({ hasText: 'No saved connections yet' })
          .isVisible()
          .catch(() => false)
      )
        break;
      await items.first().getByRole('button').last().click({ force: true });
      const deleteMenuItem = page.getByRole('menuitem', { name: 'Delete', exact: true });
      if (await deleteMenuItem.isVisible().catch(() => false)) {
        await deleteMenuItem.click();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
      }
      await waitForHydration(page);
    }
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

    // Fill in the connection form — parse URL into host/port
    const url = new URL(endpoint);
    await page.getByLabel('Host').fill(url.hostname);
    if (url.port) await page.getByLabel('Port').fill(url.port);
    const tlsToggle = page.getByLabel('Use TLS');
    if (url.protocol !== 'https:' && (await tlsToggle.isChecked())) await tlsToggle.uncheck();
    await page.getByLabel('Access style').selectOption('Path');
    await page.getByLabel('Region').fill(region);
    await page.getByLabel('Access key').fill(accessKeyId);
    await page.getByLabel('Secret key').fill(secretAccessKey);

    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    // After a successful connection the app redirects to /storage and shows the bucket list
    await expect(page).toHaveURL('/storage');
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Buckets' })).toBeVisible();

    // The bucket created during Garage setup must appear in the grid
    // (use .first() because the sidebar nav also renders a link to each bucket)
    await expect(main.getByRole('link', { name: bucket, exact: true }).first()).toBeVisible();
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
    const url2 = new URL(endpoint);
    await page.getByLabel('Host').fill(url2.hostname);
    if (url2.port) await page.getByLabel('Port').fill(url2.port);
    const tlsToggle2 = page.getByLabel('Use TLS');
    if (url2.protocol !== 'https:' && (await tlsToggle2.isChecked())) await tlsToggle2.uncheck();
    await page.getByLabel('Access style').selectOption('Path');
    await page.getByLabel('Region').fill(region);
    await page.getByLabel('Access key').fill(accessKeyId);
    await page.getByLabel('Secret key').fill(secretAccessKey);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();

    // Then disconnect — clicking Disconnect opens a confirmation modal.
    await page.getByRole('button', { name: 'Disconnect' }).click();
    // Disconnect now shows a confirmation modal; confirm it
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();

    // Should return to the connect form
    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
  });
});
