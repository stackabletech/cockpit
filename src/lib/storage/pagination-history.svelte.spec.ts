vi.mock('$lib/client/feature-flags.js', () => ({
  storageAutoConnectEnabled: false,
  storageRestoreTabsEnabled: false,
  allowedPageSizes: [25, 50, 100],
  defaultPageSize: 25,
  maxRecentFiles: 15,
  maxEditableFileSize: 5 * 1024 * 1024,
  uploadConcurrency: 3,
  storageCutCopyEnabled: true,
  storagePasteEnabled: true,
  storageRenameEnabled: true,
  storageMoveEnabled: true
}));

vi.mock('$lib/storage/connection-store.svelte.js', () => ({
  connectionStore: { activeConnectionId: 'test-connection-id' }
}));

vi.mock('$lib/stores/toast.svelte.js', () => ({
  addToast: vi.fn()
}));

vi.mock('$app/navigation', () => ({
  invalidateAll: vi.fn()
}));

import { describe, expect, it, vi } from 'vitest';
import { StorageState } from './state.svelte.js';
import { createMemoryStorageApi } from './api.test-utils.js';
import type { StoragePage } from './types.js';

const PAGE_COUNT = 4;

/** Page n (1-based) is reached with token `t<n>`; page 1 has no token. */
function tokenFor(pageNumber: number): string | null {
  return pageNumber === 1 ? null : `t${pageNumber}`;
}

function listing(token: string | null): StoragePage {
  const pageNumber = token ? Number(token.slice(1)) : 1;
  return {
    objects: [
      {
        key: `page-${pageNumber}.txt`,
        size: 1,
        lastModified: new Date('2025-01-01'),
        isDirectory: false,
        contentType: 'text/plain'
      }
    ],
    hasNextPage: pageNumber < PAGE_COUNT,
    currentPage: 1,
    pageSize: 25,
    continuationToken: token,
    nextContinuationToken: pageNumber < PAGE_COUNT ? tokenFor(pageNumber + 1) : null
  };
}

interface HistoryEntry {
  token: string | null;
  state: { storagePrevTokens?: (string | null)[] };
}

/**
 * Mimics the browse page: the navigation handler pushes a history entry that
 * carries the previous-page token stack in its state, and every load (push or
 * Back/Forward) calls `syncFromServer` with the state of the entry shown.
 */
function setup() {
  const state = new StorageState({
    connected: true,
    buckets: ['bucket'],
    api: createMemoryStorageApi()
  });
  const entries: HistoryEntry[] = [{ token: null, state: {} }];
  let index = 0;

  const show = () => {
    const entry = entries[index];
    state.syncFromServer('bucket', 'folder/', listing(entry.token), entry.state.storagePrevTokens);
  };

  state.setNavigationHandler((_prefix, continuationToken) => {
    entries.splice(index + 1);
    entries.push({
      token: continuationToken ?? null,
      state: { storagePrevTokens: [...state.prevTokens] }
    });
    index = entries.length - 1;
    show();
  });
  show();

  const shown = () => ({
    page: state.currentPage,
    key: state.objects.objects[0].key
  });

  return {
    state,
    shown,
    back: () => {
      index--;
      show();
    },
    forward: () => {
      index++;
      show();
    }
  };
}

describe('pagination with browser history', () => {
  it('keeps page number and Prev/Next consistent after Back and Forward', () => {
    const { state, shown, back, forward } = setup();

    state.navigateNext();
    state.navigateNext();
    expect(shown()).toEqual({ page: 3, key: 'page-3.txt' });

    back();
    expect(shown()).toEqual({ page: 2, key: 'page-2.txt' });
    back();
    expect(shown()).toEqual({ page: 1, key: 'page-1.txt' });
    forward();
    expect(shown()).toEqual({ page: 2, key: 'page-2.txt' });

    state.navigatePrev();
    expect(shown()).toEqual({ page: 1, key: 'page-1.txt' });
    state.navigateNext();
    state.navigateNext();
    state.navigateNext();
    expect(shown()).toEqual({ page: 4, key: 'page-4.txt' });
  });

  it('restores the stack of the entry when going Back after Prev', () => {
    const { state, shown, back } = setup();

    state.navigateNext();
    state.navigateNext();
    state.navigatePrev();
    expect(shown()).toEqual({ page: 2, key: 'page-2.txt' });

    back();
    expect(shown()).toEqual({ page: 3, key: 'page-3.txt' });
    state.navigatePrev();
    expect(shown()).toEqual({ page: 2, key: 'page-2.txt' });
  });

  it('resets the stack when a first page is shown without history state', () => {
    const state = new StorageState({ api: createMemoryStorageApi() });
    state.bucket = 'bucket';
    state.prevTokens = [null, 't2'];

    state.syncFromServer('bucket', 'other/', listing(null));

    expect(state.prevTokens).toEqual([]);
  });

  it('keeps the stack when the current page is reloaded without history state', () => {
    const state = new StorageState({ api: createMemoryStorageApi() });
    state.bucket = 'bucket';
    state.prefix = 'folder/';
    state.prevTokens = [null, 't2'];

    state.syncFromServer('bucket', 'folder/', listing('t3'));

    expect(state.currentPage).toBe(3);
  });

  it('drops the stack for a later page of another folder without history state', () => {
    const state = new StorageState({ api: createMemoryStorageApi() });
    state.bucket = 'bucket';
    state.prefix = 'folder/';
    state.prevTokens = [null, 't2'];

    state.syncFromServer('bucket', 'other/', listing('t3'));

    expect(state.prevTokens).toEqual([]);
  });
});
