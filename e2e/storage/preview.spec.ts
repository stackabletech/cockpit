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
      await expect(page.getByRole('button', { name: 'Download full file' })).toBeVisible();
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

      // Download button is available
      await expect(page.getByRole('button', { name: 'Download full file' })).toBeVisible();

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

  test('previews parquet files with column headers and data rows', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-parquet');
    const cleanupKeys = [`${prefix}data.parquet`];

    try {
      // A minimal valid parquet file generated by pyarrow:
      //   id | name    | score
      //   1  | Alice   | 95.5
      //   2  | Bob     | 87.0
      //   3  | Charlie | 72.3
      const parquetBase64 =
        'UEFSMRUEFSAVIEwVBBUAEgAAAQAAAAAAAAACAAAAAAAAABUAFRIVEiwVBBUQFQYVBhwYCAIAAAAAAAAAGAgBAAAAAAAAABYAKAgCAAAAAAAAABgIAQAAAAAAAAAREQAAAAIAAAAEAQEDAhUEFSAVIEwVBBUAEgAABQAAAEFsaWNlAwAAAEJvYhUAFRIVEiwVBBUQFQYVBhw2ACgDQm9iGAVBbGljZRERAAAAAgAAAAQBAQMCFQQVIBUgTBUEFQASAAAAAAAAAOBXQAAAAAAAwFVAFQAVEhUSLBUEFRAVBhUGHBgIAAAAAADgV0AYCAAAAAAAwFVAFgAoCAAAAAAA4FdAGAgAAAAAAMBVQBERAAAAAgAAAAQBAQMCFQQVEBUQTBUCFQASAAADAAAAAAAAABUAFRIVEiwVAhUQFQYVBhwYCAMAAAAAAAAAGAgDAAAAAAAAABYAKAgDAAAAAAAAABgIAwAAAAAAAAAREQAAAAIAAAACAQECABUEFRYVFkwVAhUAEgAABwAAAENoYXJsaWUVABUSFRIsFQIVEBUGFQYcNgAoB0NoYXJsaWUYB0NoYXJsaWUREQAAAAIAAAACAQECABUEFRAVEEwVAhUAEgAAMzMzMzMTUkAVABUSFRIsFQIVEBUGFQYcGAgzMzMzMxNSQBgIMzMzMzMTUkAWACgIMzMzMzMTUkAYCDMzMzMzE1JAEREAAAACAAAAAgEBAgAVBBlMNQAYBnNjaGVtYRUGABUEJQIYAmlkABUMJQIYBG5hbWUlAEwcAAAAFQolAhgFc2NvcmUAFgYZLBk8JgAcFQQZNQAGEBkYAmlkFQAWBBbMARbMASZEJggcGAgCAAAAAAAAABgIAQAAAAAAAAAWACgIAgAAAAAAAAAYCAEAAAAAAAAAEREAGSwVBBUAFQIAFQAVEBUCADwpBhkmAAQAAAAmABwVDBk1AAYQGRgEbmFtZRUAFgQWlAEWlAEmkAIm1AEcNgAoA0JvYhgFQWxpY2UREQAZLBUEFQAVAgAVABUQFQIAPBYQGQYZJgAEAAAAJgAcFQoZNQAGEBkYBXNjb3JlFQAWBBbMARbMASakAyboAhwYCAAAAAAA4FdAGAgAAAAAAMBVQBYAKAgAAAAAAOBXQBgIAAAAAADAVUAREQAZLBUEFQAVAgAVABUQFQIAPCkGGSYABAAAABasBBYEJggWrAQAGTwmABwVBBk1AAYQGRgCaWQVABYCFrwBFrwBJuAEJrQEHBgIAwAAAAAAAAAYCAMAAAAAAAAAFgAoCAMAAAAAAAAAGAgDAAAAAAAAABERABksFQQVABUCABUAFRAVAgA8KQYZJgACAAAAJgAcFQwZNQAGEBkYBG5hbWUVABYCFpYBFpYBJqIGJvAFHDYAKAdDaGFybGllGAdDaGFybGllEREAGSwVBBUAFQIAFQAVEBUCADwWDhkGGSYAAgAAACYAHBUKGTUABhAZGAVzY29yZRUAFgIWvAEWvAEmsgcmhgccGAgzMzMzMxNSQBgIMzMzMzMTUkAWACgIMzMzMzMTUkAYCDMzMzMzE1JAEREAGSwVBBUAFQIAFQAVEBUCADwpBhkmAAIAAAAWjgQWAia0BBaOBAAZHBgMQVJST1c6c2NoZW1hGLgCLy8vLy8rQUFBQUFRQUFBQUFBQUtBQXdBQmdBRkFBZ0FDZ0FBQUFBQkJBQU1BQUFBQ0FBSUFBQUFCQUFJQUFBQUJBQUFBQU1BQUFCNEFBQUFPQUFBQUFRQUFBQ2svLy8vQUFBQkF4QUFBQUFjQUFBQUJBQUFBQUFBQUFBRkFBQUFjMk52Y21VQUJnQUlBQVlBQmdBQUFBQUFBZ0RVLy8vL0FBQUJCUkFBQUFBY0FBQUFCQUFBQUFBQUFBQUVBQUFBYm1GdFpRQUFBQUFFQUFRQUJBQUFBQkFBRkFBSUFBWUFCd0FNQUFBQUVBQVFBQUFBQUFBQkFoQUFBQUFjQUFBQUJBQUFBQUFBQUFBQ0FBQUFhV1FBQUFnQURBQUlBQWNBQ0FBQUFBQUFBQUZBQUFBQUFBQUFBQT09ABggcGFycXVldC1jcHAtYXJyb3cgdmVyc2lvbiAyNC4wLjAZPBwAABwAABwAAAAUBAAAUEFSMQ==';

      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}data.parquet`,
          Body: Buffer.from(parquetBase64, 'base64'),
          ContentType: 'application/vnd.apache.parquet'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'data.parquet').dblclick();

      // Modal heading
      await expect(page.getByRole('heading', { name: 'data.parquet' })).toBeVisible();


      // Default view is Metadata tab — schema column names should be visible in the Schema table
      const schemaTable = page.getByRole('table', { name: 'Schema' });
      await expect(schemaTable.getByRole('cell', { name: 'id' })).toBeVisible();
      await expect(schemaTable.getByRole('cell', { name: 'name' })).toBeVisible();
      await expect(schemaTable.getByRole('cell', { name: 'score' })).toBeVisible();

      // Tabs are visible
      await expect(page.getByRole('tab', { name: 'Metadata' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Data', exact: true })).toBeVisible();

      // Click the Data tab to view the data table
      await page.getByRole('tab', { name: 'Data', exact: true }).click();


      // Parquet preview table with correct aria label
      const table = page.getByRole('table', { name: 'Parquet preview' });
      await expect(table).toBeVisible();

      // Column headers in data table
      await expect(table.locator('th', { hasText: 'id' })).toBeVisible();
      await expect(table.locator('th', { hasText: 'name' })).toBeVisible();
      await expect(table.locator('th', { hasText: 'score' })).toBeVisible();

      // Data rows
      await expect(table.locator('td', { hasText: 'Alice' })).toBeVisible();
      await expect(table.locator('td', { hasText: 'Bob' })).toBeVisible();
      await expect(table.locator('td', { hasText: 'Charlie' })).toBeVisible();

      // File size badge
      await expect(page.locator('.badge', { hasText: /B$/ })).toBeVisible();

      // Close button works
      await page.getByRole('button', { name: 'Close' }).last().click();
      await expect(page.getByRole('heading', { name: 'data.parquet' })).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('previews parquet file with application/x-parquet content type', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-parquet-x');
    const cleanupKeys = [`${prefix}measurements.parquet`];

    try {
      const parquetBase64 =
        'UEFSMRUEFSAVIEwVBBUAEgAAAQAAAAAAAAACAAAAAAAAABUAFRIVEiwVBBUQFQYVBhwYCAIAAAAAAAAAGAgBAAAAAAAAABYAKAgCAAAAAAAAABgIAQAAAAAAAAAREQAAAAIAAAAEAQEDAhUEFSAVIEwVBBUAEgAABQAAAEFsaWNlAwAAAEJvYhUAFRIVEiwVBBUQFQYVBhw2ACgDQm9iGAVBbGljZRERAAAAAgAAAAQBAQMCFQQVIBUgTBUEFQASAAAAAAAAAOBXQAAAAAAAwFVAFQAVEhUSLBUEFRAVBhUGHBgIAAAAAADgV0AYCAAAAAAAwFVAFgAoCAAAAAAA4FdAGAgAAAAAAMBVQBERAAAAAgAAAAQBAQMCFQQVEBUQTBUCFQASAAADAAAAAAAAABUAFRIVEiwVAhUQFQYVBhwYCAMAAAAAAAAAGAgDAAAAAAAAABYAKAgDAAAAAAAAABgIAwAAAAAAAAAREQAAAAIAAAACAQECABUEFRYVFkwVAhUAEgAABwAAAENoYXJsaWUVABUSFRIsFQIVEBUGFQYcNgAoB0NoYXJsaWUYB0NoYXJsaWUREQAAAAIAAAACAQECABUEFRAVEEwVAhUAEgAAMzMzMzMTUkAVABUSFRIsFQIVEBUGFQYcGAgzMzMzMxNSQBgIMzMzMzMTUkAWACgIMzMzMzMTUkAYCDMzMzMzE1JAEREAAAACAAAAAgEBAgAVBBlMNQAYBnNjaGVtYRUGABUEJQIYAmlkABUMJQIYBG5hbWUlAEwcAAAAFQolAhgFc2NvcmUAFgYZLBk8JgAcFQQZNQAGEBkYAmlkFQAWBBbMARbMASZEJggcGAgCAAAAAAAAABgIAQAAAAAAAAAWACgIAgAAAAAAAAAYCAEAAAAAAAAAEREAGSwVBBUAFQIAFQAVEBUCADwpBhkmAAQAAAAmABwVDBk1AAYQGRgEbmFtZRUAFgQWlAEWlAEmkAIm1AEcNgAoA0JvYhgFQWxpY2UREQAZLBUEFQAVAgAVABUQFQIAPBYQGQYZJgAEAAAAJgAcFQoZNQAGEBkYBXNjb3JlFQAWBBbMARbMASakAyboAhwYCAAAAAAA4FdAGAgAAAAAAMBVQBYAKAgAAAAAAOBXQBgIAAAAAADAVUAREQAZLBUEFQAVAgAVABUQFQIAPCkGGSYABAAAABasBBYEJggWrAQAGTwmABwVBBk1AAYQGRgCaWQVABYCFrwBFrwBJuAEJrQEHBgIAwAAAAAAAAAYCAMAAAAAAAAAFgAoCAMAAAAAAAAAGAgDAAAAAAAAABERABksFQQVABUCABUAFRAVAgA8KQYZJgACAAAAJgAcFQwZNQAGEBkYBG5hbWUVABYCFpYBFpYBJqIGJvAFHDYAKAdDaGFybGllGAdDaGFybGllEREAGSwVBBUAFQIAFQAVEBUCADwWDhkGGSYAAgAAACYAHBUKGTUABhAZGAVzY29yZRUAFgIWvAEWvAEmsgcmhgccGAgzMzMzMxNSQBgIMzMzMzMTUkAWACgIMzMzMzMTUkAYCDMzMzMzE1JAEREAGSwVBBUAFQIAFQAVEBUCADwpBhkmAAIAAAAWjgQWAia0BBaOBAAZHBgMQVJST1c6c2NoZW1hGLgCLy8vLy8rQUFBQUFRQUFBQUFBQUtBQXdBQmdBRkFBZ0FDZ0FBQUFBQkJBQU1BQUFBQ0FBSUFBQUFCQUFJQUFBQUJBQUFBQU1BQUFCNEFBQUFPQUFBQUFRQUFBQ2svLy8vQUFBQkF4QUFBQUFjQUFBQUJBQUFBQUFBQUFBRkFBQUFjMk52Y21VQUJnQUlBQVlBQmdBQUFBQUFBZ0RVLy8vL0FBQUJCUkFBQUFBY0FBQUFCQUFBQUFBQUFBQUVBQUFBYm1GdFpRQUFBQUFFQUFRQUJBQUFBQkFBRkFBSUFBWUFCd0FNQUFBQUVBQVFBQUFBQUFBQkFoQUFBQUFjQUFBQUJBQUFBQUFBQUFBQ0FBQUFhV1FBQUFnQURBQUlBQWNBQ0FBQUFBQUFBQUZBQUFBQUFBQUFBQT09ABggcGFycXVldC1jcHAtYXJyb3cgdmVyc2lvbiAyNC4wLjAZPBwAABwAABwAAAAUBAAAUEFSMQ==';

      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}measurements.parquet`,
          Body: Buffer.from(parquetBase64, 'base64'),
          ContentType: 'application/x-parquet'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'measurements.parquet').dblclick();

      await expect(page.getByRole('heading', { name: 'measurements.parquet' })).toBeVisible();

      // Schema column names should be visible in default metadata tab
      await expect(
        page.getByRole('table', { name: 'Schema' }).getByRole('cell', { name: 'name' })
      ).toBeVisible();

      // Click Data tab to view data table
      await page.getByRole('tab', { name: 'Data', exact: true }).click();
      const table = page.getByRole('table', { name: 'Parquet preview' });
      await expect(table).toBeVisible();
      await expect(table.locator('th', { hasText: 'name' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('previews TSV files with table headers and data rows', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-tsv');
    const cleanupKeys = [`${prefix}data.tsv`];

    try {
      const tsvContent = ['name\tcity\tscore', 'Alice\tBerlin\t95', 'Bob\tMunich\t88'].join('\n');

      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}data.tsv`,
        tsvContent,
        'text/tab-separated-values'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'data.tsv').dblclick();

      // Modal heading
      await expect(page.getByRole('heading', { name: 'data.tsv' })).toBeVisible();

      // CSV/TSV table is rendered with correct aria label
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
      await expect(page.getByRole('heading', { name: 'data.tsv' })).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('previews TSV files with quoted fields containing tabs', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-tsv-quoted');
    const cleanupKeys = [`${prefix}notes.tsv`];

    try {
      const tsvContent = ['name\tnotes', 'Alice\t"likes\ttabs\tin\tdata"', 'Bob\tplain text'].join(
        '\n'
      );

      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}notes.tsv`,
        tsvContent,
        'text/tab-separated-values'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'notes.tsv').dblclick();

      await expect(page.getByRole('heading', { name: 'notes.tsv' })).toBeVisible();

      const table = page.getByRole('table', { name: 'CSV preview' });
      await expect(table).toBeVisible();

      // Quoted fields with tabs are parsed correctly
      await expect(table.locator('td', { hasText: 'likes\ttabs\tin\tdata' })).toBeVisible();
      await expect(table.locator('td', { hasText: 'plain text' })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('previews TSV files with application/vnd.ms-excel content type', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-tsv-excel');
    const cleanupKeys = [`${prefix}export.tsv`];

    try {
      const tsvContent = ['product\tprice\tqty', 'Widget\t19.99\t100', 'Gadget\t49.95\t50'].join(
        '\n'
      );

      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}export.tsv`,
          Body: Buffer.from(tsvContent),
          ContentType: 'application/vnd.ms-excel'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'export.tsv').dblclick();

      await expect(page.getByRole('heading', { name: 'export.tsv' })).toBeVisible();

      const table = page.getByRole('table', { name: 'CSV preview' });
      await expect(table).toBeVisible();

      await expect(table.locator('th', { hasText: 'product' })).toBeVisible();
      await expect(table.locator('th', { hasText: 'price' })).toBeVisible();
      await expect(table.locator('th', { hasText: 'qty' })).toBeVisible();

      await expect(table.locator('td', { hasText: 'Widget' })).toBeVisible();
      await expect(table.locator('td', { hasText: '19.99' })).toBeVisible();
      await expect(table.locator('td', { hasText: '100' })).toBeVisible();
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
