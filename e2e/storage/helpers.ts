import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { type GarageCredentials } from '../support/garage.js';
import { waitForHydration } from '../support/helpers.js';

export function uniquePrefix(testInfo: TestInfo, scope: string): string {
  const slug = scope
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${slug}-${testInfo.project.name.toLowerCase()}-${crypto.randomUUID()}/`;
}

export function uniqueBucketName(testInfo: TestInfo, scope: string): string {
  const slug = scope
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `garage-${slug}-${testInfo.project.name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
}

export function bucketRoute(bucket: string, prefix = ''): string {
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

export async function openConnectForm(page: Page) {
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
  if (
    !(await connectHeading.isVisible().catch(() => false)) &&
    (await disconnectButton.isVisible().catch(() => false))
  ) {
    await disconnectButton.click();
  }

  await expect(connectHeading).toBeVisible();
}

export async function connectToStorage(page: Page, credentials: GarageCredentials) {
  await openConnectForm(page);
  await page.getByLabel('Endpoint URL').fill(credentials.endpoint);
  await page.getByLabel('Region').fill(credentials.region);
  await page.getByLabel('Access key ID').fill(credentials.accessKeyId);
  await page.getByLabel('Secret access key').fill(credentials.secretAccessKey);
  await expect(page.getByLabel('Use path-style addressing')).toBeChecked();
  await page.getByRole('button', { name: 'Connect' }).click();
}

export async function connectAndOpenPrefix(
  page: Page,
  credentials: GarageCredentials,
  prefix = ''
) {
  await connectToStorage(page, credentials);
  await expect(page).toHaveURL('/storage');
  await page.goto(bucketRoute(credentials.bucket, prefix));
  await waitForObjectsLoaded(page);
}

/**
 * Wait for the bucket object listing to be ready after a client-side load.
 * With the new architecture, `waitForHydration` alone is insufficient because
 * the object list is fetched client-side after hydration. This waits for either
 * a table row or the empty-state message to appear, confirming the fetch has
 * completed and the UI has updated.
 */
export async function waitForObjectsLoaded(page: Page) {
  await waitForHydration(page);
  await page
    .locator('tbody tr')
    .or(page.getByText('This bucket is empty'))
    .first()
    .waitFor({ timeout: 15_000 });
}

/**
 * Wait for the storage landing page to display the connected state.
 * With the new client-side layout load, navigating to `/storage` initially
 * renders the SSR default (disconnected) state. This waits until the
 * client-side bucket fetch has completed and the connected UI (recent items
 * tabs) is visible.
 */
export async function waitForStorageConnected(page: Page) {
  await waitForHydration(page);
  await expect(page.getByRole('tab', { name: 'Recent Files' })).toBeVisible({ timeout: 15_000 });
}

export async function putTextObject(
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

export async function putDirectoryMarker(client: S3Client, bucket: string, key: string) {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: '' }));
}

export async function deleteKnownKeys(client: S3Client, bucket: string, keys: string[]) {
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

export async function objectExists(
  client: S3Client,
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function getObjectText(
  client: S3Client,
  bucket: string,
  key: string
): Promise<string> {
  const output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!output.Body) {
    throw new Error(`Object ${key} has no body`);
  }

  return output.Body.transformToString();
}

export function rowByName(page: Page, name: string) {
  return page.locator('tbody tr', { hasText: name }).first();
}

export function modalBox(page: Page) {
  return page.locator('.modal-box').last();
}

export async function headObject(client: S3Client, bucket: string, key: string) {
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

// Re-export expect for convenience
export { expect };

/** Seeds the `storage_tabs` localStorage key before the first page load of a
 *  test, simulating a previous session's saved tab state. Because this uses
 *  `addInitScript` it runs on every navigation within the test context, so the
 *  data is available regardless of which page triggers the initial load. */
export async function seedStorageTabsState(
  page: Page,
  state: {
    tabs: Array<{ id: string; label: string; bucket: string; prefix: string }>;
    activeTabId: string;
  }
): Promise<void> {
  await page.addInitScript((data) => {
    localStorage.setItem('storage_tabs', JSON.stringify(data));
  }, state);
}
