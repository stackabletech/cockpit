import { PutObjectCommand } from '@aws-sdk/client-s3';
import { test, expect } from '@playwright/test';
import AdmZip from 'adm-zip';
import {
  createS3Client,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  connectAndOpenPrefix,
  deleteKnownKeys,
  rowByName,
  uniquePrefix,
  waitForObjectsLoaded
} from './helpers.js';

function makeZip(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content, 'utf-8'));
  }
  return Buffer.from(zip.toBuffer());
}

function makeRar(): Buffer {
  // Small RAR 4 fixture from node-unrar-js testFiles/FileEncByName.rar.
  return Buffer.from(
    'UmFyIRoHAM+QcwAADQAAAAAAAABM+HQgkC4ABQAAAAUAAAACGSCKVxahg0odMAkAIAAAADFGaWxlLnR4dADwkOgEMUZpbGXcMHQkljwAIAAAAA8AAAACWwPYnCmhg0odMw8AIAAAADI/Py50eHQAThsyLYdlAiaSyWh4aKAhAPAmEhjfoJzHB5cWF7CjVyDJLLQscUep4830hwRH/3ogjuHVEcKUdCSUNQAQAAAABQAAAAJKlGwtVZ+DSh0zCAAgAAAAM1NlYy50eHT5pxtn2Ow6MACwWMggPeh+dGs0RwexfVSgel2k3cQ9ewBABwA=',
    'base64'
  );
}

test.describe('Storage S3 — Archive preview', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('opens archive with generic content type and shows its contents', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'archive-open');
    const zipBuffer = makeZip({
      'README.md': '# Archive test',
      'data/notes.txt': 'some notes',
      'data/results.csv': 'a,b,c\n1,2,3'
    });
    const cleanupKeys = [`${prefix}archive.zip`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}archive.zip`,
          Body: zipBuffer,
          ContentType: 'application/octet-stream'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      // Double-click the archive file
      await rowByName(page, 'archive.zip').dblclick();
      await waitForObjectsLoaded(page);

      // Should see archive contents — top-level folder and file
      await expect(rowByName(page, 'README.md')).toBeVisible();
      await expect(rowByName(page, 'data')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('opens RAR archive and previews a contained file', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'archive-rar');
    const cleanupKeys = [`${prefix}archive.rar`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}archive.rar`,
          Body: makeRar(),
          ContentType: 'binary/octet-stream'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'archive.rar').dblclick();
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, '1File.txt')).toBeVisible();

      await rowByName(page, '1File.txt').dblclick();
      await expect(page.getByRole('heading', { name: '1File.txt' })).toBeVisible();
      await expect(page.getByText('1File', { exact: true })).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('navigates into directories within archive', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'archive-navigate');
    const zipBuffer = makeZip({
      'a/b/c/file.txt': 'deep',
      'a/b/other.txt': 'other',
      'a/root.txt': 'root'
    });
    const cleanupKeys = [`${prefix}archive.zip`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}archive.zip`,
          Body: zipBuffer,
          ContentType: 'application/zip'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'archive.zip').dblclick();
      await waitForObjectsLoaded(page);

      // Navigate into a/
      await rowByName(page, 'a').click();
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, 'root.txt')).toBeVisible();
      await expect(rowByName(page, 'b')).toBeVisible();

      // Navigate into b/
      await rowByName(page, 'b').click();
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, 'other.txt')).toBeVisible();
      await expect(rowByName(page, 'c')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('previews text file inside archive', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'archive-preview');
    const zipBuffer = makeZip({
      'hello.txt': 'Hello from inside archive!'
    });
    const cleanupKeys = [`${prefix}archive.zip`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}archive.zip`,
          Body: zipBuffer,
          ContentType: 'application/zip'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'archive.zip').dblclick();
      await waitForObjectsLoaded(page);

      // Double-click the text file inside archive
      await rowByName(page, 'hello.txt').dblclick();

      // Preview modal should show the file content
      await expect(page.getByRole('heading', { name: 'hello.txt' })).toBeVisible();
      await expect(page.getByText('Hello from inside archive!')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('exits archive via containing-folder breadcrumb and requests fresh data', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'archive-exit-same-location');
    const cleanupKeys = [`${prefix}archive.zip`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}archive.zip`,
          Body: makeZip({ 'file.txt': 'content' }),
          ContentType: 'application/octet-stream'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      const originalUrl = page.url();
      await rowByName(page, 'archive.zip').dblclick();
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, 'file.txt')).toBeVisible();

      const listingResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/storage/list' && url.searchParams.get('prefix') === prefix;
      });
      const folderName = prefix.split('/').filter(Boolean).at(-1)!;
      await page
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByRole('button', { name: folderName, exact: true })
        .click();
      expect((await listingResponse).ok()).toBe(true);
      await waitForObjectsLoaded(page);
      await expect(page).toHaveURL((url) => url.pathname === new URL(originalUrl).pathname);
      await expect(rowByName(page, 'archive.zip')).toBeVisible();
      await expect(rowByName(page, 'file.txt')).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('exits archive via breadcrumb bucket click', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'archive-exit');
    const zipBuffer = makeZip({ 'file.txt': 'content' });
    const cleanupKeys = [`${prefix}archive.zip`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}archive.zip`,
          Body: zipBuffer,
          ContentType: 'application/zip'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'archive.zip').dblclick();
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, 'file.txt')).toBeVisible();

      // Click bucket name in breadcrumb to exit archive
      await page.getByRole('button', { name: credentials.bucket }).click();
      await waitForObjectsLoaded(page);

      // Should be at the bucket root (archive exited)

      await expect(page).toHaveURL((url) => {
        const endpoint = new URL(credentials.endpoint);
        return url.pathname === `/storage/browse/${endpoint.hostname}/${credentials.bucket}`;
      });
      await expect(page.getByText('archive.zip')).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('exits archive via parent directory row', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'archive-exit-parent');
    const zipBuffer = makeZip({ 'inner/file.txt': 'content' });
    const cleanupKeys = [`${prefix}archive.zip`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}archive.zip`,
          Body: zipBuffer,
          ContentType: 'application/zip'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'archive.zip').dblclick();
      await waitForObjectsLoaded(page);

      // Navigate into inner/
      await rowByName(page, 'inner').click();
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, 'file.txt')).toBeVisible();

      // Click parent directory ...
      await rowByName(page, '...').click();
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, 'inner')).toBeVisible();

      // Click ... again at archive root to exit
      await rowByName(page, '...').click();
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, 'archive.zip')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('opens nested archive inside another archive', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'archive-nested');

    // Create inner zip
    const innerZip = new AdmZip();
    innerZip.addFile('nested.txt', Buffer.from('nested content', 'utf-8'));
    const innerBuf = Buffer.from(innerZip.toBuffer());

    // Create outer zip containing the inner zip
    const outerZip = new AdmZip();
    outerZip.addFile('outer.txt', Buffer.from('outer content', 'utf-8'));
    outerZip.addFile('inner_archive.zip', innerBuf);
    const outerBuf = Buffer.from(outerZip.toBuffer());

    const cleanupKeys = [`${prefix}outer.zip`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}outer.zip`,
          Body: outerBuf,
          ContentType: 'application/zip'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'outer.zip').dblclick();
      await waitForObjectsLoaded(page);

      // Should see outer archive contents
      await expect(rowByName(page, 'outer.txt')).toBeVisible();
      await expect(rowByName(page, 'inner_archive.zip')).toBeVisible();

      // Double-click the nested archive to enter it
      await rowByName(page, 'inner_archive.zip').dblclick();
      await waitForObjectsLoaded(page);

      // Should see nested archive contents
      await expect(rowByName(page, 'nested.txt')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('shows archive breadcrumb and navigates back to archive root', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'archive-breadcrumb');
    const zipBuffer = makeZip({
      'sub/readme.txt': 'hello',
      'sub/deep/doc.md': '# doc'
    });
    const cleanupKeys = [`${prefix}archive.zip`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}archive.zip`,
          Body: zipBuffer,
          ContentType: 'application/zip'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'archive.zip').dblclick();
      await waitForObjectsLoaded(page);

      // Navigate into sub/
      await rowByName(page, 'sub').click();
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, 'readme.txt')).toBeVisible();

      // Navigate into deep/
      await rowByName(page, 'deep').click();
      await waitForObjectsLoaded(page);
      await expect(rowByName(page, 'doc.md')).toBeVisible();

      // Click archive name in breadcrumb to go back to archive root
      await page.getByRole('button', { name: 'archive.zip' }).click();
      await waitForObjectsLoaded(page);

      // Should see archive root contents
      await expect(rowByName(page, 'sub')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('previews image file inside archive', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'archive-image');
    const svgContent =
      '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="blue"/></svg>';
    const zipBuffer = makeZip({ 'diagram.svg': svgContent });
    const cleanupKeys = [`${prefix}archive.zip`];

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: credentials.bucket,
          Key: `${prefix}archive.zip`,
          Body: zipBuffer,
          ContentType: 'application/zip'
        })
      );

      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'archive.zip').dblclick();
      await waitForObjectsLoaded(page);

      // Double-click the SVG file
      await rowByName(page, 'diagram.svg').dblclick();

      // Preview modal should show image
      await expect(page.getByRole('heading', { name: 'diagram.svg' })).toBeVisible();
      await expect(page.getByAltText('Preview of diagram.svg')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });
});
