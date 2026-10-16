import { test, expect, type Page, type TestInfo } from '../support/fixtures.js';
import { ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import {
  createGarageBucketCredentials,
  createS3Client,
  hasGarageAdmin,
  hasGarageCredentials,
  requireGarageCredentials
} from '../support/garage.js';
import {
  bucketRoute,
  connectAndOpenPrefix,
  deleteKnownKeys,
  getObjectText,
  objectExists,
  putDirectoryMarker,
  putTextObject,
  rowByName,
  uniqueBucketName,
  waitForObjectsLoaded,
  uniquePrefix
} from './helpers.js';

/** Every key under `prefix`, sorted. */
async function listKeys(client: S3Client, bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys.sort();
}

/** Objects in a folder that a cancel test moves; enough that copying takes far longer than a cancel. */
const CANCEL_OBJECTS = 1000;

async function putMany(client: S3Client, bucket: string, prefix: string, count: number) {
  for (let start = 0; start < count; start += 50) {
    await Promise.all(
      Array.from({ length: Math.min(50, count - start) }, (_, i) =>
        putTextObject(client, bucket, `${prefix}${start + i}.txt`, String(start + i))
      )
    );
  }
}

async function deletePrefix(client: S3Client, bucket: string, prefix: string) {
  await deleteKnownKeys(client, bucket, await listKeys(client, bucket, prefix));
}

/** Open a folder in-app (keeping the in-memory clipboard) and wait for its listing. */
async function openFolder(page: Page, name: string) {
  const url = page.url();
  await rowByName(page, name).dblclick();
  await expect(page).not.toHaveURL(url);
  await waitForObjectsLoaded(page);
}

/** Open a bucket from the sidebar in-app and wait for its listing. */
async function openBucket(page: Page, bucket: string) {
  await page.getByRole('link', { name: bucket, exact: true }).last().click();
  await expect(page).toHaveURL((url) =>
    url.pathname.replace(/\/$/, '').endsWith(`/${encodeURIComponent(bucket)}`)
  );
  await waitForObjectsLoaded(page);
}

/** Go one folder up via the ".." row, keeping the in-memory clipboard. */
async function goUp(page: Page) {
  await page.locator('tbody tr').first().click();
}

/**
 * Paste with Ctrl+V. Focus is cleared first (the shortcuts also apply when
 * nothing has focus): clicking the table could hit a row and navigate.
 */
async function pasteHere(page: Page) {
  await waitForObjectsLoaded(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+v');
}

async function contextAction(page: Page, name: string, action: string) {
  await rowByName(page, name).click({ button: 'right' });
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

/**
 * Call a storage API from the page with the active connection, as the app does.
 * The connection ID is taken from the app's own listing request.
 */
async function connectionHeader(page: Page): Promise<Record<string, string>> {
  const request = page.waitForRequest((r) => r.url().includes('/api/storage/list'));
  await page.reload();
  const headers = (await request).headers();
  return { 'x-storage-connection-id': headers['x-storage-connection-id'] };
}

test.describe('Storage S3 — Transfers', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(() => {
    test.skip(
      !hasGarageCredentials(),
      'Skipped: no s3-config.json found (requires a running Garage instance)'
    );
  });

  test('keep both pastes a conflicting folder as a numbered copy with its full structure', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'keep-both-folder');

    try {
      await putDirectoryMarker(client, credentials.bucket, `${prefix}src/docs/`);
      await putTextObject(client, credentials.bucket, `${prefix}src/docs/a.txt`, 'a');
      await putTextObject(client, credentials.bucket, `${prefix}src/docs/sub/b.txt`, 'b');
      await putTextObject(client, credentials.bucket, `${prefix}dest/docs/old.txt`, 'old');

      await connectAndOpenPrefix(page, credentials, `${prefix}src/`);
      await contextAction(page, 'docs', 'Copy');
      await goUp(page);
      await openFolder(page, 'dest');
      await expect(rowByName(page, 'docs')).toBeVisible();
      await pasteHere(page);

      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Keep both' }).click();
      await dialog.getByRole('button', { name: 'Paste', exact: true }).click();

      await expect(page.getByText('1 item pasted')).toBeVisible();
      expect(await listKeys(client, credentials.bucket, `${prefix}dest/`)).toEqual([
        `${prefix}dest/docs (1)/`,
        `${prefix}dest/docs (1)/a.txt`,
        `${prefix}dest/docs (1)/sub/b.txt`,
        `${prefix}dest/docs/old.txt`
      ]);
    } finally {
      await deletePrefix(client, credentials.bucket, prefix);
    }
  });

  test('a cut folder pasted twice keeps its structure (F2)', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'cut-twice');

    try {
      await putTextObject(client, credentials.bucket, `${prefix}docs/a.txt`, 'a');
      await putTextObject(client, credentials.bucket, `${prefix}docs/sub/b.txt`, 'b');
      await putDirectoryMarker(client, credentials.bucket, `${prefix}d1/`);
      await putDirectoryMarker(client, credentials.bucket, `${prefix}d2/`);

      await connectAndOpenPrefix(page, credentials, prefix);
      await contextAction(page, 'docs', 'Cut');
      await openFolder(page, 'd1');
      await pasteHere(page);
      await expect(page.getByText('1 item pasted')).toBeVisible();
      await expect(rowByName(page, 'docs')).toBeVisible();

      await goUp(page);
      await openFolder(page, 'd2');
      await pasteHere(page);
      await expect(page.getByText('1 item pasted').last()).toBeVisible();

      await expect
        .poll(() => listKeys(client, credentials.bucket, `${prefix}d2/`))
        .toEqual([`${prefix}d2/`, `${prefix}d2/docs/a.txt`, `${prefix}d2/docs/sub/b.txt`]);
      expect(await listKeys(client, credentials.bucket, `${prefix}d1/docs/`)).toEqual([
        `${prefix}d1/docs/a.txt`,
        `${prefix}d1/docs/sub/b.txt`
      ]);
      expect(await listKeys(client, credentials.bucket, `${prefix}docs/`)).toEqual([]);
    } finally {
      await deletePrefix(client, credentials.bucket, prefix);
    }
  });

  test('the dialog shows refused items with their reason (F5)', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'refusals');

    try {
      await putTextObject(client, credentials.bucket, `${prefix}docs/sub/x.txt`, 'x');
      await putTextObject(client, credentials.bucket, `${prefix}a.txt`, 'a');

      await connectAndOpenPrefix(page, credentials, prefix);
      const dialog = page.getByRole('dialog');

      // A folder into its own subtree.
      await contextAction(page, 'docs', 'Copy');
      await openFolder(page, 'docs');
      await openFolder(page, 'sub');
      await pasteHere(page);
      await expect(dialog.getByText('Cannot be transferred').first()).toBeVisible();
      await expect(dialog.getByText('A folder cannot be placed inside itself.')).toBeVisible();
      await dialog.getByRole('button', { name: 'Close' }).click();

      // A cut pasted into its own folder.
      await goUp(page);
      await expect(rowByName(page, 'sub')).toBeVisible();
      await goUp(page);
      await expect(rowByName(page, 'a.txt')).toBeVisible();
      await contextAction(page, 'a.txt', 'Cut');
      await pasteHere(page);
      await expect(dialog.getByText('It is already in this location.')).toBeVisible();
      await dialog.getByRole('button', { name: 'Close' }).click();

      expect(await listKeys(client, credentials.bucket, prefix)).toEqual([
        `${prefix}a.txt`,
        `${prefix}docs/sub/x.txt`
      ]);
    } finally {
      await deletePrefix(client, credentials.bucket, prefix);
    }
  });

  test('a move with mixed outcomes shows one toast with counts (#9)', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'mixed-feedback');
    const names = ['f1.txt', 'f2.txt', 'f3.txt', 'f4.txt', 'f5.txt'];

    try {
      for (const name of names) {
        await putTextObject(client, credentials.bucket, `${prefix}${name}`, name);
      }
      await putDirectoryMarker(client, credentials.bucket, `${prefix}target/`);

      await connectAndOpenPrefix(page, credentials, prefix);
      await page.keyboard.press('Control+a');
      await rowByName(page, 'target').click({ modifiers: ['Control'] });
      await page.keyboard.press('Control+x');

      // Four sources disappear before the paste: they fail, one moves.
      await deleteKnownKeys(
        client,
        credentials.bucket,
        names.slice(1).map((name) => `${prefix}${name}`)
      );
      await openFolder(page, 'target');
      await pasteHere(page);

      const toast = page.getByRole('alert').filter({ hasText: 'Paste finished' });
      await expect(toast).toHaveCount(1);
      await expect(toast).toContainText('1 done, 4 failed.');
      await expect(toast).toContainText('+ 1 more');
      expect(await objectExists(client, credentials.bucket, `${prefix}target/f1.txt`)).toBe(true);
    } finally {
      await deletePrefix(client, credentials.bucket, prefix);
    }
  });

  test('renaming in a folder with an empty segment keeps it there (F12, R3)', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'empty-segment');

    try {
      await putTextObject(client, credentials.bucket, `${prefix}a//b.txt`, 'b');
      await putTextObject(client, credentials.bucket, `${prefix}a/c.txt`, 'other c');

      // The browser cannot open the nameless folder `a//` (its route has an empty path
      // segment), so the rename is sent the way the rename modal sends it.
      await connectAndOpenPrefix(page, credentials, prefix);
      const headers = await connectionHeader(page);
      const status = await page.evaluate(
        async ({ headers, bucket, key }) => {
          const res = await fetch('/api/storage/transfer', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              op: 'rename',
              jobId: crypto.randomUUID(),
              source: { bucket },
              items: [{ sourceKey: key, name: 'c.txt' }]
            })
          });
          const lines = (await res.text())
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          return lines.find((line) => line.type === 'item-done').status;
        },
        { headers, bucket: credentials.bucket, key: `${prefix}a//b.txt` }
      );
      expect(status).toBe('done');

      await expect
        .poll(() => objectExists(client, credentials.bucket, `${prefix}a//c.txt`))
        .toBe(true);
      await expect
        .poll(() => objectExists(client, credentials.bucket, `${prefix}a//b.txt`))
        .toBe(false);
      expect(await getObjectText(client, credentials.bucket, `${prefix}a/c.txt`)).toBe('other c');
    } finally {
      await deletePrefix(client, credentials.bucket, prefix);
    }
  });

  test('refuses a drop of items from another connection', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'other-connection');

    try {
      await putTextObject(client, credentials.bucket, `${prefix}a.txt`, 'a');
      await putDirectoryMarker(client, credentials.bucket, `${prefix}target/`);
      await connectAndOpenPrefix(page, credentials, prefix);

      // Within one window a connection switch reloads the page, so items from another
      // connection arrive by dragging from a second window. Playwright cannot drag
      // between pages, so the drop carries that window's drag data directly.
      await rowByName(page, 'target').evaluate(
        (row, { bucket, key }) => {
          const data = new DataTransfer();
          data.setData('application/x-storage-keys', JSON.stringify([key]));
          data.setData(
            'application/x-storage-source',
            JSON.stringify({ connectionId: 'another-connection', bucket })
          );
          row.dispatchEvent(
            new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
          );
        },
        { bucket: credentials.bucket, key: `${prefix}a.txt` }
      );

      await expect(page.getByText(/belong to another storage connection/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Move', exact: true })).toHaveCount(0);
      expect(await listKeys(client, credentials.bucket, prefix)).toEqual([
        `${prefix}a.txt`,
        `${prefix}target/`
      ]);
    } finally {
      await deletePrefix(client, credentials.bucket, prefix);
    }
  });

  test('cancelling a running move keeps every original (#20)', async ({ page }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'cancel-move');

    try {
      await putMany(client, credentials.bucket, `${prefix}many/`, CANCEL_OBJECTS);
      await connectAndOpenPrefix(page, credentials, prefix);
      const headers = await connectionHeader(page);

      // Cancel as soon as the request is accepted. Wherever the cancel lands before the
      // deletes start, the item ends cancelled with every original kept; with one object
      // at a time (.env.test) the deletes start only after all copies.
      const events = await page.evaluate(
        async ({ headers, bucket, prefix }) => {
          const jobId = crypto.randomUUID();
          const res = await fetch('/api/storage/transfer', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              op: 'move',
              jobId,
              source: { bucket },
              dest: { bucket, prefix: `${prefix}target/` },
              items: [{ sourceKey: `${prefix}many/` }]
            })
          });
          await fetch(`/api/storage/copy/job/${jobId}`, { method: 'DELETE', headers });
          return (await res.text())
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        },
        { headers, bucket: credentials.bucket, prefix }
      );

      expect(events.at(-1).type).toBe('complete');
      const itemDone = events.find((event) => event.type === 'item-done');
      expect(itemDone).toMatchObject({ status: 'cancelled', deletedOriginals: 0 });
      expect(itemDone.copied).toBeLessThan(CANCEL_OBJECTS);
      expect(await listKeys(client, credentials.bucket, `${prefix}many/`)).toHaveLength(
        CANCEL_OBJECTS
      );
    } finally {
      await deletePrefix(client, credentials.bucket, prefix);
    }
  });

  test('the Cancel button stops a running paste and keeps the originals', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'cancel-button');

    try {
      await putMany(client, credentials.bucket, `${prefix}many/`, CANCEL_OBJECTS);
      await putDirectoryMarker(client, credentials.bucket, `${prefix}target/`);
      await connectAndOpenPrefix(page, credentials, prefix);

      await contextAction(page, 'many', 'Cut');
      await openFolder(page, 'target');
      await pasteHere(page);
      await page.getByRole('button', { name: 'Operations', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel operation' }).first().click();

      const toast = page.getByRole('alert').filter({ hasText: '1 cancelled' });
      await expect(toast).toBeVisible({ timeout: 15_000 });
      expect(await listKeys(client, credentials.bucket, `${prefix}many/`)).toHaveLength(
        CANCEL_OBJECTS
      );
    } finally {
      await deletePrefix(client, credentials.bucket, prefix);
    }
  });

  test('the API plans, rejects bad requests and always ends its stream with complete', async ({
    page
  }, testInfo) => {
    const credentials = requireGarageCredentials();
    const client = createS3Client(credentials);
    const prefix = uniquePrefix(testInfo, 'api');

    try {
      await putTextObject(client, credentials.bucket, `${prefix}a.txt`, 'a');
      await putTextObject(client, credentials.bucket, `${prefix}dest/a.txt`, 'existing');
      await connectAndOpenPrefix(page, credentials, prefix);
      const headers = await connectionHeader(page);

      const result = await page.evaluate(
        async ({ headers, bucket, prefix }) => {
          const post = (path: string, body: unknown) =>
            fetch(path, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
          const plan = await post('/api/storage/transfer/plan', {
            op: 'copy',
            source: { bucket, keys: [`${prefix}a.txt`] },
            dest: { bucket, prefix: `${prefix}dest/` }
          });
          const invalid = await post('/api/storage/transfer', { op: 'copy' });
          const transfer = {
            op: 'copy',
            jobId: crypto.randomUUID(),
            source: { bucket },
            dest: { bucket, prefix: `${prefix}dest/` },
            items: [{ sourceKey: `${prefix}a.txt` }]
          };
          const first = await post('/api/storage/transfer', transfer);
          const lines = (await first.text())
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          const reused = await post('/api/storage/transfer', transfer);
          return {
            plan: await plan.json(),
            invalidStatus: invalid.status,
            lines,
            reusedStatus: reused.status
          };
        },
        { headers, bucket: credentials.bucket, prefix }
      );

      expect(result.plan.items).toEqual([
        {
          sourceKey: `${prefix}a.txt`,
          kind: 'file',
          destKey: `${prefix}dest/a.txt`,
          conflict: 'file',
          suggestedName: 'a (1).txt'
        }
      ]);
      expect(result.invalidStatus).toBe(400);
      expect(result.reusedStatus).toBe(409);
      // Without a policy the conflicting item is refused, and the stream still completes.
      expect(result.lines.map((line: { type: string }) => line.type)).toEqual([
        'item-done',
        'complete'
      ]);
      expect(result.lines[0]).toMatchObject({ status: 'refused', reason: 'conflict' });
      expect(await getObjectText(client, credentials.bucket, `${prefix}dest/a.txt`)).toBe(
        'existing'
      );
    } finally {
      await deletePrefix(client, credentials.bucket, prefix);
    }
  });

  test.describe('across buckets', () => {
    test.beforeEach(() => {
      test.skip(!hasGarageAdmin(), 'Skipped: Garage admin API is unavailable for bucket setup');
    });

    async function secondBucket(testInfo: TestInfo) {
      const credentials = requireGarageCredentials();
      const bucket = uniqueBucketName(testInfo, 'xfer');
      await createGarageBucketCredentials(credentials, {
        bucketName: bucket,
        keyName: `xfer-${testInfo.project.name}-${crypto.randomUUID()}`,
        permissions: { owner: false, read: true, write: true },
        ownerAccessKeyId: credentials.accessKeyId
      });
      return bucket;
    }

    test('copies and moves into another bucket', async ({ page }, testInfo) => {
      const credentials = requireGarageCredentials();
      const client = createS3Client(credentials);
      const prefix = uniquePrefix(testInfo, 'cross-bucket');
      const other = await secondBucket(testInfo);

      try {
        await putTextObject(client, credentials.bucket, `${prefix}copy-me.txt`, 'copied');
        await putTextObject(client, credentials.bucket, `${prefix}move-me.txt`, 'moved');

        await connectAndOpenPrefix(page, credentials, prefix);
        await contextAction(page, 'copy-me.txt', 'Copy');
        await openBucket(page, other);
        await pasteHere(page);
        await expect(page.getByText('1 item pasted')).toBeVisible();

        await page.goto(
          bucketRoute(new URL(credentials.endpoint).hostname, credentials.bucket, prefix)
        );
        await expect(rowByName(page, 'move-me.txt')).toBeVisible();
        await contextAction(page, 'move-me.txt', 'Cut');
        await openBucket(page, other);
        await pasteHere(page);
        await expect(page.getByText('1 item pasted').last()).toBeVisible();

        await expect.poll(() => objectExists(client, other, 'move-me.txt')).toBe(true);
        expect(await getObjectText(client, other, 'copy-me.txt')).toBe('copied');
        expect(await getObjectText(client, other, 'move-me.txt')).toBe('moved');
        expect(await objectExists(client, credentials.bucket, `${prefix}copy-me.txt`)).toBe(true);
        await expect
          .poll(() => objectExists(client, credentials.bucket, `${prefix}move-me.txt`))
          .toBe(false);
      } finally {
        await deletePrefix(client, credentials.bucket, prefix);
        await deletePrefix(client, other, '');
      }
    });

    test("dropping onto another bucket's tab moves into that bucket (R5)", async ({
      page
    }, testInfo) => {
      const credentials = requireGarageCredentials();
      const client = createS3Client(credentials);
      const prefix = uniquePrefix(testInfo, 'tab-drop');
      const other = await secondBucket(testInfo);

      try {
        await putTextObject(client, credentials.bucket, `${prefix}drag-me.txt`, 'dragged');

        await connectAndOpenPrefix(page, credentials, prefix);
        const tablist = page.getByRole('tablist', { name: 'Explorer tabs' });
        await page.getByRole('button', { name: 'New Tab' }).click();
        await page.getByRole('link', { name: other, exact: true }).last().click();
        await expect(tablist.getByRole('tab').nth(1)).toHaveAttribute('title', other);
        await tablist.getByRole('tab').nth(0).click();
        await expect(rowByName(page, 'drag-me.txt')).toBeVisible();

        await rowByName(page, 'drag-me.txt').dragTo(tablist.getByRole('tab').nth(1));
        await page.getByRole('button', { name: 'Move', exact: true }).click();

        await expect.poll(() => objectExists(client, other, 'drag-me.txt')).toBe(true);
        await expect
          .poll(() => objectExists(client, credentials.bucket, `${prefix}drag-me.txt`))
          .toBe(false);
        expect(await objectExists(client, credentials.bucket, 'drag-me.txt')).toBe(false);
      } finally {
        await deletePrefix(client, credentials.bucket, prefix);
        await deletePrefix(client, other, '');
      }
    });
  });
});
