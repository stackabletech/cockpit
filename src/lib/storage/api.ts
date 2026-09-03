/**
 * Typed StorageApi interface and factory.
 *
 * Provides a single entry point for all S3 storage operations, abstracting
 * the HTTP transport behind a clean interface. This enables:
 *  - Mocking in tests via `createMemoryStorageApi()`
 *  - Centralised error handling and connection management
 *  - Type-safe method signatures matching the server API contract
 *
 * Create via:
 *   const api = createFetchStorageApi(() => connectionStore.activeConnectionId);
 */

import { STORAGE_CONNECTION_ID_HEADER } from './connection-id-header.js';
import { createStorageFetch } from './storage-fetch.js';
import { readNdjsonStream, type NdjsonStreamCallbacks } from './ndjson-stream.js';
import { serializeFilter, type SearchFilterSpec } from './search-filter.js';
import type {
  StoragePage,
  ArchiveListingResponse,
  StorageSearchResponse,
  StorageSearchUpdate,
  RecentSearchEntry
} from './types.js';
import type { FileDetails, DirectoryMetadata, BucketDetails } from './details-types.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CopyMoveResult {
  results: Array<{ sourceKey: string; destKey: string }>;
  failed: number;
}

export interface DeleteResult {
  failed: Array<{ key: string; code?: string; message?: string }>;
}

export interface JobStatus {
  status: string;
  progress?: {
    completedCount?: number;
    completedBytes?: number;
    currentFileName?: string;
  };
}

export interface DownloadManifestResponse {
  id: string;
  files: Array<{ filename: string; size: number; part: number }>;
  expiresAt: string;
}

export interface DownloadHistoryEntry {
  id: string;
  bucket: string;
  connectionId: string;
  entries: Array<{ key: string; size: number; isDirectory: boolean }>;
  archive: boolean;
  archiveFilename: string | null;
  createdAt: string;
  expiresAt: string;
}

// ── Interface ──────────────────────────────────────────────────────────────

export interface StorageApi {
  list(params: { bucket: string; prefix?: string; pageSize?: number }): Promise<StoragePage>;

  search(params: {
    bucket: string;
    query: string;
    prefix?: string;
    maxDepth?: number;
    useRegex?: boolean;
    excludePatterns?: string[];
    filters?: SearchFilterSpec[];
    signal?: AbortSignal;
    onUpdate?: (update: StorageSearchUpdate) => void;
  }): Promise<StorageSearchResponse>;

  listRecentSearches(): Promise<RecentSearchEntry[]>;

  recordRecentSearch(params: {
    buckets: string[];
    query: string;
    useRegex?: boolean;
    excludePatterns?: string[];
    searchPath?: string;
    maxDepth?: number | null;
  }): Promise<void>;

  clearRecentSearches(): Promise<void>;

  copy(params: {
    bucket: string;
    sourceKeys: string[];
    destinationPrefix: string;
    progress?: boolean;
    jobId?: string;
    signal?: AbortSignal;
    callbacks?: NdjsonStreamCallbacks;
  }): Promise<CopyMoveResult>;

  move(params: {
    bucket: string;
    sourceKeys: string[];
    destinationPrefix: string;
    progress?: boolean;
    jobId?: string;
    signal?: AbortSignal;
    callbacks?: NdjsonStreamCallbacks;
  }): Promise<CopyMoveResult>;

  rename(params: { bucket: string; key: string; newKey: string }): Promise<void>;

  delete(params: { bucket: string; keys: string[] }): Promise<DeleteResult>;

  create(params: { bucket: string; key: string }): Promise<void>;

  archiveExtract(params: {
    bucket: string;
    key: string;
    path: string;
    nestedArchivePath?: string;
  }): Promise<Response>;

  archiveListing(params: {
    bucket: string;
    key: string;
    internalPrefix?: string;
    nestedArchivePath?: string;
  }): Promise<ArchiveListingResponse>;

  pollJob(jobId: string): Promise<JobStatus>;

  cancelJob(jobId: string): Promise<void>;

  createDownloadManifest(
    params: {
      bucket: string;
      prefix: string;
      keys: string[];
    },
    signal?: AbortSignal
  ): Promise<DownloadManifestResponse>;

  listDownloadHistory(connectionId: string): Promise<DownloadHistoryEntry[]>;

  clearDownloadHistory(): Promise<void>;

  recreateDownloadManifest(manifestId: string, keys: string[]): Promise<DownloadManifestResponse>;

  checkObjectExists(params: { bucket: string; key: string }): Promise<boolean>;

  download(params: { bucket: string; key: string }): Promise<Response>;

  preview(params: {
    bucket: string;
    key: string;
    offset?: number;
    limit?: number;
    data?: boolean;
  }): Promise<Response>;

  saveText(params: {
    bucket: string;
    key: string;
    body: string;
    originalSize: number;
    previewBytes: number;
    contentType: string;
  }): Promise<void>;

  details(params: { bucket: string; key: string }): Promise<FileDetails>;

  directoryMetadata(params: { bucket: string; prefix: string }): Promise<DirectoryMetadata>;

  directorySize(params: { bucket: string; prefix: string }): Promise<Response>;

  bucketDetails(params: { bucket: string }): Promise<BucketDetails>;

  checkBucket(params: { bucket: string }): Promise<{ ok: boolean; status: number }>;

  updateConnections(params: { bucket: string }): Promise<void>;
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a `StorageApi` instance backed by real HTTP fetch calls.
 *
 * @param getConnectionId  A function returning the active connection ID
 *                         (or `null` when disconnected).
 */
export function createFetchStorageApi(getConnectionId: () => string | null): StorageApi {
  const fetch_ = createStorageFetch(getConnectionId);

  return {
    async list({ bucket, prefix = '', pageSize }) {
      const params = new URLSearchParams({ bucket, prefix: prefix ?? '' });
      if (pageSize !== undefined) {
        params.set('pageSize', String(pageSize));
      }
      const res = await fetch_(`/api/storage/list?${params}`);
      return (await res.json()) as StoragePage;
    },

    async search({
      bucket,
      query,
      prefix,
      maxDepth,
      useRegex,
      excludePatterns,
      filters,
      signal,
      onUpdate
    }) {
      const params = new URLSearchParams({ bucket, q: query });
      if (prefix) params.set('prefix', prefix);
      if (maxDepth !== undefined) params.set('maxDepth', String(maxDepth));
      if (useRegex) params.set('regex', 'true');
      for (const pattern of excludePatterns ?? []) params.append('exclude', pattern);
      for (const filter of filters ?? []) params.append('filter', serializeFilter(filter));
      const res = await fetch_(`/api/storage/search?${params}`, { signal });
      const { readSearchStream } = await import('./search-stream.js');
      return readSearchStream(res.body, onUpdate);
    },

    async listRecentSearches() {
      const res = await fetch_('/api/storage/search/history');
      return (await res.json()) as RecentSearchEntry[];
    },

    async recordRecentSearch({ buckets, query, useRegex, excludePatterns, searchPath, maxDepth }) {
      await fetch_('/api/storage/search/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buckets, query, useRegex, excludePatterns, searchPath, maxDepth })
      });
    },

    async clearRecentSearches() {
      await fetch_('/api/storage/search/history', { method: 'DELETE' });
    },

    async copy({ bucket, sourceKeys, destinationPrefix, progress, jobId, signal, callbacks }) {
      return copyMoveRequest(fetch_, '/api/storage/copy', {
        bucket,
        sourceKeys,
        destinationPrefix,
        progress,
        jobId,
        signal,
        callbacks
      });
    },

    async move({ bucket, sourceKeys, destinationPrefix, progress, jobId, signal, callbacks }) {
      return copyMoveRequest(fetch_, '/api/storage/move', {
        bucket,
        sourceKeys,
        destinationPrefix,
        progress,
        jobId,
        signal,
        callbacks
      });
    },

    async rename({ bucket, key, newKey }) {
      const params = new URLSearchParams({ bucket });
      await fetch_(`/api/storage/rename?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, newKey })
      });
    },

    async delete({ bucket, keys }) {
      const params = new URLSearchParams({ bucket });
      for (const key of keys) {
        params.append('keys', key);
      }
      const res = await fetch_(`/api/storage/delete?${params}`, {
        method: 'DELETE'
      });
      return (await res.json()) as DeleteResult;
    },

    async create({ bucket, key }) {
      const params = new URLSearchParams({ bucket, key });
      await fetch_(`/api/storage/create?${params}`, {
        method: 'POST'
      });
    },

    async archiveExtract({ bucket, key, path: filePath, nestedArchivePath }) {
      const params = new URLSearchParams({ bucket, key, path: filePath });
      if (nestedArchivePath) {
        params.set('nestedArchivePath', nestedArchivePath);
      }
      // Returns raw Response for blob download — caller consumes the body.
      return fetch_(`/api/storage/archive/extract?${params}`);
    },

    async archiveListing({ bucket, key, internalPrefix = '', nestedArchivePath }) {
      const params = new URLSearchParams({ bucket, key, internalPrefix });
      if (nestedArchivePath) {
        params.set('nestedArchivePath', nestedArchivePath);
      }
      const res = await fetch_(`/api/storage/archive/listing?${params}`);
      return (await res.json()) as ArchiveListingResponse;
    },

    async pollJob(jobId) {
      const res = await fetch_(`/api/storage/copy/job/${jobId}`);
      return (await res.json()) as JobStatus;
    },

    async cancelJob(jobId) {
      await fetch_(`/api/storage/copy/job/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    },

    async createDownloadManifest({ bucket, prefix, keys }, signal) {
      const params = new URLSearchParams({ bucket, prefix });
      const res = await fetch_(`/api/storage/download/manifests?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
        signal
      });
      return (await res.json()) as DownloadManifestResponse;
    },

    async listDownloadHistory(connectionId) {
      const res = await fetch(
        `/api/storage/download/manifests?${new URLSearchParams({ connectionId })}`
      );
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      return (await res.json()) as DownloadHistoryEntry[];
    },

    async clearDownloadHistory() {
      await fetch_('/api/storage/download/manifests', { method: 'DELETE' });
    },

    async recreateDownloadManifest(manifestId, keys) {
      const res = await fetch_(
        `/api/storage/download/manifests/${encodeURIComponent(manifestId)}/redownload`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys })
        }
      );
      return (await res.json()) as DownloadManifestResponse;
    },

    async checkObjectExists({ bucket, key }) {
      const params = new URLSearchParams({ bucket, key });
      try {
        const res = await fetch_(`/api/storage/download?${params}`, {
          method: 'HEAD'
        });
        return res.ok;
      } catch {
        return false;
      }
    },

    async download({ bucket, key }) {
      const params = new URLSearchParams({ bucket, key });
      return fetch_(`/api/storage/download?${params}`);
    },

    async preview({ bucket, key, offset, limit, data }) {
      const params = new URLSearchParams({ bucket, key });
      if (offset !== undefined) params.set('offset', String(offset));
      if (limit !== undefined) params.set('limit', String(limit));
      if (data) params.set('data', 'true');
      return fetch_(`/api/storage/preview?${params}`);
    },

    async saveText({ bucket, key, body, originalSize, previewBytes, contentType }) {
      const params = new URLSearchParams({
        bucket,
        key,
        originalSize: String(originalSize),
        previewBytes: String(previewBytes),
        contentType
      });
      await fetch_(`/api/storage/save-text?${params}`, {
        method: 'POST',
        body
      });
    },

    async details({ bucket, key }) {
      const params = new URLSearchParams({ bucket, key });
      const res = await fetch_(`/api/storage/details?${params}`);
      return (await res.json()) as FileDetails;
    },

    async directoryMetadata({ bucket, prefix }) {
      const params = new URLSearchParams({ bucket, prefix, metadata: 'true' });
      const res = await fetch_(`/api/storage/directory-metadata?${params}`);
      return (await res.json()) as DirectoryMetadata;
    },

    async directorySize({ bucket, prefix }) {
      const params = new URLSearchParams({ bucket, prefix });
      return fetch_(`/api/storage/directory-size?${params}`);
    },

    async bucketDetails({ bucket }) {
      const params = new URLSearchParams({ bucket, details: 'true' });
      const res = await fetch_(`/api/storage/buckets?${params}`);
      return (await res.json()) as BucketDetails;
    },

    async checkBucket({ bucket }) {
      const params = new URLSearchParams({ bucket });
      const res = await fetch(`/api/storage/check-bucket?${params}`, {
        headers: { [STORAGE_CONNECTION_ID_HEADER]: getConnectionId() ?? '' }
      });
      return { ok: res.ok, status: res.status };
    },

    async updateConnections({ bucket }) {
      await fetch_(`/api/storage/connections`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket })
      });
    }
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Shared implementation for copy and move requests.
 * When `progress=true`, the response is an NDJSON stream.
 */
async function copyMoveRequest(
  fetch_: (path: string, init?: RequestInit) => Promise<Response>,
  endpoint: string,
  params: {
    bucket: string;
    sourceKeys: string[];
    destinationPrefix: string;
    progress?: boolean;
    jobId?: string;
    signal?: AbortSignal;
    callbacks?: NdjsonStreamCallbacks;
  }
): Promise<CopyMoveResult> {
  const urlParams = new URLSearchParams({ bucket: params.bucket });
  if (params.progress) {
    urlParams.set('progress', 'true');
  }

  const res = await fetch_(`${endpoint}?${urlParams}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceKeys: params.sourceKeys,
      destinationPrefix: params.destinationPrefix,
      jobId: params.jobId
    }),
    signal: params.signal
  });

  if (params.progress) {
    const streamResult = await readNdjsonStream(res.body, params.callbacks);
    return {
      results: streamResult.results,
      failed: streamResult.failed.length
    };
  }

  const data = (await res.json()) as {
    results?: Array<{ sourceKey: string; destKey: string }>;
    moved?: Array<{ sourceKey: string; destKey: string }>;
    failed?: Array<unknown>;
  };
  const results = data.results ?? data.moved ?? [];
  return { results, failed: data.failed?.length ?? 0 };
}
