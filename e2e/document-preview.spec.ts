/**
 * E2E tests for the document (file) preview feature in the S3 file browser.
 *
 * These tests use the mock S3 server (start-mock-s3.ts) which listens on
 * port 9191 and serves a set of fixture objects in the "test-bucket" bucket.
 *
 * Test flow per test:
 *   1. Navigate to /storage and fill-in + submit the connect form to
 *      establish a server-side session pointing at the mock S3.
 *   2. Navigate to the test-bucket listing.
 *   3. Click "Preview" on a file object.
 *   4. Assert the preview modal contents.
 */

import { test, expect, type Page } from '@playwright/test';
import { waitForHydration } from './helpers';

const MOCK_S3_ENDPOINT = 'http://localhost:9191';
const BUCKET = 'test-bucket';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Connect to the mock S3 server by submitting the connect form on /storage. */
async function connectToMockS3(page: Page) {
  await page.goto('/storage');
  await waitForHydration(page);

  // Ensure the connect form is visible (not already connected)
  const typeSelect = page.getByLabel('Backend type');
  if (!(await typeSelect.isVisible())) {
    // Already connected — disconnect first so we can re-connect with the right endpoint
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.waitForURL('**/storage');
    await waitForHydration(page);
  }

  await typeSelect.selectOption('s3');
  await page.getByLabel('Endpoint URL').fill(MOCK_S3_ENDPOINT);
  await page.getByLabel('Region').fill('us-east-1');
  await page.getByLabel('Access key ID').fill('test-access-key');
  await page.getByLabel('Secret access key').fill('test-secret-key');
  await page.getByRole('button', { name: 'Connect' }).click();

  // After successful connect, the page redirects back to /storage and shows the bucket grid
  await page.waitForURL('**/storage');
  await expect(page.getByText(BUCKET).first()).toBeVisible();
}

/** Navigate to the test-bucket listing and return when files are visible. */
async function navigateToBucket(page: Page) {
  await page.goto(`/storage/${BUCKET}`);
  await waitForHydration(page);
  // Wait for the file table to be rendered
  await expect(page.getByRole('table')).toBeVisible();
}

/** Click the Preview action for a given filename (single-click to select, then toolbar button). */
async function clickPreview(page: Page, filename: string) {
  // Click the file row to select it
  await page.getByRole('row', { name: new RegExp(filename, 'i') }).click();
  // Click the Preview button in the selection toolbar
  await page.getByRole('button', { name: 'Preview' }).first().click();
}

/** Click the Preview action from the context menu for a given filename. */
async function rightClickPreview(page: Page, filename: string) {
  await page.getByRole('row', { name: new RegExp(filename, 'i') }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Preview' }).click();
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('Document preview', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    await connectToMockS3(page);
    await navigateToBucket(page);
  });

  test('preview modal opens for a text file and shows content', async ({ page }) => {
    await clickPreview(page, 'hello.txt');

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();

    // Header shows filename
    await expect(dialog.getByRole('heading', { name: 'hello.txt' })).toBeVisible();

    // Content is rendered as text
    await expect(dialog.locator('pre')).toContainText('Hello, World!');

    // Close button works
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(dialog).not.toBeVisible();
  });

  test('preview modal shows JSON with pretty-printing', async ({ page }) => {
    await clickPreview(page, 'data.json');

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('heading', { name: 'data.json' })).toBeVisible();
    // JSON is pretty-printed
    await expect(dialog.locator('pre')).toContainText('"name"');
    await expect(dialog.locator('pre')).toContainText('"Alice"');
  });

  test('preview modal renders CSV as a table', async ({ page }) => {
    await clickPreview(page, 'data.csv');

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('heading', { name: 'data.csv' })).toBeVisible();

    // CSV header row
    const table = dialog.getByRole('table', { name: 'CSV preview' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'id' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'name' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'role' })).toBeVisible();

    // Data rows
    await expect(table.getByRole('cell', { name: 'Alice' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Bob' })).toBeVisible();
  });

  test('preview modal renders image inline', async ({ page }) => {
    await clickPreview(page, 'image.png');

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('heading', { name: 'image.png' })).toBeVisible();

    // Image is rendered
    const img = dialog.locator('img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', /Preview of image\.png/i);
  });

  test('preview modal shows fallback for unsupported binary type', async ({ page }) => {
    await clickPreview(page, 'archive.bin');

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('heading', { name: 'archive.bin' })).toBeVisible();
    // Binary fallback message
    await expect(dialog.getByText('Binary content')).toBeVisible();

    // Download link present
    const downloadLink = dialog.getByRole('link', { name: 'Download full file' });
    await expect(downloadLink).toBeVisible();
  });

  test('large text file shows truncation notice', async ({ page }) => {
    await clickPreview(page, 'large.txt');

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('heading', { name: 'large.txt' })).toBeVisible();

    // Truncation notice in the subtitle
    await expect(dialog.getByText(/Content truncated/i)).toBeVisible();

    // Download full file button visible in footer
    const downloadLink = dialog.getByRole('link', { name: 'Download full file' });
    await expect(downloadLink).toBeVisible();
  });

  test('preview via context menu works', async ({ page }) => {
    await rightClickPreview(page, 'hello.txt');

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'hello.txt' })).toBeVisible();
    await expect(dialog.locator('pre')).toContainText('Hello, World!');
  });

  test('preview modal shows error for access-denied object', async ({ page }) => {
    // Intercept the preview API to simulate a 403 response
    await page.route('**/storage/api/preview**', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Access denied' })
      });
    });

    await clickPreview(page, 'hello.txt');

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'hello.txt' })).toBeVisible();
    // Error state is shown
    await expect(dialog.getByText('Preview failed')).toBeVisible();
    await expect(
      dialog.getByText('You do not have permission to preview this file.')
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(dialog).not.toBeVisible();
  });

  test('preview API returns 401 when not connected', async ({ page }) => {
    // Disconnect the S3 connection via the browser UI
    await page.goto('/storage');
    await waitForHydration(page);
    const disconnectBtn = page.getByRole('button', { name: 'Disconnect' });
    if (await disconnectBtn.isVisible()) {
      await disconnectBtn.click();
      await page.waitForURL('**/storage');
    }

    // Use the page's authenticated session (fetch runs in the browser context
    // with the session cookie) — the storage layer should return 401 when there
    // is no S3 connection configured for this user.
    const status = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return res.status;
    }, `/storage/api/preview?bucket=${BUCKET}&key=hello.txt`);
    expect(status).toBe(401);
  });

  test('preview button is enabled for a single selected file', async ({ page }) => {
    // Select one file — the Preview button in the toolbar becomes enabled
    await page.getByRole('row', { name: /hello\.txt/i }).click();
    const previewBtn = page.getByRole('button', { name: 'Preview' }).first();
    await expect(previewBtn).toBeEnabled();
    await expect(previewBtn).toBeVisible();
  });

  test('preview modal renders parquet file as a table', async ({ page }) => {
    await clickPreview(page, 'data.parquet');

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('heading', { name: 'data.parquet' })).toBeVisible();

    // Parquet is rendered as a CSV-style table
    const table = dialog.getByRole('table', { name: 'CSV preview' });
    await expect(table).toBeVisible();

    // Column headers from the parquet schema
    await expect(table.getByRole('columnheader', { name: 'id' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'name' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'role' })).toBeVisible();

    // Data rows
    await expect(table.getByRole('cell', { name: 'Alice' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Bob' })).toBeVisible();

    // File size is shown in the header subtitle
    await expect(dialog.locator('p').filter({ hasText: /B/ })).toBeVisible();
  });
});
