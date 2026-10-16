import { test, expect } from '../support/fixtures.js';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  connectAndOpenPrefix,
  deleteKnownKeys,
  objectExists,
  putDirectoryMarker,
  uniquePrefix
} from './helpers.js';

test.describe('Storage S3 — Create via context menu', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('creates a text file via empty-space right-click context menu', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'create-file');
    const newFile = `${prefix}hello.txt`;
    const cleanupKeys = [newFile];

    try {
      await connectAndOpenPrefix(page, credentials, prefix);

      // Right-click on the empty-state row to trigger the empty-space context menu
      await page.getByText('This folder is empty').click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();

      await page.getByRole('menuitem', { name: 'New text file' }).click();

      // The create modal appears with the name pre-filled
      const input = page.locator('.modal-box input');
      await expect(input).toBeVisible();
      await input.fill('hello.txt');

      await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();

      await expect.poll(() => objectExists(client, credentials.bucket, newFile)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('creates a folder via empty-space right-click context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'create-folder');
    const newFolder = `${prefix}my-folder/`;
    const cleanupKeys = [newFolder];

    try {
      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByText('This folder is empty').click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();

      await page.getByRole('menuitem', { name: 'New directory' }).click();

      const input = page.locator('.modal-box input');
      await expect(input).toBeVisible();
      await input.fill('my-folder');

      await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();

      await expect.poll(() => objectExists(client, credentials.bucket, newFolder)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('explains an invalid name at the input', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const prefix = uniquePrefix(testInfo, 'create-invalid');

    await connectAndOpenPrefix(page, credentials, prefix);

    await page.getByText('This folder is empty').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New text file' }).click();

    const dialog = page.getByRole('dialog');
    const input = dialog.getByLabel('Name');
    await input.fill('x?y.txt');
    await input.press('Enter');

    const message = dialog.locator('.modal-box p[aria-live="polite"]');
    await expect(message).toContainText('without the characters < > \\ | ? "');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAttribute('aria-describedby', (await message.getAttribute('id'))!);
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();

    await input.fill('..');
    await expect(message).toContainText('".."');

    await input.fill('notes//ok.txt');
    await expect(message).toContainText('Remove the extra "/"');
    await expect(input).toHaveAttribute('aria-invalid', 'true');

    await input.fill('ok.txt');
    await expect(message).toBeEmpty();
    await expect(input).not.toHaveAttribute('aria-invalid');
  });

  test('creates a folder inside a folder whose name has characters S3 allows', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = `${uniquePrefix(testInfo, 'create-odd-parent')}reports?2024/`;
    const newFolder = `${prefix}q3/`;
    const cleanupKeys = [prefix, newFolder];

    try {
      await putDirectoryMarker(client, credentials.bucket, prefix);
      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByText('This folder is empty').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'New directory' }).click();

      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Name').fill('q3');
      await dialog.getByRole('button', { name: 'Create' }).click();

      await expect.poll(() => objectExists(client, credentials.bucket, newFolder)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
