/**
 * In-memory StorageApi implementation for unit tests.
 *
 * Provides sensible defaults (empty list, no-op mutations) and allows
 * overriding any method via the `overrides` parameter.
 *
 * Usage:
 *   const api = createMemoryStorageApi({
 *     list: async () => ({ objects: [mockFile], hasNextPage: false, ... }),
 *   });
 */

import type { StorageApi, DeleteResult, JobStatus } from './api.js';
import type { StoragePage, ArchiveListingResponse } from './types.js';
import type { FileDetails, DirectoryMetadata, BucketDetails } from './details-types.js';
import type {
  PlanItem,
  TransferBody,
  TransferEvent,
  TransferItemResult,
  TransferSummary
} from './transfer-types.js';
import { keyToName, parentPrefix } from './utils.js';

/** Where an item of a transfer request lands when nothing is in the way. */
export function plainDestRoot(body: TransferBody, item: TransferBody['items'][number]): string {
  const suffix = item.sourceKey.endsWith('/') ? '/' : '';
  if (body.op === 'rename') return parentPrefix(item.sourceKey) + item.name + suffix;
  const name = item.policy === 'rename' ? item.name! : keyToName(item.sourceKey);
  return body.dest!.prefix + name + suffix;
}

/**
 * A `transfer` implementation that streams the given per-item outcomes (by
 * source key; default `done`) and ends with `complete` unless `complete: false`.
 */
export function fakeTransfer(
  outcomes: Record<string, Partial<TransferItemResult>> = {},
  options: { complete?: boolean } = {}
): StorageApi['transfer'] {
  return async (body, onEvent) => {
    const summary: TransferSummary = { done: 0, partial: 0, failed: 0, refused: 0, cancelled: 0 };
    for (const item of body.items) {
      const result: TransferItemResult = {
        sourceKey: item.sourceKey,
        destRoot: plainDestRoot(body, item),
        status: 'done',
        copied: 1,
        failed: [],
        deletedOriginals: body.op === 'copy' ? 0 : 1,
        ...outcomes[item.sourceKey]
      };
      summary[result.status]++;
      onEvent({ type: 'item-done', ...result } satisfies TransferEvent);
    }
    const complete = options.complete ?? true;
    if (complete) onEvent({ type: 'complete', summary });
    return { complete };
  };
}

const emptyPage: StoragePage = {
  objects: [],
  hasNextPage: false,
  currentPage: 1,
  pageSize: 25
};

/**
 * Create an in-memory `StorageApi` backed by sensible defaults.
 *
 * Every method returns a safe no-op value by default. Pass an `overrides`
 * object to replace any subset of methods with custom behaviour.
 */
export function createMemoryStorageApi(overrides?: Partial<StorageApi>): StorageApi {
  const defaults: StorageApi = {
    async list() {
      return emptyPage;
    },

    async search() {
      return { results: [] };
    },

    async listRecentSearches() {
      return [];
    },

    async recordRecentSearch() {
      // no-op
    },

    async clearRecentSearches() {
      // no-op
    },

    async planTransfer(body): Promise<PlanItem[]> {
      return body.source.keys.map((sourceKey) => ({
        sourceKey,
        kind: sourceKey.endsWith('/') ? 'folder' : 'file',
        destKey: body.dest.prefix + keyToName(sourceKey) + (sourceKey.endsWith('/') ? '/' : ''),
        conflict: 'none'
      }));
    },

    transfer: fakeTransfer(),

    async readTransferJob() {
      return { status: 'not_found' };
    },

    async delete(): Promise<DeleteResult> {
      return { failed: [] };
    },

    async create() {
      // no-op
    },

    async archiveExtract() {
      return new Response(null, { status: 200 });
    },

    async archiveListing(): Promise<ArchiveListingResponse> {
      return { entries: [], hasMore: false };
    },

    async pollJob(): Promise<JobStatus> {
      return { status: 'done' };
    },

    async cancelJob() {
      // no-op
    },

    async createDownloadManifest() {
      return {
        id: 'download-manifest',
        files: [],
        expiresAt: new Date().toISOString()
      };
    },

    async listDownloadHistory() {
      return [];
    },

    async clearDownloadHistory() {
      // no-op
    },

    async recreateDownloadManifest() {
      return { id: 'download-manifest', files: [], expiresAt: new Date().toISOString() };
    },

    async checkObjectExists() {
      return false;
    },

    async download() {
      return new Response(null, { status: 200 });
    },

    async preview() {
      return new Response(null, { status: 200 });
    },

    async saveText() {
      return { etag: null };
    },

    async details(): Promise<FileDetails> {
      return {} as FileDetails;
    },

    async directoryMetadata(): Promise<DirectoryMetadata> {
      return {} as DirectoryMetadata;
    },

    async directorySize() {
      return new Response(null, { status: 200 });
    },

    async bucketDetails(): Promise<BucketDetails> {
      return {} as BucketDetails;
    },

    async checkBucket() {
      return { ok: true, status: 200 };
    },

    async updateConnections() {
      // no-op
    }
  };

  return { ...defaults, ...overrides };
}
