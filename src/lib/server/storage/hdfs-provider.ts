import { error, isHttpError } from '@sveltejs/kit';
import type {
  StorageProvider,
  ObjectDownload,
  DeleteObjectsResult,
  SearchOptions,
  SearchResult,
  ProgressiveListOptions
} from './provider.js';
import type { HDFSConfig } from './types.js';
import type {
  StoragePage,
  StorageObject,
  StorageMetadata,
  SearchResultItem,
  TrashInfo
} from '$lib/storage/types.js';
import type { LifecycleRule, BucketAcl } from '$lib/storage/details-types.js';
import { joinHdfsPath, normaliseHdfsBasePath } from '$lib/storage/hdfs-path.js';
import { logger } from '$lib/server/logging';
import { WebHdfsClient, type HdfsFileStatus } from './webhdfs-client.js';
import { isNotFound } from './hdfs-errors.js';
import { guessContentType } from './content-type.js';

const log = logger.child({ module: 'hdfs-provider' });

type KeyBatch = Array<{ key: string; size: number; lastModified?: Date }>;

function encodeToken(name: string): string {
  return Buffer.from(name, 'utf8').toString('base64url');
}

function decodeToken(token: string): string {
  return Buffer.from(token, 'base64url').toString('utf8');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

function keyDepth(relativeKey: string): number {
  return relativeKey.split('/').filter(Boolean).length;
}

function withProgress(
  stream: ReadableStream<Uint8Array>,
  total: number,
  onProgress: (loaded: number, total: number) => void
): ReadableStream<Uint8Array> {
  let loaded = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        onProgress(loaded, total);
        controller.enqueue(chunk);
      }
    })
  );
}

/** Expand an octal permission (e.g. `750`) into owner/group/other grants. */
function permissionGrants(permission: string): Array<{ grantee: string; permission: string }> {
  const digits = permission.padStart(3, '0').slice(-3);
  const rwx = (d: string) => {
    const n = parseInt(d, 8);
    return `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
  };
  return [
    { grantee: 'owner', permission: rwx(digits[0]) },
    { grantee: 'group', permission: rwx(digits[1]) },
    { grantee: 'other', permission: rwx(digits[2]) }
  ];
}

/**
 * HDFS storage provider over WebHDFS. The "bucket" is an absolute base path;
 * keys are relative to it, with directories ending in `/`, matching the S3
 * key contract the routes rely on. Unlike S3, directories are real: they are
 * listed even when empty, created with MKDIRS and moved atomically.
 */
export class HDFSStorageProvider implements StorageProvider {
  private readonly client: WebHdfsClient;
  private readonly basePath: string;

  constructor(config: HDFSConfig, client?: WebHdfsClient) {
    const basePath = normaliseHdfsBasePath(config.bucket || '/');
    if (!basePath) throw error(400, `Invalid HDFS base path: ${config.bucket}`);
    this.basePath = basePath;
    this.client = client ?? WebHdfsClient.fromConfig(config);
  }

  /** Absolute HDFS path for a key. Rejects `.`/`..` segments, which would escape the base path. */
  private path(key: string): string {
    if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
      throw error(400, `Invalid key: ${key}`);
    }
    return joinHdfsPath(this.basePath, key);
  }

  private toObject(parentKey: string, status: HdfsFileStatus): StorageObject {
    const isDirectory = status.type === 'DIRECTORY';
    return {
      key: parentKey + status.pathSuffix + (isDirectory ? '/' : ''),
      size: isDirectory ? 0 : status.length,
      lastModified: new Date(status.modificationTime),
      isDirectory,
      contentType: isDirectory ? undefined : guessContentType(status.pathSuffix)
    };
  }

  async listContainers(): Promise<string[]> {
    log.trace({ base_path: this.basePath }, 'HDFS GETFILESTATUS / (list containers)');
    await this.client.getFileStatus('/');
    return ['/'];
  }

  async listObjects(
    prefix: string,
    pageSize: number,
    continuationToken?: string | null
  ): Promise<StoragePage> {
    const dirPath = this.path(prefix);
    log.trace({ path: dirPath, page_size: pageSize }, 'HDFS LISTSTATUS_BATCH');

    // The server decides the batch size (dfs.ls.limit), so read batches until
    // one entry beyond the page is known or the directory is exhausted.
    const collected: HdfsFileStatus[] = [];
    let startAfter = continuationToken ? decodeToken(continuationToken) : undefined;
    let remaining = 0;
    try {
      do {
        const batch = await this.client.listStatusBatch(dirPath, startAfter);
        collected.push(...batch.statuses.filter((s) => s.pathSuffix));
        remaining = batch.remainingEntries;
        startAfter = batch.statuses.at(-1)?.pathSuffix;
      } while (collected.length <= pageSize && remaining > 0 && startAfter);
    } catch (err) {
      // S3 returns an empty page for a missing prefix but 404 for a missing
      // bucket; match that (the base path is the bucket).
      if (!isNotFound(err) || !prefix) throw err;
    }

    const page = collected.slice(0, pageSize);
    const hasNextPage = collected.length > pageSize || remaining > 0;
    const objects = page
      .map((status) => this.toObject(prefix, status))
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory));

    return {
      objects,
      hasNextPage,
      currentPage: 1,
      pageSize,
      continuationToken: continuationToken ?? null,
      nextContinuationToken:
        hasNextPage && page.length > 0 ? encodeToken(page[page.length - 1].pathSuffix) : null
    };
  }

  async getObject(key: string): Promise<ObjectDownload> {
    const path = this.path(key);
    log.trace({ path }, 'HDFS OPEN');
    const status = await this.client.getFileStatus(path);
    if (status.type === 'DIRECTORY') throw error(400, `${key} is a directory`);
    return {
      stream: await this.client.open(path),
      contentType: guessContentType(key),
      contentLength: status.length,
      etag: undefined
    };
  }

  async getObjectRange(key: string, start: number, end: number): Promise<ReadableStream> {
    const path = this.path(key);
    log.trace({ path, start, end }, 'HDFS OPEN (range)');
    return this.client.open(path, { offset: start, length: end - start + 1 });
  }

  async getMetadata(key: string): Promise<StorageMetadata> {
    const status = await this.client.getFileStatus(this.path(key));
    const isDirectory = status.type === 'DIRECTORY';
    return {
      size: isDirectory ? 0 : status.length,
      lastModified: new Date(status.modificationTime),
      contentType: isDirectory ? 'application/x-directory' : guessContentType(key),
      etag: undefined,
      customMetadata: undefined,
      owner: status.owner,
      group: status.group,
      permission: status.permission,
      ...(isDirectory ? {} : { replication: status.replication, blockSize: status.blockSize })
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.getFileStatus(this.path(key));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async putObject(
    key: string,
    body: ReadableStream | Buffer,
    contentType: string,
    contentLength?: number,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    const path = this.path(key);
    if (key.endsWith('/')) {
      log.trace({ path }, 'HDFS MKDIRS');
      await this.client.mkdirs(path);
      return;
    }
    log.trace({ path, content_length: contentLength }, 'HDFS CREATE');
    const payload =
      body instanceof ReadableStream
        ? onProgress && contentLength
          ? withProgress(body, contentLength, onProgress)
          : body
        : new Uint8Array(body);
    await this.client.create(path, payload, { overwrite: true });
  }

  async getTrashInfo(): Promise<TrashInfo> {
    const { trashInterval } = await this.client.getServerDefaults();
    return { enabled: trashInterval > 0, intervalMinutes: trashInterval };
  }

  async deleteObjects(
    keys: string[],
    options: { useTrash?: boolean } = {}
  ): Promise<DeleteObjectsResult> {
    const useTrash = !!options.useTrash && (await this.getTrashInfo()).enabled;
    log.trace(
      { base_path: this.basePath, key_count: keys.length, use_trash: useTrash },
      'HDFS DELETE'
    );
    const failed: DeleteObjectsResult['failed'] = [];
    let trashed = 0;
    for (const key of keys) {
      // An empty key resolves to the base path itself; never delete that.
      if (!key || key === '/') {
        failed.push({ key, code: 'InvalidKey', message: 'Refusing to delete the base path' });
        continue;
      }
      try {
        if (useTrash && (await this.moveToTrash(key))) {
          trashed++;
          continue;
        }
        // `false` means the path did not exist, which S3 also treats as deleted.
        await this.client.delete(this.path(key), true);
      } catch (err) {
        failed.push({
          key,
          code: isHttpError(err) ? String(err.status) : 'Error',
          message: isHttpError(err) ? err.body.message : (err as Error).message
        });
      }
    }
    if (failed.length > 0) {
      log.warn({ base_path: this.basePath, failed_count: failed.length }, 'HDFS delete failures');
    }
    log.info(
      { base_path: this.basePath, trashed, failed_count: failed.length },
      'HDFS delete completed'
    );
    return useTrash ? { failed, trashed } : { failed };
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await this.client.getFileStatus(path);
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  /**
   * Move a key into the user's trash the way `hdfs dfs -rm` does:
   * `<trash root>/Current/<absolute path>`, with a timestamp suffix if that
   * name is taken. Returns `false` for paths already inside the trash, which
   * are then deleted permanently. Refuses paths that contain the trash.
   */
  private async moveToTrash(key: string): Promise<boolean> {
    const path = this.path(key);
    const trashRoot = await this.client.getTrashRoot(path);
    if (path === trashRoot || path.startsWith(`${trashRoot}/`)) return false;
    if (trashRoot.startsWith(`${path}/`)) {
      throw error(409, `Cannot move "${key}" to the trash because it contains the trash`);
    }

    let target = `${trashRoot}/Current${path}`;
    await this.client.mkdirs(target.slice(0, target.lastIndexOf('/')));
    if (await this.pathExists(target)) target = `${target}${Date.now()}`;

    log.debug({ path, trash_path: target }, 'HDFS move to trash');
    if (!(await this.client.rename(path, target))) {
      if (!(await this.pathExists(path))) return true; // already gone
      throw error(502, `HDFS refused to move "${key}" to the trash`);
    }
    return true;
  }

  /**
   * Breadth-first walk below the directory containing `prefix`, emitting every
   * file and directory (`dir/`) whose key starts with `prefix`, one batch per
   * listing request. Stops when `onBatch` returns `false`.
   */
  private async walk(
    prefix: string,
    onBatch: (batch: KeyBatch) => void | boolean,
    options: { signal?: AbortSignal; maxDepth?: number } = {}
  ): Promise<void> {
    const { signal, maxDepth } = options;
    const queue = [prefix.slice(0, prefix.lastIndexOf('/') + 1)];

    while (queue.length > 0) {
      const dirKey = queue.shift()!;
      let startAfter: string | undefined;
      let remaining = 0;
      do {
        throwIfAborted(signal);
        let batch;
        try {
          batch = await this.client.listStatusBatch(this.path(dirKey), startAfter, signal);
        } catch (err) {
          if (isNotFound(err)) break; // removed while walking, or missing prefix
          throw err;
        }
        const items: KeyBatch = [];
        for (const status of batch.statuses) {
          if (!status.pathSuffix) continue;
          const item = this.toObject(dirKey, status);
          if (!item.key.startsWith(prefix)) continue;
          items.push({ key: item.key, size: item.size, lastModified: item.lastModified });
          if (
            item.isDirectory &&
            (maxDepth === undefined || keyDepth(item.key.slice(prefix.length)) < maxDepth)
          ) {
            queue.push(item.key);
          }
        }
        if (items.length > 0 && onBatch(items) === false) return;
        remaining = batch.remainingEntries;
        startAfter = batch.statuses.at(-1)?.pathSuffix;
      } while (remaining > 0 && startAfter);
    }
  }

  async listAllKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    await this.walk(prefix, (batch) => {
      for (const item of batch) if (item.key !== prefix) keys.push(item.key);
    });
    log.trace({ base_path: this.basePath, prefix, key_count: keys.length }, 'HDFS walk complete');
    return keys;
  }

  async listAllKeysProgressively(
    prefix: string,
    onBatch: (keys: KeyBatch) => void | boolean,
    options?: ProgressiveListOptions
  ): Promise<void> {
    await this.walk(
      prefix,
      (batch) => {
        const filtered = batch.filter((item) => item.key !== prefix);
        return filtered.length > 0 ? onBatch(filtered) : undefined;
      },
      { signal: options?.signal }
    );
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    const signal = options?.signal;
    const prefix = options?.prefix ?? '';
    const maxDepth = options?.maxDepth;
    const matches =
      options?.matches ??
      ((item: SearchResultItem) => item.key.toLowerCase().includes(query.toLowerCase()));
    const onMatch = options?.onMatch;

    log.trace({ base_path: this.basePath, query, prefix, max_depth: maxDepth }, 'HDFS search');
    throwIfAborted(signal);

    const results: SearchResultItem[] = [];
    await this.walk(
      prefix,
      (batch) => {
        for (const item of batch) {
          throwIfAborted(signal);
          if (maxDepth !== undefined && keyDepth(item.key.slice(prefix.length)) > maxDepth) {
            continue;
          }
          const result = {
            key: item.key,
            size: item.size,
            lastModified: item.lastModified ?? new Date(0),
            isDirectory: item.key.endsWith('/')
          };
          if (matches(result)) {
            results.push(result);
            onMatch?.(result);
          }
        }
      },
      { signal, maxDepth }
    );

    log.info({ base_path: this.basePath, query, result_count: results.length }, 'search complete');
    return { results };
  }

  async getBucketVersioning(): Promise<string> {
    return 'Disabled';
  }

  async getBucketLifecycleRules(): Promise<LifecycleRule[]> {
    return [];
  }

  async getBucketTags(): Promise<Record<string, string>> {
    return {};
  }

  /** POSIX owner/group/other permissions plus any extended ACL entries of the base path. */
  async getBucketAcl(): Promise<BucketAcl> {
    try {
      const acl = await this.client.getAclStatus(this.basePath);
      return {
        owner: `${acl.owner}:${acl.group}`,
        grants: [
          ...permissionGrants(acl.permission),
          ...acl.entries.map((entry) => {
            const [type, name, perm] = entry.split(':');
            return { grantee: name ? `${type}:${name}` : type, permission: perm ?? '' };
          })
        ]
      };
    } catch (err) {
      log.debug({ err, base_path: this.basePath }, 'HDFS GETACLSTATUS failed');
      return { owner: 'Unknown', grants: [] };
    }
  }

  /** WebHDFS has no server-side copy, so file data streams through cockpit. */
  async copyObject(
    sourceKey: string,
    destKey: string,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    const sourcePath = this.path(sourceKey);
    const destPath = this.path(destKey);
    if (sourceKey.endsWith('/')) {
      log.trace({ source: sourcePath, dest: destPath }, 'HDFS copy directory (MKDIRS)');
      await this.client.getFileStatus(sourcePath);
      await this.client.mkdirs(destPath);
      return;
    }
    log.trace({ source: sourcePath, dest: destPath }, 'HDFS copy file (OPEN → CREATE)');
    const status = await this.client.getFileStatus(sourcePath);
    const stream = await this.client.open(sourcePath);
    await this.client.create(
      destPath,
      onProgress ? withProgress(stream, status.length, onProgress) : stream,
      { overwrite: true }
    );
  }

  async move(sourceKey: string, destKey: string): Promise<void> {
    const sourcePath = this.path(sourceKey);
    const destPath = this.path(destKey);
    // HDFS RENAME into an existing directory moves the source inside it;
    // refuse instead so semantics match the S3 copy + delete path.
    if (await this.exists(destKey)) throw error(409, `Destination "${destKey}" already exists`);
    const parent = destPath.slice(0, destPath.lastIndexOf('/')) || '/';
    if (parent !== '/') await this.client.mkdirs(parent);

    log.trace({ source: sourcePath, dest: destPath }, 'HDFS RENAME');
    if (!(await this.client.rename(sourcePath, destPath))) {
      if (!(await this.exists(sourceKey))) throw error(404, `Source "${sourceKey}" not found`);
      throw error(502, `HDFS refused to move "${sourceKey}" to "${destKey}"`);
    }
  }
}
