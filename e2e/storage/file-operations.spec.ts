import { test, expect } from '@playwright/test';
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
  putTextObject,
  rowByName,
  uniquePrefix,
  getObjectText
} from './helpers.js';

test.describe('Storage S3 — File Operations', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Cut + Paste
  // ──────────────────────────────────────────────────────────────────────────

  test('cut via context menu and paste moves file (original deleted)', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'cut-paste');
    const srcKey = `${prefix}source/`;
    const srcFile = `${srcKey}cut-me.txt`;
    const cleanupKeys = [srcFile, `${prefix}cut-me.txt`];

    try {
      await putDirectoryMarker(client, credentials.bucket, srcKey);
      await putTextObject(client, credentials.bucket, srcFile, 'cut paste test');

      await connectAndOpenPrefix(page, credentials, srcKey);

      // Right-click the file and choose Cut
      await rowByName(page, 'cut-me.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Cut' }).click();

      // Navigate to parent prefix in-app (preserves clipboard)
      await page.locator('tbody tr').first().click();
      await page.waitForTimeout(500);

      // Click on table to focus it, then Ctrl+V to paste
      await page.locator('table').click();
      await page.keyboard.press('Control+v');

      await expect(page.getByText('1 item pasted')).toBeVisible();

      // File should exist at dest (moved)
      await expect
        .poll(() => objectExists(client, credentials.bucket, `${prefix}cut-me.txt`))
        .toBe(true);
      // Original should be deleted (cut = move)
      await expect.poll(() => objectExists(client, credentials.bucket, srcFile)).toBe(false);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('pastes to a nested folder via context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'cut-paste-nested');
    const srcFile = `${prefix}nested-src.txt`;
    const destDir = `${prefix}target/`;
    const cleanupKeys = [srcFile, destDir];

    try {
      await putTextObject(client, credentials.bucket, srcFile, 'nested paste');
      await putDirectoryMarker(client, credentials.bucket, destDir);

      await connectAndOpenPrefix(page, credentials, prefix);

      // Copy file
      await rowByName(page, 'nested-src.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();

      // Navigate into dest folder
      await rowByName(page, 'target').dblclick();
      await page.waitForTimeout(500);

      // Paste (use keyboard shortcut — right-click in an empty folder
      // lands on the ".." row which has no context menu handler)
      await page.locator('table').click();
      await page.keyboard.press('Control+v');

      await page.waitForTimeout(1000);

      expect(await objectExists(client, credentials.bucket, `${destDir}nested-src.txt`)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('paste with deleted source shows error toast', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'paste-deleted');
    const srcFile = `${prefix}gone.txt`;
    const cleanupKeys = [srcFile];

    try {
      await putTextObject(client, credentials.bucket, srcFile, 'will be deleted');

      await connectAndOpenPrefix(page, credentials, prefix);

      // Copy the file
      await rowByName(page, 'gone.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();

      // Delete the file via S3 directly (simulate race condition / out-of-band delete)
      await deleteKnownKeys(client, credentials.bucket, [srcFile]);

      // Navigate to bucket root via ".." row (preserves clipboard)
      await page.locator('tbody tr').first().click();
      await page.waitForTimeout(500);

      await page.locator('tbody').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Paste' }).click();

      await page.waitForTimeout(1000);

      // Should show error toast about source not found
      const errorMsg = page.getByText(/could not paste|source.*deleted/i);
      await expect(errorMsg).toBeVisible();

      // The toast also has a Dismiss button
      const toast = page.getByRole('alert').filter({ hasText: /could not paste|source.*deleted/i });
      const dismissBtn = toast.getByRole('button', { name: 'Dismiss' });
      await expect(dismissBtn).toBeVisible();
      await dismissBtn.click();
      await expect(toast).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Copy + Paste (multiple destinations)
  // ──────────────────────────────────────────────────────────────────────────

  test('copy and paste to multiple destinations', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'multi-paste');
    const srcFile = `${prefix}multi.txt`;
    const dest1 = `${prefix}d1/`;
    const dest2 = `${prefix}d2/`;
    const cleanupKeys = [srcFile, dest1, dest2];

    try {
      await putTextObject(client, credentials.bucket, srcFile, 'multi paste');
      await putDirectoryMarker(client, credentials.bucket, dest1);
      await putDirectoryMarker(client, credentials.bucket, dest2);

      await connectAndOpenPrefix(page, credentials, prefix);

      // Copy file
      await rowByName(page, 'multi.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();

      // Navigate into first destination and paste
      await rowByName(page, 'd1').dblclick();
      await page.waitForTimeout(500);
      await page.locator('table').click();
      await page.keyboard.press('Control+v');
      await page.waitForTimeout(1000);

      expect(await objectExists(client, credentials.bucket, `${dest1}multi.txt`)).toBe(true);

      // Navigate back to prefix then into second destination
      await page.locator('tbody tr').first().click();
      await page.waitForTimeout(500);
      await rowByName(page, 'd2').dblclick();
      await page.waitForTimeout(500);
      await page.locator('table').click();
      await page.keyboard.press('Control+v');
      await page.waitForTimeout(1000);

      expect(await objectExists(client, credentials.bucket, `${dest2}multi.txt`)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Rename
  // ──────────────────────────────────────────────────────────────────────────

  test('renames a file via context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'rename');
    const oldKey = `${prefix}old-name.txt`;
    const newKey = `${prefix}new-name.txt`;
    const cleanupKeys = [oldKey, newKey];

    try {
      await putTextObject(client, credentials.bucket, oldKey, 'rename test');

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'old-name.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Rename' }).click();

      // Modal should be open with the name pre-filled and selected
      const input = page.locator('.modal-box input');
      await expect(input).toBeVisible();

      // Clear and type new name
      await input.fill('new-name.txt');
      await page.getByRole('button', { name: 'Rename' }).click();

      await page.waitForTimeout(1000);

      // Old name should be gone, new name should exist
      expect(await objectExists(client, credentials.bucket, oldKey)).toBe(false);
      expect(await objectExists(client, credentials.bucket, newKey)).toBe(true);

      // Content should be preserved
      const content = await getObjectText(client, credentials.bucket, newKey);
      expect(content).toBe('rename test');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('rename conflict shows error inside modal', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'rename-conflict');
    const fileA = `${prefix}a.txt`;
    const fileB = `${prefix}b.txt`;
    const cleanupKeys = [fileA, fileB];

    try {
      await putTextObject(client, credentials.bucket, fileA, 'file a');
      await putTextObject(client, credentials.bucket, fileB, 'file b');

      await connectAndOpenPrefix(page, credentials, prefix);

      // Right-click file A and choose rename
      await rowByName(page, 'a.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Rename' }).click();

      // Try to rename to b.txt (which exists)
      const input = page.locator('.modal-box input');
      await input.fill('b.txt');
      await page.getByRole('button', { name: 'Rename' }).click();

      // Modal should stay open and show conflict error
      await expect(page.locator('.modal-box')).toBeVisible();
      await expect(page.getByText(/already exists/i)).toBeVisible();

      // Cancel the modal
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.locator('.modal-box')).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Keyboard shortcuts
  // ──────────────────────────────────────────────────────────────────────────

  test('Ctrl+C copies and Ctrl+V pastes a file', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'kb-copy-paste');
    const srcKey = `${prefix}src/`;
    const srcFile = `${srcKey}kb-test.txt`;
    const cleanupKeys = [srcFile];

    try {
      await putDirectoryMarker(client, credentials.bucket, srcKey);
      await putTextObject(client, credentials.bucket, srcFile, 'kb test');

      await connectAndOpenPrefix(page, credentials, srcKey);

      // Select the file
      await rowByName(page, 'kb-test.txt').click();

      // Press Ctrl+C to copy
      await page.keyboard.press('Control+c');
      await page.waitForTimeout(300);

      // Navigate to parent prefix in-app (preserves clipboard)
      await page.locator('tbody tr').first().click();
      await page.waitForTimeout(500);

      // Select somewhere to focus the page, then Ctrl+V
      await page.locator('table').click();
      await page.keyboard.press('Control+v');

      await page.waitForTimeout(1000);

      expect(await objectExists(client, credentials.bucket, `${prefix}kb-test.txt`)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('F2 renames a selected file', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'kb-rename');
    const oldKey = `${prefix}f2-old.txt`;
    const newKey = `${prefix}f2-new.txt`;
    const cleanupKeys = [oldKey, newKey];

    try {
      await putTextObject(client, credentials.bucket, oldKey, 'f2 rename');

      await connectAndOpenPrefix(page, credentials, prefix);

      // Select the file
      await rowByName(page, 'f2-old.txt').click();

      // Press F2 to open rename modal
      await page.keyboard.press('F2');
      await expect(page.locator('.modal-box')).toBeVisible();

      // Fill new name
      const input = page.locator('.modal-box input');
      await input.fill('f2-new.txt');
      await page.keyboard.press('Enter');

      await page.waitForTimeout(1000);

      expect(await objectExists(client, credentials.bucket, oldKey)).toBe(false);
      expect(await objectExists(client, credentials.bucket, newKey)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('Ctrl+X cuts and Ctrl+V pastes a file', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'kb-cut-paste');
    const srcKey = `${prefix}cutsrc/`;
    const srcFile = `${srcKey}cut-kb.txt`;
    const cleanupKeys = [srcFile];

    try {
      await putDirectoryMarker(client, credentials.bucket, srcKey);
      await putTextObject(client, credentials.bucket, srcFile, 'cut kb test');

      await connectAndOpenPrefix(page, credentials, srcKey);

      // Select the file
      await rowByName(page, 'cut-kb.txt').click();

      // Ctrl+X to cut
      await page.keyboard.press('Control+x');
      await page.waitForTimeout(300);

      // Navigate to parent prefix in-app (preserves clipboard)
      await page.locator('tbody tr').first().click();
      await page.waitForTimeout(500);

      // Paste
      await page.locator('table').click();
      await page.keyboard.press('Control+v');

      await page.waitForTimeout(1000);

      // File should exist at destination
      expect(await objectExists(client, credentials.bucket, `${prefix}cut-kb.txt`)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Drag-and-drop (move)
  // ──────────────────────────────────────────────────────────────────────────

  test('drags a file onto a folder to move it', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'drag-move');
    const destFolder = `${prefix}dest-folder/`;
    const srcFile = `${prefix}drag-me.txt`;
    const destFile = `${destFolder}drag-me.txt`;
    const cleanupKeys = [srcFile, destFolder];

    try {
      await putTextObject(client, credentials.bucket, srcFile, 'drag move test');
      await putDirectoryMarker(client, credentials.bucket, destFolder);

      await connectAndOpenPrefix(page, credentials, prefix);

      // Get source row and destination folder row positions
      const sourceRow = rowByName(page, 'drag-me.txt');
      const destRow = rowByName(page, 'dest-folder');

      await sourceRow.dragTo(destRow);

      // Confirm the move in the dialog
      await page.getByRole('button', { name: 'Move' }).click();

      await page.waitForTimeout(2000);

      // File should be moved to destination folder
      expect(await objectExists(client, credentials.bucket, srcFile)).toBe(false);
      expect(await objectExists(client, credentials.bucket, destFile)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('drags a file onto parent directory row to move it up', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'drag-up');
    const subDir = `${prefix}sub/`;
    const srcFile = `${subDir}up.txt`;
    const cleanupKeys = [srcFile];

    try {
      await putDirectoryMarker(client, credentials.bucket, subDir);
      await putTextObject(client, credentials.bucket, srcFile, 'move up');

      await connectAndOpenPrefix(page, credentials, subDir);

      // Drag file onto parent directory ".." row
      const sourceRow = rowByName(page, 'up.txt');
      const parentRow = page.locator('tbody tr').first(); // ".." parent row

      await sourceRow.dragTo(parentRow);

      // Confirm the move in the dialog
      await page.getByRole('button', { name: 'Move' }).click();

      await page.waitForTimeout(2000);

      // File should be at parent prefix
      expect(await objectExists(client, credentials.bucket, `${prefix}up.txt`)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('cancels drag-and-drop move via confirmation dialog', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'drag-cancel');
    const destFolder = `${prefix}dest/`;
    const srcFile = `${prefix}stay-here.txt`;
    const cleanupKeys = [srcFile, destFolder];

    try {
      await putTextObject(client, credentials.bucket, srcFile, 'should not move');
      await putDirectoryMarker(client, credentials.bucket, destFolder);

      await connectAndOpenPrefix(page, credentials, prefix);

      const sourceRow = rowByName(page, 'stay-here.txt');
      const destRow = rowByName(page, 'dest');
      await sourceRow.dragTo(destRow);

      // Cancel the move
      await page.getByRole('button', { name: 'Cancel' }).click();

      // File should still be at original location
      expect(await objectExists(client, credentials.bucket, srcFile)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
