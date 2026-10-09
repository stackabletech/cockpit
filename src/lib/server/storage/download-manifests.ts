import { and, desc, eq, gt, lte, inArray } from 'drizzle-orm';
import { error, isHttpError } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { downloadHistoryRetentionMs } from '$lib/server/feature-flags.js';
import { logger } from '$lib/server/logging';
import { storageDownloadManifests } from '$lib/server/schema.js';
import { getConnectionForUser } from './connections-db.js';
import type { StorageProvider } from './provider.js';
import type { S3ConnectionConfig } from './types.js';
import { getProvider } from './utils.js';
import { withStorageHttpErrors } from './wrap-provider.js';
import { createZipStream, type ZipEntry, zipStreamSize } from './zip-stream.js';

const log = logger.child({ module: 'storage-download-manifests' });

export type DownloadEntry = ZipEntry;

export interface DownloadFile {
  filename: string;
  size: number;
  part: number;
}

export interface DownloadManifest {
  id: string;
  files: DownloadFile[];
  expiresAt: Date;
}

export interface DownloadHistoryEntry {
  id: string;
  bucket: string;
  connectionId: string;
  prefix: string;
  entries: DownloadEntry[];
  archive: boolean;
  archiveFilename: string | null;
  expiresAt: Date;
  createdAt: Date;
}

function fileName(key: string): string {
  return key.split('/').filter(Boolean).pop() ?? key;
}

function archiveBaseName(bucket: string, prefix: string | undefined, keys: string[]): string {
  if (keys.length === 1 && keys[0].endsWith('/')) {
    return fileName(keys[0]).replace(/\/$/, '') || bucket;
  }
  return fileName(prefix ?? '').replace(/\/$/, '') || bucket;
}

export function archiveFileName(base: string): string {
  return `${base}.zip`;
}

async function removeExpiredManifests(): Promise<void> {
  const expired = db
    .select({ id: storageDownloadManifests.id })
    .from(storageDownloadManifests)
    .where(lte(storageDownloadManifests.expiresAt, new Date()))
    .limit(100);
  await db.delete(storageDownloadManifests).where(inArray(storageDownloadManifests.id, expired));
}

async function mapMetadata<T, R>(items: T[], resolve: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await resolve(items[index]);
      }
    })
  );
  return results;
}

function shouldArchive(keys: string[]): boolean {
  return keys.length > 3 || keys.some((key) => key.endsWith('/'));
}

async function expandKeys(provider: StorageProvider, keys: string[]): Promise<DownloadEntry[]> {
  const expanded = new Set<string>();
  for (const key of keys) {
    expanded.add(key);
    if (key.endsWith('/'))
      await provider.listAllKeysProgressively(key, (batch) => {
        for (const item of batch) expanded.add(item.key);
        if (expanded.size > 10_000) throw error(400, 'Download selection exceeds 10000 entries');
      });
  }
  return mapMetadata([...expanded], async (key) => {
    if (key.endsWith('/')) return { key, size: 0, isDirectory: true };
    const metadata = await provider.getMetadata(key);
    return { key, size: metadata.size, isDirectory: false };
  });
}

/**
 * Build the manifest file list. For archives the reported size is the
 * exact output size is derived from the immutable manifest metadata.
 */
function filesFor(entries: DownloadEntry[], archive: boolean, archiveName: string): DownloadFile[] {
  return archive
    ? [
        {
          filename: archiveName,
          size: zipStreamSize(entries),
          part: 1
        }
      ]
    : entries.map((entry, index) => ({
        filename: fileName(entry.key),
        size: entry.size,
        part: index + 1
      }));
}

async function persistManifest(input: {
  userId: string;
  connectionId: string;
  bucket: string;
  prefix: string;
  entries: DownloadEntry[];
  archive: boolean;
  archiveName: string;
}): Promise<DownloadManifest> {
  const expiresAt = new Date(Date.now() + downloadHistoryRetentionMs);
  const [manifest] = await db
    .insert(storageDownloadManifests)
    .values({
      userId: input.userId,
      connectionId: input.connectionId,
      bucket: input.bucket,
      prefix: input.prefix,
      entries: input.entries,
      format: input.archive ? 'zip' : 'direct',
      archive: input.archive ? input.archiveName : null,
      expiresAt
    })
    .returning({ id: storageDownloadManifests.id });
  return {
    id: manifest.id,
    files: filesFor(input.entries, input.archive, input.archiveName),
    expiresAt
  };
}

/** Resolve all metadata before inserting one immutable manifest row. */
export async function createDownloadManifest(input: {
  userId: string;
  connectionId: string;
  bucket: string;
  prefix: string;
  keys: string[];
  config: S3ConnectionConfig;
}): Promise<DownloadManifest> {
  await removeExpiredManifests();
  const archive = shouldArchive(input.keys);
  const provider = withStorageHttpErrors(getProvider(input.config, input.bucket));
  const entries = archive
    ? await expandKeys(provider, input.keys)
    : await mapMetadata(input.keys, async (key) => {
        const metadata = await provider.getMetadata(key);
        return { key, size: metadata.size, isDirectory: false };
      });
  const archiveName = archiveFileName(archiveBaseName(input.bucket, input.prefix, input.keys));
  const manifest = await persistManifest({ ...input, entries, archive, archiveName });
  log.info(
    { manifest_id: manifest.id, bucket: input.bucket, file_count: manifest.files.length },
    'download manifest created'
  );
  return manifest;
}

async function loadOwnedManifest(userId: string, id: string): Promise<DownloadHistoryEntry | null> {
  const [row] = await db
    .select()
    .from(storageDownloadManifests)
    .where(
      and(
        eq(storageDownloadManifests.id, id),
        eq(storageDownloadManifests.userId, userId),
        gt(storageDownloadManifests.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!row) return null;
  const entries = row.entries as DownloadEntry[];
  return {
    id: row.id,
    bucket: row.bucket,
    connectionId: row.connectionId,
    prefix: row.prefix,
    entries,
    archive: (row.format ?? 'zip') === 'zip' && row.archive !== null,
    archiveFilename: row.archive,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt
  };
}

/** Create a fresh history entry from a checked subset of an existing entry. */
export async function recreateDownloadManifest(
  userId: string,
  id: string,
  selectedKeys: string[],
  signal?: AbortSignal
): Promise<DownloadManifest | null> {
  if (selectedKeys.length === 0 || new Set(selectedKeys).size !== selectedKeys.length) return null;
  const original = await loadOwnedManifest(userId, id);
  if (!original) return null;
  const config = await getConnectionForUser(userId, original.connectionId);
  if (!config) {
    await db.delete(storageDownloadManifests).where(eq(storageDownloadManifests.id, id));
    return null;
  }

  const byKey = new Map(original.entries.map((entry) => [entry.key, entry]));
  if (selectedKeys.some((key) => !byKey.has(key))) return null;
  const selected = selectedKeys.map((key) => byKey.get(key)!);
  const expanded = [
    ...new Map(
      selected
        .flatMap((entry) =>
          entry.isDirectory
            ? original.entries.filter(
                (candidate) => candidate.key === entry.key || candidate.key.startsWith(entry.key)
              )
            : [entry]
        )
        .map((entry) => [entry.key, entry])
    ).values()
  ];
  const provider = withStorageHttpErrors(getProvider(config, original.bucket));
  const entries = await mapMetadata(expanded, async (entry) => {
    signal?.throwIfAborted();
    if (entry.isDirectory) return { ...entry, size: 0 };
    try {
      const metadata = await provider.getMetadata(entry.key);
      return { ...entry, size: metadata.size };
    } catch (err) {
      if (isHttpError(err) && err.status === 404) throw error(404, entry.key);
      throw err;
    }
  });
  const nonDirectoryEntries = entries.filter((entry) => !entry.isDirectory);
  signal?.throwIfAborted();
  const archive = nonDirectoryEntries.length !== 1;
  return persistManifest({
    userId,
    connectionId: original.connectionId,
    bucket: original.bucket,
    prefix: original.prefix,
    entries: archive ? entries : nonDirectoryEntries,
    archive,
    archiveName: archiveFileName(archiveBaseName(original.bucket, original.prefix, selectedKeys))
  });
}

/** List current connection-scoped history and remove records whose connection was deleted. */
export async function listDownloadHistory(
  userId: string,
  connectionId?: string,
  offset = 0
): Promise<DownloadHistoryEntry[]> {
  await removeExpiredManifests();
  const conditions = [
    eq(storageDownloadManifests.userId, userId),
    gt(storageDownloadManifests.expiresAt, new Date())
  ];
  if (connectionId) conditions.push(eq(storageDownloadManifests.connectionId, connectionId));
  const rows = await db
    .select()
    .from(storageDownloadManifests)
    .where(and(...conditions))
    .orderBy(desc(storageDownloadManifests.createdAt), desc(storageDownloadManifests.id))
    .limit(50)
    .offset(offset);
  const history: DownloadHistoryEntry[] = [];
  const available = new Map<string, boolean>();
  for (const row of rows) {
    if (!available.has(row.connectionId))
      available.set(row.connectionId, !!(await getConnectionForUser(userId, row.connectionId)));
    if (!available.get(row.connectionId)) {
      await db.delete(storageDownloadManifests).where(eq(storageDownloadManifests.id, row.id));
      continue;
    }
    history.push({
      id: row.id,
      bucket: row.bucket,
      connectionId: row.connectionId,
      prefix: row.prefix,
      entries: row.entries as DownloadEntry[],
      archive: (row.format ?? 'zip') === 'zip' && row.archive !== null,
      archiveFilename: row.archive,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt
    });
  }
  return history;
}

/** Remove every retained download manifest for one user. */
export async function clearDownloadHistory(userId: string): Promise<void> {
  await db.delete(storageDownloadManifests).where(eq(storageDownloadManifests.userId, userId));
}

/** Load an owned, unexpired manifest and resolve its current encrypted connection. */
export async function openDownloadManifestPart(
  userId: string,
  id: string,
  part: number
): Promise<{ stream: ReadableStream; file: DownloadFile } | null> {
  const manifest = await loadOwnedManifest(userId, id);
  if (!manifest) return null;
  const config = await getConnectionForUser(userId, manifest.connectionId);
  if (!config) {
    log.warn(
      { manifest_id: id, connection_id: manifest.connectionId },
      'download connection unavailable'
    );
    await db.delete(storageDownloadManifests).where(eq(storageDownloadManifests.id, id));
    return null;
  }
  const provider = withStorageHttpErrors(getProvider(config, manifest.bucket));
  if (manifest.archive) {
    if (part !== 1 || !manifest.archiveFilename) return null;
    return {
      stream: createZipStream(provider, manifest.entries),
      file: { filename: manifest.archiveFilename, size: zipStreamSize(manifest.entries), part: 1 }
    };
  }
  const entry = manifest.entries[part - 1];
  if (!entry || entry.isDirectory) return null;
  return {
    stream: (await provider.getObject(entry.key)).stream,
    file: { filename: fileName(entry.key), size: entry.size, part }
  };
}
