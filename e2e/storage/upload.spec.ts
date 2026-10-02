import { test, expect } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  createCsvUploadFixture,
  createImageUploadFixture,
  createTextUploadFixture
} from '../support/storage-upload-fixtures.js';
import {
  connectAndOpenPrefix,
  deleteKnownKeys,
  getObjectText,
  headObject,
  modalBox,
  putTextObject,
  rowByName,
  uniquePrefix
} from './helpers.js';

test.describe('Storage S3 — Upload', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  for (const target of ['empty listing', 'folder row', 'browser toolbar']) {
    test(`uploads files dropped on the ${target} to the current prefix`, async ({
      page
    }, testInfo) => {
      const credentials = requireGarageCredentials();
      const client = createS3Client(credentials);
      const prefix = uniquePrefix(testInfo, 'drop-upload');
      const fixture = createTextUploadFixture(testInfo.title);
      const key = `${prefix}${fixture.name}`;
      const nestedKey = `${prefix}child/existing.txt`;

      try {
        if (target === 'folder row') {
          await putTextObject(client, credentials.bucket, nestedKey, 'existing child');
        }
        await connectAndOpenPrefix(page, credentials, prefix);

        const browser = page.getByTestId('storage-file-browser');
        const dropTarget =
          target === 'folder row'
            ? rowByName(page, 'child')
            : target === 'empty listing'
              ? page.getByTestId('storage-object-list').locator('tbody tr').last()
              : browser.getByRole('button', { name: 'Upload', exact: true });
        const transfer = await page.evaluateHandle(
          ({ name, text }) => {
            const dt = new DataTransfer();
            dt.items.add(new File([text], name, { type: 'text/plain' }));
            dt.items.add(new File(['second file'], 'second.txt', { type: 'text/plain' }));
            return dt;
          },
          { name: fixture.name, text: fixture.fullText }
        );
        try {
          await dropTarget.dispatchEvent('dragenter', { dataTransfer: transfer });
          await dropTarget.dispatchEvent('dragover', { dataTransfer: transfer });
          await expect(page.getByTestId('storage-upload-drop-overlay')).toBeVisible();
          await dropTarget.dispatchEvent('dragleave', { dataTransfer: transfer });
          await expect(page.getByTestId('storage-upload-drop-overlay')).not.toBeVisible();
          await dropTarget.dispatchEvent('dragenter', { dataTransfer: transfer });
          await dropTarget.dispatchEvent('drop', { dataTransfer: transfer });
          await expect(page.getByTestId('storage-upload-drop-overlay')).not.toBeVisible();

          const uploadModal = modalBox(page);
          await expect(uploadModal.getByText(fixture.name, { exact: true })).toBeVisible();
          await expect(uploadModal.getByText('second.txt', { exact: true })).toBeVisible();
          await expect(uploadModal.getByText(`Uploading to: ${prefix}`)).toBeVisible();
          // A drop selects files for review; it must not start an upload yet.
          await expect(
            uploadModal.getByRole('button', { name: 'Upload', exact: true })
          ).toBeVisible();
          await uploadModal.getByRole('button', { name: 'Cancel', exact: true }).click();
          await expect(page.getByRole('dialog')).not.toBeVisible();

          await dropTarget.dispatchEvent('drop', { dataTransfer: transfer });
          await uploadModal.getByRole('button', { name: 'Upload', exact: true }).click();
          await expect(uploadModal.getByText('2 uploaded · 0 skipped · 0 failed')).toBeVisible();
          await uploadModal.getByRole('button', { name: 'Done' }).click();
          await expect(rowByName(page, fixture.name)).toBeVisible();
          await expect(await getObjectText(client, credentials.bucket, key)).toBe(fixture.fullText);
        } finally {
          await transfer.dispose();
        }
      } finally {
        await deleteKnownKeys(client, credentials.bucket, [key, `${prefix}second.txt`, nestedKey]);
      }
    });
  }

  test('uploads realistic faker-generated text, csv, and image files', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'faker-upload');
    const textFixture = createTextUploadFixture(`${testInfo.title}-text`);
    const csvFixture = createCsvUploadFixture(`${testInfo.title}-csv`);
    const imageFixture = createImageUploadFixture(`${testInfo.title}-image`);
    const cleanupKeys = [
      `${prefix}${textFixture.name}`,
      `${prefix}${csvFixture.name}`,
      `${prefix}${imageFixture.name}`
    ];

    try {
      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Upload' }).click();
      const uploadModal = modalBox(page);
      await uploadModal
        .locator('input[aria-label="Select files"]')
        .setInputFiles([textFixture, csvFixture, imageFixture]);
      await uploadModal.getByRole('button', { name: 'Upload' }).click();
      await expect(uploadModal.getByText('Upload complete')).toBeVisible();
      await expect(uploadModal.getByText('3 uploaded · 0 skipped · 0 failed')).toBeVisible();
      await uploadModal.getByRole('button', { name: 'Done' }).click();

      await expect(rowByName(page, textFixture.name)).toBeVisible();
      await expect(rowByName(page, csvFixture.name)).toBeVisible();
      await expect(rowByName(page, imageFixture.name)).toBeVisible();

      await expect(
        await getObjectText(client, credentials.bucket, `${prefix}${textFixture.name}`)
      ).toContain(textFixture.expectedSnippet);
      await expect(
        await getObjectText(client, credentials.bucket, `${prefix}${csvFixture.name}`)
      ).toContain(csvFixture.expectedCell);

      await expect(
        (await headObject(client, credentials.bucket, `${prefix}${textFixture.name}`)).ContentType
      ).toBe('text/plain');
      await expect(
        (await headObject(client, credentials.bucket, `${prefix}${csvFixture.name}`)).ContentType
      ).toBe('text/csv');
      await expect(
        (await headObject(client, credentials.bucket, `${prefix}${imageFixture.name}`)).ContentType
      ).toBe('image/svg+xml');

      await rowByName(page, textFixture.name).dblclick();
      await expect(page.getByRole('heading', { name: textFixture.name })).toBeVisible();
      await expect(page.getByText(textFixture.expectedSnippet)).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).first().click();
      await expect(page.getByRole('heading', { name: textFixture.name })).not.toBeVisible();

      await rowByName(page, csvFixture.name).dblclick();
      await expect(page.getByRole('heading', { name: csvFixture.name })).toBeVisible();
      await expect(page.getByText(csvFixture.expectedCell)).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).first().click();
      await expect(page.getByRole('heading', { name: csvFixture.name })).not.toBeVisible();

      await rowByName(page, imageFixture.name).dblclick();
      await expect(page.getByRole('heading', { name: imageFixture.name })).toBeVisible();
      await expect(page.getByAltText(`Preview of ${imageFixture.name}`)).toBeVisible();
      await page.keyboard.press('Escape');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('uploads files and resolves replace, skip, and rename conflicts', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'upload');
    const cleanupKeys = [
      `${prefix}replace.txt`,
      `${prefix}skip.txt`,
      `${prefix}taken.txt`,
      `${prefix}already-here.txt`,
      `${prefix}renamed.txt`,
      `${prefix}fresh.txt`
    ];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}replace.txt`, 'old replace');
      await putTextObject(client, credentials.bucket, `${prefix}skip.txt`, 'old skip');
      await putTextObject(client, credentials.bucket, `${prefix}taken.txt`, 'old taken');
      await putTextObject(client, credentials.bucket, `${prefix}already-here.txt`, 'taken target');

      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Upload' }).click();
      const uploadModal = modalBox(page);
      await uploadModal.locator('input[aria-label="Select files"]').setInputFiles([
        {
          name: 'replace.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('new replace')
        },
        {
          name: 'skip.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('new skip')
        },
        {
          name: 'taken.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('new taken')
        },
        {
          name: 'fresh.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('brand new')
        }
      ]);

      await uploadModal.getByRole('button', { name: 'Upload' }).click();
      await expect(uploadModal.getByText('Files already exist')).toBeVisible();

      await uploadModal
        .locator('li', { hasText: 'replace.txt' })
        .getByRole('button', { name: 'Replace' })
        .click();
      await uploadModal
        .locator('li', { hasText: 'skip.txt' })
        .getByRole('button', { name: 'Skip' })
        .click();

      const renameItem = uploadModal.locator('li', { hasText: 'taken.txt' });
      await renameItem.getByRole('button', { name: 'Rename' }).click();
      await renameItem.getByLabel('New file name').fill('already-here.txt');
      await renameItem.getByRole('button', { name: 'Confirm name' }).click();
      await expect(
        renameItem.getByText('This name already exists here. Please choose a different name.')
      ).toBeVisible();

      await renameItem.getByLabel('New file name').fill('renamed.txt');
      await renameItem.getByRole('button', { name: 'Confirm name' }).click();

      await uploadModal.getByRole('button', { name: 'Upload' }).click();
      await expect(uploadModal.getByText('Upload complete')).toBeVisible();
      await expect(uploadModal.getByText('3 uploaded · 1 skipped · 0 failed')).toBeVisible();
      await uploadModal.getByRole('button', { name: 'Done' }).click();

      await expect(rowByName(page, 'fresh.txt')).toBeVisible();
      await expect(rowByName(page, 'renamed.txt')).toBeVisible();

      await expect(await getObjectText(client, credentials.bucket, `${prefix}replace.txt`)).toBe(
        'new replace'
      );
      await expect(await getObjectText(client, credentials.bucket, `${prefix}skip.txt`)).toBe(
        'old skip'
      );
      await expect(await getObjectText(client, credentials.bucket, `${prefix}taken.txt`)).toBe(
        'old taken'
      );
      await expect(await getObjectText(client, credentials.bucket, `${prefix}renamed.txt`)).toBe(
        'new taken'
      );
      await expect(await getObjectText(client, credentials.bucket, `${prefix}fresh.txt`)).toBe(
        'brand new'
      );
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
