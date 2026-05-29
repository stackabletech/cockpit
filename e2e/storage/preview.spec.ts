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

  test('previews image files with alt text, file size, and download link', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-img');
    const cleanupKeys = [`${prefix}diagram.svg`];

    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect width="200" height="100" fill="#4f46e5" />
  <text x="100" y="55" text-anchor="middle" fill="#fff" font-size="16">Test Image</text>
</svg>`;

      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}diagram.svg`,
          Body: Buffer.from(svg),
          ContentType: 'image/svg+xml'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'diagram.svg').dblclick();

      // Modal heading
      await expect(page.getByRole('heading', { name: 'diagram.svg' })).toBeVisible();

      // Image rendered with accessible alt text
      await expect(page.getByAltText('Preview of diagram.svg')).toBeVisible();

      // File size badge is displayed
      await expect(page.locator('.badge', { hasText: /B$/ })).toBeVisible();

      // Download link is available
      await expect(page.getByRole('link', { name: 'Download full file' })).toBeVisible();

      // Close button works
      await page.getByRole('button', { name: 'Close' }).last().click();
      await expect(page.getByRole('heading', { name: 'diagram.svg' })).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('previews CSV files with table headers and data rows', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-csv');
    const cleanupKeys = [`${prefix}report.csv`];

    try {
      const csvContent = [
        'name,city,score',
        'Alice,Berlin,95',
        'Bob,Munich,88',
        'Charlie,Hamburg,72'
      ].join('\n');

      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}report.csv`,
        csvContent,
        'text/csv'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'report.csv').dblclick();

      // Modal heading
      await expect(page.getByRole('heading', { name: 'report.csv' })).toBeVisible();

      // CSV table is rendered with correct aria label
      const table = page.getByRole('table', { name: 'CSV preview' });
      await expect(table).toBeVisible();

      // Headers are present
      await expect(table.locator('th', { hasText: 'name' })).toBeVisible();
      await expect(table.locator('th', { hasText: 'city' })).toBeVisible();
      await expect(table.locator('th', { hasText: 'score' })).toBeVisible();

      // Data rows are present
      await expect(table.locator('td', { hasText: 'Alice' })).toBeVisible();
      await expect(table.locator('td', { hasText: 'Berlin' })).toBeVisible();
      await expect(table.locator('td', { hasText: '95' })).toBeVisible();
      await expect(table.locator('td', { hasText: 'Bob' })).toBeVisible();

      // File size badge is displayed
      await expect(page.locator('.badge', { hasText: /B$/ })).toBeVisible();

      // Close button works
      await page.getByRole('button', { name: 'Close' }).last().click();
      await expect(page.getByRole('heading', { name: 'report.csv' })).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('previews CSV files with quoted fields containing commas', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-csv-quoted');
    const cleanupKeys = [`${prefix}addresses.csv`];

    try {
      const csvContent = [
        'name,address,country',
        '"Smith, John","123 Main St, Apt 4",Germany',
        '"Doe, Jane","456 Oak Ave",Austria'
      ].join('\n');

      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}addresses.csv`,
        csvContent,
        'text/csv'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'addresses.csv').dblclick();

      await expect(page.getByRole('heading', { name: 'addresses.csv' })).toBeVisible();

      const table = page.getByRole('table', { name: 'CSV preview' });
      await expect(table).toBeVisible();

      // Quoted fields with commas are parsed correctly
      await expect(table.locator('td', { hasText: 'Smith, John' })).toBeVisible();
      await expect(table.locator('td', { hasText: '123 Main St, Apt 4' })).toBeVisible();
      await expect(table.locator('td', { hasText: 'Germany' })).toBeVisible();
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
