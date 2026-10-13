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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageState } from './state.svelte.js';
import type { StorageApi } from './api.js';
import type { ClipboardData } from './types.js';
import type { ConflictEntry } from '$lib/components/storage/modals/shared/conflict-types.js';
import { createMemoryStorageApi } from './api.test-utils.js';
import { makePage } from './state.test-utils.js';
import { addToast } from '$lib/stores/toast.svelte.js';

/** Existing bucket contents: file `file.txt` and folder `dir/` (with a child, no marker). */
const EXISTING_FILES = new Set(['file.txt', 'dir/child.txt']);

function makeApi(overrides?: Partial<StorageApi>): StorageApi {
  return createMemoryStorageApi({
    list: async ({ prefix }) =>
      makePage(
        prefix
          ? [...EXISTING_FILES]
              .filter((key) => key.startsWith(prefix) && key !== prefix)
              .map((key) => ({
                key,
                size: 1,
                lastModified: new Date('2025-01-01'),
                isDirectory: false,
                contentType: 'text/plain'
              }))
          : undefined
      ),
    checkObjectExists: async ({ key }) => EXISTING_FILES.has(key),
    copy: vi.fn().mockResolvedValue({ results: [], failed: 0 }),
    move: vi.fn().mockResolvedValue({ results: [], failed: 0 }),
    delete: vi.fn().mockResolvedValue({ failed: [] }),
    ...overrides
  });
}

function makeState(api: StorageApi, clipboard: ClipboardData): StorageState {
  const state = new StorageState({ connected: true, buckets: ['test-bucket'], api });
  state.bucket = 'test-bucket';
  state.prefix = '';
  state.objects = makePage();
  state.clipboardState.clipboard = clipboard;
  return state;
}

function clipboard(action: 'copy' | 'cut', keys: string[]): ClipboardData {
  return { action, keys, sourceBucket: 'test-bucket', sourcePrefix: '', fileSizes: {} };
}

/** Paste, then answer the conflict dialog (if any) with `resolution` for every conflict. */
async function pasteResolvingWith(
  state: StorageState,
  resolution: ConflictEntry['resolution']
): Promise<ConflictEntry[] | null> {
  await state.executeAction('paste');
  if (state.activeModal?.type !== 'resolve-conflicts') return null;
  const entries = (state.activeModal.payload as { entries: ConflictEntry[] }).entries;
  await state.confirmConflictResolution(
    entries.map((e) => ({ ...e, resolution: e.conflict ? resolution : 'replace' }))
  );
  return entries;
}

function deletedKeys(api: StorageApi): string[] {
  return vi.mocked(api.delete).mock.calls.flatMap(([params]) => params.keys);
}

function transferredKeys(api: StorageApi): string[] {
  return [...vi.mocked(api.copy).mock.calls, ...vi.mocked(api.move).mock.calls].flatMap(
    ([params]) => params.sourceKeys
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('paste conflict detection', () => {
  it('detects a conflict between a pasted folder and an existing folder', async () => {
    const api = makeApi();
    const state = makeState(api, clipboard('copy', ['other/dir/']));

    await state.executeAction('paste');

    expect(state.activeModal?.type).toBe('resolve-conflicts');
    const entries = (state.activeModal!.payload as { entries: ConflictEntry[] }).entries;
    expect(entries).toEqual([expect.objectContaining({ originalName: 'dir', conflict: true })]);
  });

  it('does not treat a file named like the pasted folder as a conflict', async () => {
    const api = makeApi({ checkObjectExists: async ({ key }) => key === 'reports' });
    const state = makeState(api, clipboard('copy', ['other/reports/']));

    await state.executeAction('paste');

    expect(state.activeModal).toBeNull();
    expect(api.copy).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKeys: ['other/reports/'], destinationPrefix: '' })
    );
  });

  it('does not treat a folder named like the pasted file as a conflict', async () => {
    const api = makeApi();
    const state = makeState(api, clipboard('copy', ['other/dir']));

    await state.executeAction('paste');

    expect(state.activeModal).toBeNull();
    expect(api.copy).toHaveBeenCalledWith(expect.objectContaining({ sourceKeys: ['other/dir'] }));
  });

  it('replaces an existing folder by deleting the folder prefix', async () => {
    const api = makeApi();
    const state = makeState(api, clipboard('copy', ['other/dir/']));

    await pasteResolvingWith(state, 'replace');

    expect(deletedKeys(api)).toEqual(['dir/']);
    expect(transferredKeys(api)).toEqual(['other/dir/']);
  });
});

describe('paste into the source folder', () => {
  it('copies items pasted into their own folder without asking, so the server renames them', async () => {
    const api = makeApi();
    const state = makeState(api, clipboard('copy', ['file.txt', 'dir/']));

    await state.executeAction('paste');

    expect(state.activeModal).toBeNull();
    expect(deletedKeys(api)).toEqual([]);
    expect(transferredKeys(api)).toEqual(['file.txt', 'dir/']);
    expect(api.copy).toHaveBeenCalledWith(expect.objectContaining({ destinationPrefix: '' }));
  });

  it('never offers Replace for an item pasted into its own folder', async () => {
    const api = makeApi();
    const state = makeState(api, clipboard('copy', ['file.txt', 'other/dir/']));

    const entries = await pasteResolvingWith(state, 'replace');

    expect(entries?.filter((e) => e.conflict).map((e) => e.originalName)).toEqual(['dir']);
    expect(deletedKeys(api)).toEqual(['dir/']);
    expect(transferredKeys(api)).toEqual(['file.txt', 'other/dir/']);
  });

  it('skips cut items already in the destination and moves only the others', async () => {
    const api = makeApi();
    const state = makeState(api, clipboard('cut', ['file.txt', 'other/new.txt']));

    await pasteResolvingWith(state, 'replace');

    expect(deletedKeys(api)).toEqual([]);
    expect(transferredKeys(api)).toEqual(['other/new.txt']);
  });

  it('never deletes a folder that contains the pasted item', async () => {
    // Pasting `dir/dir/` into the root would "replace" `dir/`, which holds the source.
    const api = makeApi({
      list: async ({ prefix }) =>
        makePage(
          prefix === 'dir/'
            ? [
                {
                  key: 'dir/dir/',
                  size: 0,
                  lastModified: new Date('2025-01-01'),
                  isDirectory: true,
                  contentType: undefined
                }
              ]
            : []
        )
    });
    const state = makeState(api, clipboard('cut', ['dir/dir/']));

    await pasteResolvingWith(state, 'replace');

    expect(deletedKeys(api)).toEqual([]);
    expect(transferredKeys(api)).toEqual([]);
  });
});

describe('cut and paste with conflicts', () => {
  it('points the clipboard at the moved items so a second paste cannot delete them', async () => {
    const api = makeApi({
      move: vi.fn().mockResolvedValue({
        results: [{ sourceKey: 'src/file.txt', destKey: 'file.txt' }],
        failed: 0
      })
    });
    const state = makeState(api, clipboard('cut', ['src/file.txt']));

    await pasteResolvingWith(state, 'replace');

    expect(deletedKeys(api)).toEqual(['file.txt']);
    expect(state.clipboard).toEqual(
      expect.objectContaining({ action: 'copy', keys: ['file.txt'], sourceBucket: 'test-bucket' })
    );

    await pasteResolvingWith(state, 'replace');

    expect(deletedKeys(api)).toEqual(['file.txt']);
    expect(api.copy).toHaveBeenCalledWith(expect.objectContaining({ sourceKeys: ['file.txt'] }));
  });
});

describe('paste a folder into itself', () => {
  it.each(['copy', 'cut'] as const)(
    'refuses to %s a folder into its own subfolder',
    async (action) => {
      // `docs/sub/docs/` exists, so a Replace would delete part of the source tree.
      const api = makeApi({
        checkObjectExists: async ({ key }) => key === 'docs/sub/docs/'
      });
      const state = makeState(api, clipboard(action, ['docs/']));
      state.prefix = 'docs/sub/';

      await pasteResolvingWith(state, 'replace');

      expect(state.activeModal).toBeNull();
      expect(deletedKeys(api)).toEqual([]);
      expect(transferredKeys(api)).toEqual([]);
      expect(addToast).toHaveBeenCalledWith('warning', 'Cannot paste a folder into itself.');
    }
  );

  it('allows pasting a folder into a same-named path in another bucket', async () => {
    const api = makeApi();
    const state = makeState(api, {
      ...clipboard('copy', ['docs/']),
      sourceBucket: 'other-bucket'
    });
    state.prefix = 'docs/sub/';

    await state.executeAction('paste');

    expect(transferredKeys(api)).toEqual(['docs/']);
  });
});

describe('performMove', () => {
  it('moves a folder into a same-named path in another bucket', () => {
    const state = makeState(makeApi(), clipboard('copy', []));

    state.performMove('dir/sub/', ['dir/'], 'other-bucket');

    expect(state.activeModal?.type).toBe('confirm-move');
  });

  it('refuses to move a folder into itself', () => {
    const state = makeState(makeApi(), clipboard('copy', []));

    state.performMove('dir/sub/', ['dir/']);

    expect(state.activeModal).toBeNull();
  });

  it('moves an item to the same path in another bucket', () => {
    const state = makeState(makeApi(), clipboard('copy', []));

    state.performMove('', ['file.txt'], 'other-bucket');

    expect(state.activeModal?.type).toBe('confirm-move');
  });

  it('ignores a move into the folder the item already lives in', () => {
    const state = makeState(makeApi(), clipboard('copy', []));

    state.performMove('', ['file.txt']);

    expect(state.activeModal).toBeNull();
  });
});
