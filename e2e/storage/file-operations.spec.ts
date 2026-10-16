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
      await expect(page).toHaveURL((url) => url.pathname.endsWith('/target'));

      // Paste (use keyboard shortcut — right-click in an empty folder
      // lands on the ".." row which has no context menu handler)
      await page.locator('table').click();
      await page.keyboard.press('Control+v');

      await expect
        .poll(() => objectExists(client, credentials.bucket, `${destDir}nested-src.txt`))
        .toBe(true);
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

  test('pasting a folder over an existing folder merges it, keeping destination-only files', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'paste-folder-merge');
    const srcRoot = `${prefix}src/docs/`;
    const destRoot = `${prefix}dest/docs/`;
    const cleanupKeys = [
      `${prefix}src/`,
      `${srcRoot}new.txt`,
      `${srcRoot}shared.txt`,
      `${prefix}dest/`,
      `${destRoot}old.txt`,
      `${destRoot}new.txt`,
      `${destRoot}shared.txt`
    ];

    try {
      await putDirectoryMarker(client, credentials.bucket, `${prefix}src/`);
      await putTextObject(client, credentials.bucket, `${srcRoot}new.txt`, 'new');
      await putTextObject(client, credentials.bucket, `${srcRoot}shared.txt`, 'from source');
      await putDirectoryMarker(client, credentials.bucket, `${prefix}dest/`);
      await putTextObject(client, credentials.bucket, `${destRoot}old.txt`, 'old');
      await putTextObject(client, credentials.bucket, `${destRoot}shared.txt`, 'from destination');

      await connectAndOpenPrefix(page, credentials, `${prefix}src/`);
      await rowByName(page, 'docs').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();

      await page.locator('tbody tr').first().click();
      await rowByName(page, 'dest').dblclick();
      await expect(rowByName(page, 'docs')).toBeVisible();
      await page.locator('table').click();
      await page.keyboard.press('Control+v');

      const conflictDialog = page.getByRole('dialog');
      await expect(conflictDialog.getByText('Files already exist', { exact: true })).toBeVisible();
      await expect(
        conflictDialog.getByText(/keeps files that exist only in the destination/)
      ).toBeVisible();
      await conflictDialog.getByRole('button', { name: 'Merge all' }).click();
      await conflictDialog.getByRole('button', { name: 'Paste', exact: true }).click();

      await expect(page.getByText('1 item pasted')).toBeVisible();
      await expect
        .poll(() => objectExists(client, credentials.bucket, `${destRoot}new.txt`))
        .toBe(true);
      expect(await getObjectText(client, credentials.bucket, `${destRoot}shared.txt`)).toBe(
        'from source'
      );
      expect(await getObjectText(client, credentials.bucket, `${destRoot}old.txt`)).toBe('old');
      expect(await getObjectText(client, credentials.bucket, `${srcRoot}new.txt`)).toBe('new');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('renaming a pasted folder in the conflict dialog renames the whole folder', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'paste-folder-rename');
    const srcFile = `${prefix}src/docs/new.txt`;
    const destRoot = `${prefix}dest/docs/`;
    const renamedFile = `${prefix}dest/renamed/new.txt`;
    const cleanupKeys = [
      `${prefix}src/`,
      srcFile,
      `${prefix}dest/`,
      `${destRoot}old.txt`,
      renamedFile,
      `${prefix}dest/docs (1)/new.txt`
    ];

    try {
      await putDirectoryMarker(client, credentials.bucket, `${prefix}src/`);
      await putTextObject(client, credentials.bucket, srcFile, 'new');
      await putDirectoryMarker(client, credentials.bucket, `${prefix}dest/`);
      await putTextObject(client, credentials.bucket, `${destRoot}old.txt`, 'old');

      await connectAndOpenPrefix(page, credentials, `${prefix}src/`);
      await rowByName(page, 'docs').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();

      await page.locator('tbody tr').first().click();
      await rowByName(page, 'dest').dblclick();
      await expect(rowByName(page, 'docs')).toBeVisible();
      await page.locator('table').click();
      await page.keyboard.press('Control+v');

      const conflictDialog = page.getByRole('dialog');
      await expect(conflictDialog.getByText('Files already exist', { exact: true })).toBeVisible();
      const conflictItem = conflictDialog.getByRole('listitem');
      await conflictItem.getByRole('button', { name: 'Rename', exact: true }).click();
      await conflictItem.getByLabel('New file name').fill('renamed');
      await conflictItem.getByRole('button', { name: 'Confirm name' }).click();
      await conflictDialog.getByRole('button', { name: 'Paste', exact: true }).click();

      await expect.poll(() => objectExists(client, credentials.bucket, renamedFile)).toBe(true);
      expect(await getObjectText(client, credentials.bucket, renamedFile)).toBe('new');
      expect(await objectExists(client, credentials.bucket, `${prefix}dest/docs (1)/new.txt`)).toBe(
        false
      );
      expect(await getObjectText(client, credentials.bucket, `${destRoot}old.txt`)).toBe('old');
      await expect(page.getByText('1 item pasted')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('checking a new name in the conflict dialog reports names that are taken', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'paste-rename-check');
    // `docs/` and `taken/` exist only through their objects (no folder marker).
    const cleanupKeys = [
      `${prefix}src/`,
      `${prefix}src/a.txt`,
      `${prefix}src/docs/new.txt`,
      `${prefix}dest/`,
      `${prefix}dest/a.txt`,
      `${prefix}dest/b.txt`,
      `${prefix}dest/docs/old.txt`,
      `${prefix}dest/taken/x.txt`,
      `${prefix}dest/free.txt`,
      `${prefix}dest/fresh/new.txt`
    ];

    try {
      await putDirectoryMarker(client, credentials.bucket, `${prefix}src/`);
      await putTextObject(client, credentials.bucket, `${prefix}src/a.txt`, 'new a');
      await putTextObject(client, credentials.bucket, `${prefix}src/docs/new.txt`, 'new');
      await putDirectoryMarker(client, credentials.bucket, `${prefix}dest/`);
      await putTextObject(client, credentials.bucket, `${prefix}dest/a.txt`, 'old a');
      await putTextObject(client, credentials.bucket, `${prefix}dest/b.txt`, 'b');
      await putTextObject(client, credentials.bucket, `${prefix}dest/docs/old.txt`, 'old');
      await putTextObject(client, credentials.bucket, `${prefix}dest/taken/x.txt`, 'x');

      await connectAndOpenPrefix(page, credentials, `${prefix}src/`);
      await expect(rowByName(page, 'docs')).toBeVisible();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Control+c');

      await page.locator('tbody tr').first().click();
      await rowByName(page, 'dest').dblclick();
      await expect(rowByName(page, 'taken')).toBeVisible();
      await page.locator('table').click();
      await page.keyboard.press('Control+v');

      const conflictDialog = page.getByRole('dialog');
      await expect(conflictDialog.getByText('Files already exist', { exact: true })).toBeVisible();
      const pasteButton = conflictDialog.getByRole('button', { name: 'Paste', exact: true });

      for (const [original, taken, free] of [
        ['a.txt', 'b.txt', 'free.txt'],
        ['docs', 'taken', 'fresh']
      ]) {
        const item = conflictDialog.getByRole('listitem').filter({ hasText: original });
        await item.getByRole('button', { name: 'Rename', exact: true }).click();
        await item.getByLabel('New file name').fill(taken);
        await item.getByRole('button', { name: 'Confirm name' }).click();
        await expect(
          item.getByText('This name already exists here. Please choose a different name.')
        ).toBeVisible();
        await expect(pasteButton).toBeDisabled();

        await item.getByLabel('New file name').fill(free);
        await item.getByRole('button', { name: 'Confirm name' }).click();
        await expect(
          item.getByText('This name already exists here. Please choose a different name.')
        ).toBeHidden();
      }
      await expect(pasteButton).toBeEnabled();
      await pasteButton.click();

      await expect(page.getByText('2 items pasted')).toBeVisible();
      expect(await getObjectText(client, credentials.bucket, `${prefix}dest/free.txt`)).toBe(
        'new a'
      );
      expect(await getObjectText(client, credentials.bucket, `${prefix}dest/fresh/new.txt`)).toBe(
        'new'
      );
      expect(await getObjectText(client, credentials.bucket, `${prefix}dest/b.txt`)).toBe('b');
      expect(await objectExists(client, credentials.bucket, `${prefix}dest/taken/new.txt`)).toBe(
        false
      );
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('copying items into their own folder creates renamed copies', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'paste-same-folder');
    const file = `${prefix}keep.txt`;
    const folderFile = `${prefix}docs/inner.txt`;
    const cleanupKeys = [file, folderFile, `${prefix}keep (1).txt`, `${prefix}docs (1)/inner.txt`];

    try {
      await putTextObject(client, credentials.bucket, file, 'keep');
      await putTextObject(client, credentials.bucket, folderFile, 'inner');

      await connectAndOpenPrefix(page, credentials, prefix);
      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select keep.txt').check();
      await page.getByLabel('Select docs').check();
      await page.keyboard.press('Control+c');
      await page.keyboard.press('Control+v');

      // Pasting onto themselves is not a conflict: the server copies to unique names.
      await expect
        .poll(() => objectExists(client, credentials.bucket, `${prefix}keep (1).txt`))
        .toBe(true);
      await expect
        .poll(() => objectExists(client, credentials.bucket, `${prefix}docs (1)/inner.txt`))
        .toBe(true);
      await expect(page.getByText('Files already exist', { exact: true })).toHaveCount(0);
      expect(await getObjectText(client, credentials.bucket, file)).toBe('keep');
      expect(await getObjectText(client, credentials.bucket, folderFile)).toBe('inner');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('renamed copies keep dotted folder names intact', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = `${uniquePrefix(testInfo, 'paste-dotted')}dir.v2/`;
    const file = `${prefix}file`;
    const folderFile = `${prefix}v1.2/sub/inner.txt`;
    const copiedFile = `${prefix}file (1)`;
    const copiedFolderFile = `${prefix}v1.2 (1)/sub/inner.txt`;
    const cleanupKeys = [file, folderFile, copiedFile, copiedFolderFile];

    try {
      await putTextObject(client, credentials.bucket, file, 'file');
      await putTextObject(client, credentials.bucket, folderFile, 'inner');

      await connectAndOpenPrefix(page, credentials, prefix);
      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select file', { exact: true }).check();
      await page.getByLabel('Select v1.2', { exact: true }).check();
      await page.keyboard.press('Control+c');
      await page.keyboard.press('Control+v');

      // Only the copied item's own name is numbered, never a parent folder.
      await expect.poll(() => objectExists(client, credentials.bucket, copiedFile)).toBe(true);
      await expect
        .poll(() => objectExists(client, credentials.bucket, copiedFolderFile))
        .toBe(true);
      expect(await getObjectText(client, credentials.bucket, copiedFolderFile)).toBe('inner');
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
      await expect.poll(() => objectExists(client, credentials.bucket, oldKey)).toBe(false);
      expect(await objectExists(client, credentials.bucket, newKey)).toBe(true);

      // Content should be preserved
      const content = await getObjectText(client, credentials.bucket, newKey);
      expect(content).toBe('rename test');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('renames a file whose key uses characters S3 allows', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'rename-odd-key');
    const oldKey = `${prefix}what?<a|b>.csv`;
    const newKey = `${prefix}renamed.csv`;
    const cleanupKeys = [oldKey, newKey];

    try {
      await putTextObject(client, credentials.bucket, oldKey, 'odd rename');

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'what?<a|b>.csv').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await page.locator('.modal-box input').fill('renamed.csv');
      await page.getByRole('button', { name: 'Rename' }).click();

      await expect.poll(() => objectExists(client, credentials.bucket, newKey)).toBe(true);
      await expect.poll(() => objectExists(client, credentials.bucket, oldKey)).toBe(false);
      expect(await getObjectText(client, credentials.bucket, newKey)).toBe('odd rename');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('explains an invalid new name instead of closing the rename dialog', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'rename-invalid');
    const oldKey = `${prefix}keep.txt`;
    const cleanupKeys = [oldKey, `${prefix}a/b.txt`];

    try {
      await putTextObject(client, credentials.bucket, oldKey, 'keep');

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'keep.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      const input = page.getByLabel('New name');
      await input.fill('a/b.txt');
      await input.press('Enter');

      const message = page.getByRole('dialog').locator('.modal-box p[aria-live="polite"]');
      await expect(message).toContainText('Enter a single name without "/"');
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveAttribute('aria-describedby', (await message.getAttribute('id'))!);
      await expect(page.getByRole('button', { name: 'Rename' })).toBeDisabled();
      await expect(input).toBeVisible();
      expect(await objectExists(client, credentials.bucket, oldKey)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('renaming onto a taken name shows an error and changes nothing', async ({
    page
  }, testInfo) => {
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

      await rowByName(page, 'a.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Rename' }).click();

      const input = page.locator('.modal-box input');
      await input.fill('b.txt');
      await page.getByRole('button', { name: 'Rename' }).click();

      // The rename is refused: the modal stays open with the error.
      await expect(page.locator('.modal-box').getByText(/already exists/)).toBeVisible();
      await expect(input).toBeVisible();
      expect(await getObjectText(client, credentials.bucket, fileA)).toBe('file a');
      expect(await getObjectText(client, credentials.bucket, fileB)).toBe('file b');
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

      await expect.poll(() => objectExists(client, credentials.bucket, oldKey)).toBe(false);
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
    const destFile = `${prefix}cut-kb.txt`;
    const cleanupKeys = [srcFile, destFile];

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
      expect(await objectExists(client, credentials.bucket, destFile)).toBe(true);
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
      await expect.poll(() => objectExists(client, credentials.bucket, srcFile)).toBe(false);
      expect(await objectExists(client, credentials.bucket, destFile)).toBe(true);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('renaming during a move conflict moves only the dragged file', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'move-conflict-rename');
    const destFolder = `${prefix}dest-folder/`;
    const fileA = `${prefix}a.txt`;
    const fileB = `${prefix}b.txt`;
    const destA = `${destFolder}a.txt`;
    const destB = `${destFolder}b.txt`;
    const cleanupKeys = [fileA, fileB, destA, destB, destFolder];

    try {
      await putTextObject(client, credentials.bucket, fileA, 'file a');
      // A sibling of the dragged file already carries the chosen name.
      await putTextObject(client, credentials.bucket, fileB, 'file b');
      await putTextObject(client, credentials.bucket, destA, 'existing a');

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'a.txt').dragTo(rowByName(page, 'dest-folder'));
      await page.getByRole('button', { name: 'Move' }).click();

      const conflictDialog = page.getByRole('dialog');
      await expect(conflictDialog.getByText('Files already exist', { exact: true })).toBeVisible();
      const conflictItem = conflictDialog.getByRole('listitem');
      await conflictItem.getByRole('button', { name: 'Rename', exact: true }).click();
      await conflictItem.getByLabel('New file name').fill('b.txt');
      await conflictItem.getByRole('button', { name: 'Confirm name' }).click();
      await conflictDialog.getByRole('button', { name: 'Move', exact: true }).click();

      await expect.poll(() => objectExists(client, credentials.bucket, destB)).toBe(true);
      expect(await getObjectText(client, credentials.bucket, destB)).toBe('file a');
      await expect.poll(() => objectExists(client, credentials.bucket, fileA)).toBe(false);
      expect(await getObjectText(client, credentials.bucket, fileB)).toBe('file b');
      expect(await getObjectText(client, credentials.bucket, destA)).toBe('existing a');
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

  test('renames a folder subtree and removes its source marker', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'folder-rename');
    const oldRoot = `${prefix}docs/`;
    const newRoot = `${prefix}renamed/`;
    const cleanupKeys = [
      oldRoot,
      `${oldRoot}one.txt`,
      `${oldRoot}nested/two.txt`,
      newRoot,
      `${newRoot}one.txt`,
      `${newRoot}nested/two.txt`
    ];
    try {
      await putDirectoryMarker(client, credentials.bucket, oldRoot);
      await putTextObject(client, credentials.bucket, `${oldRoot}one.txt`, 'first');
      await putTextObject(client, credentials.bucket, `${oldRoot}nested/two.txt`, 'second');
      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'docs').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await page.locator('.modal-box input').fill('renamed');
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect
        .poll(() => objectExists(client, credentials.bucket, `${newRoot}nested/two.txt`))
        .toBe(true);
      expect(await getObjectText(client, credentials.bucket, `${newRoot}one.txt`)).toBe('first');
      expect(await getObjectText(client, credentials.bucket, `${newRoot}nested/two.txt`)).toBe(
        'second'
      );
      await expect.poll(() => objectExists(client, credentials.bucket, oldRoot)).toBe(false);
      await expect
        .poll(() => objectExists(client, credentials.bucket, `${oldRoot}one.txt`))
        .toBe(false);
      expect(await objectExists(client, credentials.bucket, `${oldRoot}nested/two.txt`)).toBe(
        false
      );
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
