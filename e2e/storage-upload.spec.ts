/**
 * E2E tests for the file upload feature in the S3 file browser.
 *
 * These tests use the mock S3 server (start-mock-s3.ts) which listens on
 * port 9191 and serves a set of fixture objects in the "test-bucket" bucket.
 *
 * Test flow:
 *   1. Navigate to /storage and connect to the mock S3 server.
 *   2. Navigate to the test-bucket listing.
 *   3. Exercise the upload UI.
 */

import { test, expect, type Page } from '@playwright/test';
import { waitForHydration } from './helpers';

const MOCK_S3_ENDPOINT = 'http://localhost:9191';
const BUCKET = 'test-bucket';

// ── Helpers ────────────────────────────────────────────────────────────────

async function connectToMockS3(page: Page) {
  await page.goto('/storage');
  await waitForHydration(page);

  const typeSelect = page.getByLabel('Backend type');
  if (!(await typeSelect.isVisible())) {
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

  await page.waitForURL('**/storage');
  await expect(page.getByText(BUCKET).first()).toBeVisible();
}

async function navigateToBucket(page: Page) {
  await page.goto(`/storage/${BUCKET}`);
  await waitForHydration(page);
  await expect(page.getByRole('table')).toBeVisible();
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('File upload', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    await connectToMockS3(page);
    await navigateToBucket(page);
  });

  test('Upload button is visible in the storage toolbar', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Upload' })).toBeVisible();
  });

  test('Upload modal opens when Upload button is clicked', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Upload File')).toBeVisible();
    await expect(page.getByText('Drop a file here, or click to browse')).toBeVisible();
  });

  test('Upload modal can be closed', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('User can select a file and upload it — listing refreshes', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Attach a file via the hidden file input inside the modal
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'new-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Hello upload test')
    });

    // File selected state — Upload button appears
    await expect(dialog.getByText('new-upload.txt')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Upload' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Upload' }).click();

    // Should succeed: success message
    await expect(dialog.getByText('File uploaded successfully.')).toBeVisible({ timeout: 10000 });

    // Close and verify listing refreshed (uploaded file appears in the table)
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('row', { name: /new-upload\.txt/i })).toBeVisible({
      timeout: 5000
    });
  });

  test('Overwrite prompt appears when uploading file with same name as existing fixture', async ({
    page
  }) => {
    await page.getByRole('button', { name: 'Upload' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('overwrite content')
    });
    await dialog.getByRole('button', { name: 'Upload' }).click();

    // Should show overwrite confirmation
    await expect(dialog.getByText('File already exists')).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(/hello\.txt/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Replace' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Rename' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('User can cancel the overwrite prompt', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('overwrite content')
    });
    await dialog.getByRole('button', { name: 'Upload' }).click();
    await expect(dialog.getByText('File already exists')).toBeVisible({ timeout: 5000 });

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    // Modal should close
    await expect(dialog).not.toBeVisible();
  });

  test('User can replace an existing file', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('replaced content')
    });
    await dialog.getByRole('button', { name: 'Upload' }).click();
    await expect(dialog.getByText('File already exists')).toBeVisible({ timeout: 5000 });

    await dialog.getByRole('button', { name: 'Replace' }).click();
    await expect(dialog.getByText('File uploaded successfully.')).toBeVisible({ timeout: 10000 });
  });

  test('User can rename and upload a file', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('renamed upload content')
    });
    await dialog.getByRole('button', { name: 'Upload' }).click();
    await expect(dialog.getByText('File already exists')).toBeVisible({ timeout: 5000 });

    await dialog.getByRole('button', { name: 'Rename' }).click();
    // Rename input should appear with the original name
    const renameInput = dialog.getByLabel('New file name');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue('hello.txt');

    await renameInput.fill('hello-renamed.txt');
    await dialog.getByRole('button', { name: 'Upload with this name' }).click();
    await expect(dialog.getByText('File uploaded successfully.')).toBeVisible({ timeout: 10000 });
  });

  test('Drag-and-drop triggers file selection', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const dropZone = dialog.getByRole('button', { name: 'Drop a file here, or click to browse' });
    await expect(dropZone).toBeVisible();

    // Simulate drag-and-drop using the DataTransfer API
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      const file = new File(['drag drop content'], 'dragged.txt', { type: 'text/plain' });
      dt.items.add(file);
      return dt;
    });

    await dropZone.dispatchEvent('dragover', { dataTransfer });
    await dropZone.dispatchEvent('drop', { dataTransfer });

    // File should be selected
    await expect(dialog.getByText('dragged.txt')).toBeVisible({ timeout: 3000 });
  });
});
