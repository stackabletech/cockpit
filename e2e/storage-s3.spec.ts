import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import {
  createGarageBucketCredentials,
  createS3Client,
  hasGarageAdmin,
  hasGarageCredentials,
  requireGarageCredentials,
  type GarageCredentials
} from './garage.js';
import { waitForHydration } from './helpers.js';
import {
  createCsvUploadFixture,
  createImageUploadFixture,
  createTextUploadFixture
} from './storage-upload-fixtures.js';

declare const process: {
  env: Record<string, string | undefined>;
};

function uniquePrefix(testInfo: TestInfo, scope: string): string {
  const slug = scope.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `${slug}-${testInfo.project.name.toLowerCase()}-${crypto.randomUUID()}/`;
}

function uniqueBucketName(testInfo: TestInfo, scope: string): string {
  const slug = scope.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `garage-${slug}-${testInfo.project.name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
}

function bucketRoute(bucket: string, prefix = ''): string {
  if (!prefix) {
    return `/storage/${encodeURIComponent(bucket)}`;
  }

  const trimmed = prefix.replace(/\/$/, '');
  const encoded = trimmed
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `/storage/${encodeURIComponent(bucket)}/${encoded}`;
}

async function openConnectForm(page: Page) {
  await page.goto('/');
  if (new URL(page.url()).pathname.startsWith('/auth/login')) {
    await waitForHydration(page);
    await page.getByRole('button', { name: /sign in with sso/i }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  }

  await page.goto('/storage?disconnected=1');
  await waitForHydration(page);

  const connectHeading = page.getByRole('heading', { name: 'Connect to storage' });
  const disconnectButton = page.getByRole('button', { name: 'Disconnect' });
  if (!(await connectHeading.isVisible().catch(() => false)) &&
    (await disconnectButton.isVisible().catch(() => false))) {
    await disconnectButton.click();
  }

  await expect(connectHeading).toBeVisible();
}

async function connectToStorage(page: Page, credentials: GarageCredentials) {
  await openConnectForm(page);
  await page.getByLabel('Endpoint URL').fill(credentials.endpoint);
  await page.getByLabel('Region').fill(credentials.region);
  await page.getByLabel('Access key ID').fill(credentials.accessKeyId);
  await page.getByLabel('Secret access key').fill(credentials.secretAccessKey);
  await expect(page.getByLabel('Use path-style addressing')).toBeChecked();
  await page.getByRole('button', { name: 'Connect' }).click();
}

async function connectAndOpenPrefix(
  page: Page,
  credentials: GarageCredentials,
  prefix = ''
) {
  await connectToStorage(page, credentials);
  await expect(page).toHaveURL('/storage');
  await page.goto(bucketRoute(credentials.bucket, prefix));
  await waitForHydration(page);
}

async function putTextObject(
  client: S3Client,
  bucket: string,
  key: string,
  body: string,
  contentType = 'text/plain'
) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}

async function putDirectoryMarker(client: S3Client, bucket: string, key: string) {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: '' }));
}

async function deleteKnownKeys(client: S3Client, bucket: string, keys: string[]) {
  const existingKeys = Array.from(new Set(keys.filter(Boolean)));

  if (existingKeys.length === 0) {
    return;
  }

  for (let index = 0; index < existingKeys.length; index += 1000) {
    const chunk = existingKeys.slice(index, index + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((key) => ({ Key: key })),
          Quiet: true
        }
      })
    );
  }
}

async function objectExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function getObjectText(client: S3Client, bucket: string, key: string): Promise<string> {
  const output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!output.Body) {
    throw new Error(`Object ${key} has no body`);
  }

  return output.Body.transformToString();
}

function rowByName(page: Page, name: string) {
  return page.locator('tbody tr', { hasText: name }).first();
}

function modalBox(page: Page) {
  return page.locator('.modal-box').last();
}

async function headObject(client: S3Client, bucket: string, key: string) {
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Live S3 integration tests against a real Garage instance.
 *
 * These tests only run when s3-config.json exists in the project root —
 * written by the "Start Garage S3 and initialize bucket" CI step. They are
 * automatically skipped in all other environments.
 *
 * The global setup (global-setup.ts) reads s3-config.json and exposes its
 * values as S3_TEST_* environment variables.
 */
test.describe('Storage S3 (Garage)', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('connects to Garage S3 bucket and lists buckets', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);

    await expect(page).toHaveURL('/storage');
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Buckets' })).toBeVisible();
    await expect(main.getByRole('link', { name: credentials.bucket, exact: true })).toBeVisible();
  });

  test('shows an error for invalid Garage credentials', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await openConnectForm(page);
    await page.getByLabel('Endpoint URL').fill(credentials.endpoint);
    await page.getByLabel('Region').fill(credentials.region);
    await page.getByLabel('Access key ID').fill(credentials.accessKeyId);
    await page.getByLabel('Secret access key').fill(`${credentials.secretAccessKey}-wrong`);
    await page.getByRole('button', { name: 'Connect' }).click();

    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
    await expect(page.getByText('Could not connect — check the endpoint and credentials.')).toBeVisible();
  });

  test('browses nested folders, uses breadcrumbs, and shows empty folders', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'browse');
    const cleanupKeys = [
      `${prefix}notes.txt`,
      `${prefix}reports/2026/q1.csv`,
      `${prefix}reports/2026/q2.csv`,
      `${prefix}empty-folder/`
    ];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}notes.txt`, 'root note');
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}reports/2026/q1.csv`,
        'quarter,revenue\n1,100\n',
        'text/csv'
      );
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}reports/2026/q2.csv`,
        'quarter,revenue\n2,200\n',
        'text/csv'
      );
      await putDirectoryMarker(client, credentials.bucket, `${prefix}empty-folder/`);

      await connectAndOpenPrefix(page, credentials, prefix);

      await expect(rowByName(page, 'notes.txt')).toBeVisible();
      await expect(rowByName(page, 'reports')).toBeVisible();
      await expect(rowByName(page, 'empty-folder')).toBeVisible();

      await rowByName(page, 'reports').click();
      await expect(rowByName(page, '2026')).toBeVisible();

      await rowByName(page, '2026').click();
      await expect(rowByName(page, 'q1.csv')).toBeVisible();
      await expect(rowByName(page, 'q2.csv')).toBeVisible();

      await page.getByRole('button', { name: 'reports' }).click();
      await expect(rowByName(page, '2026')).toBeVisible();
      await expect(rowByName(page, 'q1.csv')).not.toBeVisible();

      await rowByName(page, '...').click();
      await expect(rowByName(page, 'empty-folder')).toBeVisible();

      await rowByName(page, 'empty-folder').click();
      await expect(page.getByText('This bucket is empty')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('paginates bucket listings', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'paginate');
    const cleanupKeys: string[] = [];

    try {
      for (let index = 1; index <= 30; index += 1) {
        const fileName = `file-${String(index).padStart(2, '0')}.txt`;
        const key = `${prefix}${fileName}`;
        cleanupKeys.push(key);
        await putTextObject(client, credentials.bucket, key, `content ${index}`);
      }

      await connectAndOpenPrefix(page, credentials, prefix);

      await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
      await expect(rowByName(page, 'file-01.txt')).toBeVisible();
      await expect(rowByName(page, 'file-26.txt')).not.toBeVisible();

      await page.getByRole('button', { name: 'Next page' }).click();
      await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
      await expect(rowByName(page, 'file-26.txt')).toBeVisible();
      await expect(rowByName(page, 'file-01.txt')).not.toBeVisible();

      await page.getByRole('button', { name: 'Previous page' }).click();
      await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
      await expect(rowByName(page, 'file-01.txt')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
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

  test('uploads realistic faker-generated text, csv, and image files', async ({ page }, testInfo) => {
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
      await uploadModal.locator('input[aria-label="Select files"]').setInputFiles([
        textFixture,
        csvFixture,
        imageFixture
      ]);
      await uploadModal.getByRole('button', { name: 'Upload' }).click();
      await expect(uploadModal.getByText('Upload complete')).toBeVisible();
      await expect(uploadModal.getByText('3 uploaded · 0 skipped · 0 failed')).toBeVisible();
      await uploadModal.getByRole('button', { name: 'Done' }).click();

      await expect(rowByName(page, textFixture.name)).toBeVisible();
      await expect(rowByName(page, csvFixture.name)).toBeVisible();
      await expect(rowByName(page, imageFixture.name)).toBeVisible();

      await expect(await getObjectText(client, credentials.bucket, `${prefix}${textFixture.name}`)).toContain(
        textFixture.expectedSnippet
      );
      await expect(await getObjectText(client, credentials.bucket, `${prefix}${csvFixture.name}`)).toContain(
        csvFixture.expectedCell
      );

      await expect((await headObject(client, credentials.bucket, `${prefix}${textFixture.name}`)).ContentType).toBe(
        'text/plain'
      );
      await expect((await headObject(client, credentials.bucket, `${prefix}${csvFixture.name}`)).ContentType).toBe(
        'text/csv'
      );
      await expect((await headObject(client, credentials.bucket, `${prefix}${imageFixture.name}`)).ContentType).toBe(
        'image/svg+xml'
      );

      await rowByName(page, textFixture.name).dblclick();
      await expect(page.getByRole('heading', { name: textFixture.name })).toBeVisible();
      await expect(page.getByText(textFixture.expectedSnippet)).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).last().click();

      await rowByName(page, csvFixture.name).dblclick();
      await expect(page.getByRole('heading', { name: csvFixture.name })).toBeVisible();
      await expect(page.getByText(csvFixture.expectedCell)).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).last().click();

      await rowByName(page, imageFixture.name).dblclick();
      await expect(page.getByRole('heading', { name: imageFixture.name })).toBeVisible();
      await expect(page.getByAltText(`Preview of ${imageFixture.name}`)).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).last().click();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('uploads files and resolves replace, skip, and rename conflicts', async ({ page }, testInfo) => {
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

      await uploadModal.locator('li', { hasText: 'replace.txt' }).getByRole('button', { name: 'Replace' }).click();
      await uploadModal.locator('li', { hasText: 'skip.txt' }).getByRole('button', { name: 'Skip' }).click();

      const renameItem = uploadModal.locator('li', { hasText: 'taken.txt' });
      await renameItem.getByRole('button', { name: 'Rename' }).click();
      await renameItem.getByLabel('New file name').fill('already-here.txt');
      await renameItem.getByRole('button', { name: 'Confirm name' }).click();
      await expect(renameItem.getByText('This name already exists here. Please choose a different name.')).toBeVisible();

      await renameItem.getByLabel('New file name').fill('renamed.txt');
      await renameItem.getByRole('button', { name: 'Confirm name' }).click();

      await uploadModal.getByRole('button', { name: 'Upload' }).click();
      await expect(uploadModal.getByText('Upload complete')).toBeVisible();
      await expect(uploadModal.getByText('3 uploaded · 1 skipped · 0 failed')).toBeVisible();
      await uploadModal.getByRole('button', { name: 'Done' }).click();

      await expect(rowByName(page, 'fresh.txt')).toBeVisible();
      await expect(rowByName(page, 'renamed.txt')).toBeVisible();

      await expect(await getObjectText(client, credentials.bucket, `${prefix}replace.txt`)).toBe('new replace');
      await expect(await getObjectText(client, credentials.bucket, `${prefix}skip.txt`)).toBe('old skip');
      await expect(await getObjectText(client, credentials.bucket, `${prefix}taken.txt`)).toBe('old taken');
      await expect(await getObjectText(client, credentials.bucket, `${prefix}renamed.txt`)).toBe('new taken');
      await expect(await getObjectText(client, credentials.bucket, `${prefix}fresh.txt`)).toBe('brand new');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('deletes files and folders recursively', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'delete');
    const cleanupKeys = [`${prefix}remove-me.txt`, `${prefix}archive/nested.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}remove-me.txt`, 'remove');
      await putTextObject(client, credentials.bucket, `${prefix}archive/nested.txt`, 'nested');

      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select remove-me.txt').check();
      await page.getByLabel('Select archive').check();

      await page.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByText('All contents will be permanently deleted')).toBeVisible();
      await page.getByRole('button', { name: 'Delete permanently' }).click();

      await expect(page.getByText('This bucket is empty')).toBeVisible();
      await expect(await objectExists(client, credentials.bucket, `${prefix}remove-me.txt`)).toBe(false);
      await expect(await objectExists(client, credentials.bucket, `${prefix}archive/nested.txt`)).toBe(false);
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('surfaces real Garage permission errors for a read-only bucket', async ({ page }, testInfo) => {
    test.skip(!hasGarageAdmin(), 'Skipped: Garage admin API is unavailable for per-test bucket setup');

    const baseCredentials = requireGarageCredentials();
    const adminClient = createS3Client(baseCredentials);
    const restrictedBucket = uniqueBucketName(testInfo, 'readonly');
    const restrictedCredentials = await createGarageBucketCredentials(baseCredentials, {
      bucketName: restrictedBucket,
      keyName: `readonly-${testInfo.project.name}-${crypto.randomUUID()}`,
      permissions: { owner: false, read: true, write: false },
      ownerAccessKeyId: baseCredentials.accessKeyId
    });
    const uploadFixture = createTextUploadFixture(`${testInfo.title}-readonly-upload`);
    const existingKey = 'existing.txt';
    const blockedKey = uploadFixture.name;

    try {
      await putTextObject(adminClient, restrictedBucket, existingKey, 'keep me');

      await connectAndOpenPrefix(page, restrictedCredentials);
      await expect(rowByName(page, existingKey)).toBeVisible();

      await page.getByRole('button', { name: 'Upload' }).click();
      const uploadModal = modalBox(page);
      await uploadModal.locator('input[aria-label="Select files"]').setInputFiles(uploadFixture);
      await uploadModal.getByRole('button', { name: 'Upload' }).click();
      await expect(uploadModal.getByText('Upload complete')).toBeVisible();
      await expect(uploadModal.getByText('Access denied. You do not have permission to upload here.')).toBeVisible();
      await uploadModal.getByRole('button', { name: 'Done' }).click();
      await expect(await objectExists(adminClient, restrictedBucket, blockedKey)).toBe(false);

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel(`Select ${existingKey}`).check();
      await page.getByRole('button', { name: 'Delete' }).click();
      await page.getByRole('button', { name: 'Delete permanently' }).click();

      const errorToast = page
        .getByRole('alert')
        .filter({ hasText: 'Access denied. You do not have permission to delete this item.' });
      await expect(errorToast).toBeVisible();
      await expect(rowByName(page, existingKey)).toBeVisible();
      await expect(await getObjectText(adminClient, restrictedBucket, existingKey)).toBe('keep me');
    } finally {
      await deleteKnownKeys(adminClient, restrictedBucket, [existingKey, blockedKey]);
    }
  });

  // ── Permission scenarios ───────────────────────────────────────────────────

  test('shows access denied error when browsing a write-only bucket', async ({ page }, testInfo) => {
    test.skip(!hasGarageAdmin(), 'Skipped: Garage admin API is unavailable for per-test bucket setup');

    const baseCredentials = requireGarageCredentials();
    const writeonlyBucket = uniqueBucketName(testInfo, 'writeonly');
    const writeonlyCredentials = await createGarageBucketCredentials(baseCredentials, {
      bucketName: writeonlyBucket,
      keyName: `writeonly-${testInfo.project.name}-${crypto.randomUUID()}`,
      permissions: { owner: false, read: false, write: true },
      ownerAccessKeyId: baseCredentials.accessKeyId
    });

    await connectToStorage(page, writeonlyCredentials);
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();

    await page.goto(bucketRoute(writeonlyBucket));

    await expect(page.getByText('403')).toBeVisible();
    await expect(
      page.getByText('You do not have permission to access the bucket')
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to storage' })).toBeVisible();
  });

  test('shows access denied error when browsing a no-access bucket', async ({ page }, testInfo) => {
    test.skip(!hasGarageAdmin(), 'Skipped: Garage admin API is unavailable for per-test bucket setup');

    const baseCredentials = requireGarageCredentials();
    const noAccessBucket = uniqueBucketName(testInfo, 'noaccess');
    const noAccessCredentials = await createGarageBucketCredentials(baseCredentials, {
      bucketName: noAccessBucket,
      keyName: `noaccess-${testInfo.project.name}-${crypto.randomUUID()}`,
      permissions: { owner: false, read: false, write: false },
      ownerAccessKeyId: baseCredentials.accessKeyId
    });

    await connectToStorage(page, noAccessCredentials);
    await page.goto(bucketRoute(noAccessBucket));

    await expect(page.getByText('403')).toBeVisible();
    await expect(
      page.getByText('You do not have permission to access the bucket')
    ).toBeVisible();
  });

  // ── Selection and bulk operations ──────────────────────────────────────────

  test('cancel delete does not remove the selected file', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'cancel-delete');
    const cleanupKeys = [`${prefix}keep-me.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}keep-me.txt`, 'do not delete');

      await connectAndOpenPrefix(page, credentials, prefix);
      await expect(rowByName(page, 'keep-me.txt')).toBeVisible();

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select keep-me.txt').check();
      await page.getByRole('button', { name: 'Delete' }).click();

      await expect(page.getByText('This action cannot be undone.')).toBeVisible();

      await page.getByRole('button', { name: 'Cancel' }).click();

      await expect(page.getByText('This action cannot be undone.')).not.toBeVisible();
      await expect(rowByName(page, 'keep-me.txt')).toBeVisible();
      await expect(await objectExists(client, credentials.bucket, `${prefix}keep-me.txt`)).toBe(
        true
      );
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('selects all items and deselects them with the header checkbox', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'select-all');
    const cleanupKeys = [`${prefix}alpha.txt`, `${prefix}beta.txt`, `${prefix}sub/`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}alpha.txt`, 'a');
      await putTextObject(client, credentials.bucket, `${prefix}beta.txt`, 'b');
      await putDirectoryMarker(client, credentials.bucket, `${prefix}sub/`);

      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();

      const selectAll = page.getByLabel('Select all');
      await selectAll.check();

      await expect(page.getByLabel('Select alpha.txt')).toBeChecked();
      await expect(page.getByLabel('Select beta.txt')).toBeChecked();
      await expect(page.getByLabel('Select sub')).toBeChecked();

      await selectAll.uncheck();

      await expect(page.getByLabel('Select alpha.txt')).not.toBeChecked();
      await expect(page.getByLabel('Select beta.txt')).not.toBeChecked();
      await expect(page.getByLabel('Select sub')).not.toBeChecked();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  // ── Context menu ───────────────────────────────────────────────────────────

  test('context menu appears on right-click and shows file actions', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-menu');
    const cleanupKeys = [`${prefix}ctx-file.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}ctx-file.txt`, 'menu test');

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'ctx-file.txt').click({ button: 'right' });

      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Preview' })).toBeEnabled();
      await expect(menu.getByRole('menuitem', { name: 'Download' })).toBeEnabled();
      await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeEnabled();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('context menu closes when the Escape key is pressed', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-escape');
    const cleanupKeys = [`${prefix}escape-test.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}escape-test.txt`,
        'escape test'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'escape-test.txt').click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(page.getByRole('menu')).not.toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('deletes a single file via context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'ctx-delete');
    const cleanupKeys = [`${prefix}ctx-del.txt`];

    try {
      await putTextObject(client, credentials.bucket, `${prefix}ctx-del.txt`, 'delete me');

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'ctx-del.txt').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Delete' }).click();

      await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeVisible();
      await page.getByRole('button', { name: 'Delete permanently' }).click();

      await expect(page.getByText('This bucket is empty')).toBeVisible();
      await expect(await objectExists(client, credentials.bucket, `${prefix}ctx-del.txt`)).toBe(
        false
      );
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  // ── Downloads ──────────────────────────────────────────────────────────────

  test('downloads a file via the selection toolbar', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dl-toolbar');
    const cleanupKeys = [`${prefix}download-me.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}download-me.txt`,
        'download content'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await page.getByRole('button', { name: 'Toggle selection mode' }).click();
      await page.getByLabel('Select download-me.txt').check();

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download', exact: true }).click()
      ]);

      expect(download.suggestedFilename()).toBe('download-me.txt');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('downloads a file via the context menu', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'dl-ctx');
    const cleanupKeys = [`${prefix}ctx-download.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}ctx-download.txt`,
        'ctx download content'
      );

      await connectAndOpenPrefix(page, credentials, prefix);

      await rowByName(page, 'ctx-download.txt').click({ button: 'right' });

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('menuitem', { name: 'Download' }).click()
      ]);

      expect(download.suggestedFilename()).toBe('ctx-download.txt');
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  // ── Preview edge cases ─────────────────────────────────────────────────────

  test('shows fallback preview for a known binary file type', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-zip');
    const cleanupKeys = [`${prefix}archive.zip`];

    try {
      // Upload a ZIP-typed file (in KNOWN_BINARY_TYPES — server skips body fetch)
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
      await expect(
        page.getByRole('link', { name: 'Download full file' })
      ).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  test('shows binary fallback preview for non-decodable binary content', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'preview-bin');
    const cleanupKeys = [`${prefix}data.bin`];

    try {
      // Invalid UTF-8 bytes — server streams them back; client detects binary
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
      await expect(
        page.getByRole('link', { name: 'Download full file' })
      ).toBeVisible();
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

  // ── Bucket grid navigation ─────────────────────────────────────────────────

  test('clicking a bucket tile in the grid navigates to the bucket explorer', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    const bucketLink = page.locator('main').getByRole('link', { name: credentials.bucket, exact: true });
    await expect(bucketLink).toBeVisible();
    await bucketLink.click();

    await expect(page).toHaveURL(bucketRoute(credentials.bucket));
    await expect(
      page.locator('nav[aria-label="breadcrumb"] [aria-current="page"]')
    ).toContainText(credentials.bucket);
  });

  // ── Saved connections ──────────────────────────────────────────────────────

  test('saves a connection and reconnects from the saved connections list', async ({ page }) => {
    const credentials = requireGarageCredentials();

    // Connect — this saves the connection to localStorage on successful redirect
    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    // openConnectForm properly disconnects server-side and shows the connect form
    await openConnectForm(page);

    const savedList = page.getByRole('list', { name: 'Saved connections' });
    await expect(savedList).toBeVisible();

    // Click the first saved connection chip to auto-fill and submit the form
    await savedList.getByRole('listitem').first().getByRole('button').first().click();

    // Should reconnect and land on the storage page
    await expect(page).toHaveURL('/storage');
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();
  });

  test('forgets a saved connection via the remove button', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page).toHaveURL('/storage');

    // openConnectForm properly disconnects server-side and shows the connect form
    await openConnectForm(page);

    const savedList = page.getByRole('list', { name: 'Saved connections' });
    await expect(savedList).toBeVisible();

    // Click the Forget (×) button on the chip
    await savedList.getByRole('listitem').first().getByRole('button').last().click();

    // Confirm in the forget dialog
    await expect(page.getByRole('button', { name: 'Forget', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Forget', exact: true }).click();

    // The saved connection chip should be gone
    await expect(savedList).not.toBeVisible();
    await expect(page.getByText('No saved connections yet')).toBeVisible();
  });

  // ── Recent items ───────────────────────────────────────────────────────────

  test('tracks recently visited locations in the Recent Locations tab', async ({ page }) => {
    const credentials = requireGarageCredentials();

    // Connect and navigate to the bucket to record a location visit
    await connectToStorage(page, credentials);
    await page.goto(bucketRoute(credentials.bucket));
    await waitForHydration(page);

    // Go back to the storage home
    await page.goto('/storage');
    await waitForHydration(page);

    // Switch to the Recent Locations tab
    await page.getByRole('tab', { name: 'Recent Locations' }).click();

    // The visited bucket should appear in the table
    await expect(
      page.locator('tbody').getByRole('link', { name: credentials.bucket }).first()
    ).toBeVisible();
  });

  test('tracks recently accessed files in the Recent Files tab', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'recent-files');
    const cleanupKeys = [`${prefix}recent.txt`];

    try {
      await putTextObject(
        client,
        credentials.bucket,
        `${prefix}recent.txt`,
        'recently accessed'
      );

      // Connect, navigate to prefix, and preview the file (records a file visit)
      await connectAndOpenPrefix(page, credentials, prefix);
      await rowByName(page, 'recent.txt').dblclick();
      await expect(page.getByRole('heading', { name: 'recent.txt' })).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).last().click();

      // Go back to the storage home
      await page.goto('/storage');
      await waitForHydration(page);

      // The Recent Files tab should show the previewed file
      const filesTab = page.getByRole('tab', { name: 'Recent Files' });
      await expect(filesTab).toBeVisible();
      // Recent Files is the default active tab
      await expect(page.locator('tbody').getByText('recent.txt')).toBeVisible();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  // ── Pagination ─────────────────────────────────────────────────────────────

  test('changes the page size and shows more items per page', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'page-size');
    const cleanupKeys: string[] = [];

    try {
      for (let index = 1; index <= 30; index += 1) {
        const key = `${prefix}item-${String(index).padStart(2, '0')}.txt`;
        cleanupKeys.push(key);
        await putTextObject(client, credentials.bucket, key, `item ${index}`);
      }

      await connectAndOpenPrefix(page, credentials, prefix);

      // Default page size is 25 — item-26 should not be visible
      await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
      await expect(rowByName(page, 'item-01.txt')).toBeVisible();
      await expect(rowByName(page, 'item-26.txt')).not.toBeVisible();

      // Change page size to 50 — all 30 items should now be visible
      await page.getByLabel('Items per page').selectOption('50');

      await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
      await expect(rowByName(page, 'item-01.txt')).toBeVisible();
      await expect(rowByName(page, 'item-26.txt')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    } finally {
      await deleteKnownKeys(client, credentials.bucket, cleanupKeys);
    }
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────

  test('disconnects from Garage S3', async ({ page }) => {
    const credentials = requireGarageCredentials();

    await connectToStorage(page, credentials);
    await expect(page.locator('main').getByRole('heading', { name: 'Buckets' })).toBeVisible();

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('heading', { name: 'Connect to storage' })).toBeVisible();
  });
});
