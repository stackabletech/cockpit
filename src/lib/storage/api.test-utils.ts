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

import type { StorageApi, CopyMoveResult, DeleteResult, JobStatus } from './api.js';
import type { StoragePage, ArchiveListingResponse } from './types.js';
import type { FileDetails, DirectoryMetadata, BucketDetails } from './details-types.js';

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

    async copy(): Promise<CopyMoveResult> {
      return { results: [], failed: 0 };
    },

    async move(): Promise<CopyMoveResult> {
      return { results: [], failed: 0 };
    },

    async rename() {
      // no-op
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

    async checkObjectExists() {
      return false;
    },

    async preview() {
      return new Response(null, { status: 200 });
    },

    async saveText() {
      // no-op
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
