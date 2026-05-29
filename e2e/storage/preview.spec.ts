import { PutObjectCommand } from '@aws-sdk/client-s3';
import { test, expect } from '@playwright/test';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  connectAndOpenPrefix,
  deleteKnownKeys,
  putTextObject,
  rowByName,
  uniquePrefix
} from './helpers.js';

test.describe('Storage S3 — Preview', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('previews text files from the object table', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview');
    const cleanupKeys = [`${prefix}preview.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}preview.txt`,
        'Preview line one\nPreview line two\n'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'preview.txt').dblclick();
      await expect(page.getByRole('heading', { name: 'preview.txt' })).toBeVisible();
      await expect(page.getByText('Preview line one')).toBeVisible();
      await expect(page.getByText('Preview line two')).toBeVisible();

      await page.getByRole('button', { name: 'Close' }).last().click();
      await expect(page.getByRole('heading', { name: 'preview.txt' })).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('shows fallback preview for a known binary file type', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-zip');
    const cleanupKeys = [`${prefix}archive.zip`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}archive.zip`,
          Body: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
          ContentType: 'application/zip'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'archive.zip').dblclick();

      await expect(page.getByRole('heading', { name: 'archive.zip' })).toBeVisible();
      await expect(page.getByText('Preview unavailable')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Download full file' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('shows binary fallback preview for non-decodable binary content', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-bin');
    const cleanupKeys = [`${prefix}data.bin`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}data.bin`,
          Body: Buffer.from([0x80, 0x81, 0x82, 0x83, 0xff, 0xfe, 0x00, 0x01]),
          ContentType: 'application/octet-stream'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'data.bin').dblclick();

      await expect(page.getByRole('heading', { name: 'data.bin' })).toBeVisible();
      await expect(page.getByText('Binary content')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Download full file' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('shows a PDF preview for PDF files', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-pdf');
    const cleanupKeys = [`${prefix}document.pdf`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}document.pdf`,
          Body: Buffer.from('%PDF-1.4\n%%EOF\n'),
          ContentType: 'application/pdf'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'document.pdf').dblclick();

      await expect(page.getByRole('heading', { name: 'document.pdf' })).toBeVisible();
      await expect(page.getByTitle('Preview of document.pdf')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('closes preview modal when the Escape key is pressed', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-escape');
    const cleanupKeys = [`${prefix}escape.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}escape.txt`,
        'press escape to close'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'escape.txt').dblclick();
      await expect(page.getByRole('heading', { name: 'escape.txt' })).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(page.getByRole('heading', { name: 'escape.txt' })).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
