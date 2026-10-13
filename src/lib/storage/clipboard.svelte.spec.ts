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
import { StorageError } from './errors.js';

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

describe('rename on conflict', () => {
  /**
   * A move endpoint that refuses a taken explicit destination key with a per-item failure in a
   * successful response (how the server answered before the fix, and still does when streaming).
   */
  function refusingTransfer(existing: Set<string>) {
    return vi.fn(
      async ({
        sourceKeys,
        destinationPrefix,
        destinationKey
      }: Parameters<StorageApi['move']>[0]) => {
        const sourceKey = sourceKeys[0];
        const destKey = destinationKey ?? destinationPrefix + sourceKey.split('/').pop();
        if (destinationKey && existing.has(destinationKey)) return { results: [], failed: 1 };
        return { results: [{ sourceKey, destKey }], failed: 0 };
      }
    );
  }

  function movedSourceKeys(api: StorageApi): string[][] {
    return vi.mocked(api.move).mock.calls.map(([params]) => params.sourceKeys);
  }

  /** Drag `keys` into `destPrefix`, then rename every conflict to `customName`. */
  async function moveRenamingTo(state: StorageState, keys: string[], customName: string) {
    state.performMove('', keys);
    await state.confirmMove();
    expect(state.activeModal?.type).toBe('resolve-conflicts');
    const entries = (state.activeModal!.payload as { entries: ConflictEntry[] }).entries;
    await state.confirmConflictResolution(
      entries.map((e) =>
        e.conflict
          ? { ...e, resolution: 'rename', customName, renameState: 'ok' }
          : { ...e, resolution: 'replace' }
      )
    );
  }

  it('moves the dragged item straight to its new name, never a source sibling', async () => {
    // `src/b.txt` exists next to the source; the destination has no `b.txt`.
    const api = makeApi({
      checkObjectExists: async ({ key }) => key === 'a.txt',
      move: refusingTransfer(new Set(['a.txt', 'src/a.txt', 'src/b.txt']))
    });
    const state = makeState(api, clipboard('copy', []));
    state.prefix = 'src/';

    await moveRenamingTo(state, ['src/a.txt'], 'b.txt');

    expect(movedSourceKeys(api)).toEqual([['src/a.txt']]);
    expect(api.move).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKeys: ['src/a.txt'], destinationKey: 'b.txt' })
    );
    expect(addToast).toHaveBeenCalledWith('success', '1 item moved');
  });

  it('reports a refused rename as an error and moves nothing else', async () => {
    const api = makeApi({
      checkObjectExists: async ({ key }) => key === 'a.txt',
      move: refusingTransfer(new Set(['a.txt', 'b.txt', 'src/a.txt']))
    });
    const state = makeState(api, clipboard('copy', []));
    state.prefix = 'src/';

    await moveRenamingTo(state, ['src/a.txt'], 'b.txt');

    expect(movedSourceKeys(api)).toEqual([['src/a.txt']]);
    expect(addToast).toHaveBeenCalledWith(
      'error',
      'Could not rename "a.txt" to "b.txt". The name may already be in use.'
    );
    expect(addToast).not.toHaveBeenCalledWith('success', expect.anything());
  });

  it('reports a rename the server rejects with 409 as an error', async () => {
    const api = makeApi({
      checkObjectExists: async ({ key }) => key === 'a.txt',
      move: vi.fn().mockRejectedValue(new StorageError('conflict', 'Destination already exists'))
    });
    const state = makeState(api, clipboard('copy', []));
    state.prefix = 'src/';

    await moveRenamingTo(state, ['src/a.txt'], 'b.txt');

    expect(movedSourceKeys(api)).toEqual([['src/a.txt']]);
    expect(addToast).toHaveBeenCalledWith(
      'error',
      'Could not rename "a.txt" to "b.txt". The name may already be in use.'
    );
    expect(addToast).not.toHaveBeenCalledWith('success', expect.anything());
  });

  it.each(['sub/b.txt', '', '..'])('refuses the invalid name %j without moving', async (name) => {
    const api = makeApi({ checkObjectExists: async ({ key }) => key === 'a.txt' });
    const state = makeState(api, clipboard('copy', []));
    state.prefix = 'src/';

    await moveRenamingTo(state, ['src/a.txt'], name);

    expect(api.move).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('error', expect.stringContaining('Could not rename'));
  });

  it('reports a refused rename after a paste and keeps the clipboard on the pasted item', async () => {
    // The server pastes `file.txt` as `file (2).txt`; renaming it to the taken `b.txt` fails.
    const api = makeApi({
      move: vi.fn(async ({ sourceKeys, destinationKey }: Parameters<StorageApi['move']>[0]) =>
        destinationKey
          ? { results: [], failed: 1 }
          : { results: [{ sourceKey: sourceKeys[0], destKey: 'file (2).txt' }], failed: 0 }
      )
    });
    const state = makeState(api, clipboard('cut', ['src/file.txt']));

    await state.executeAction('paste');
    const entries = (state.activeModal!.payload as { entries: ConflictEntry[] }).entries;
    await state.confirmConflictResolution(
      entries.map((e) => ({ ...e, resolution: 'rename', customName: 'b.txt', renameState: 'ok' }))
    );

    expect(addToast).toHaveBeenCalledWith(
      'error',
      'Could not rename "file.txt" to "b.txt". The name may already be in use.'
    );
    expect(addToast).not.toHaveBeenCalledWith('success', expect.anything());
    expect(state.clipboard).toEqual(expect.objectContaining({ keys: ['file (2).txt'] }));
  });

  /** Paste the clipboard, then rename every conflict to `customName`. */
  async function pasteRenamingTo(state: StorageState, customName: string) {
    await state.executeAction('paste');
    expect(state.activeModal?.type).toBe('resolve-conflicts');
    const entries = (state.activeModal!.payload as { entries: ConflictEntry[] }).entries;
    await state.confirmConflictResolution(
      entries.map((e) => ({ ...e, resolution: 'rename', customName, renameState: 'ok' }))
    );
  }

  /** Server pasting `other/dir/` as `dir (2)/` (children only, no marker), then renaming it. */
  function folderTransfer(renameResult?: { results: number; failed: number }) {
    return vi.fn(async ({ sourceKeys, destinationKey }: Parameters<StorageApi['move']>[0]) => {
      if (!destinationKey) {
        return {
          results: [
            { sourceKey: 'other/dir/a.txt', destKey: 'dir (2)/a.txt' },
            { sourceKey: 'other/dir/sub/b.txt', destKey: 'dir (2)/sub/b.txt' }
          ],
          failed: 0
        };
      }
      const all = [
        { sourceKey: `${sourceKeys[0]}a.txt`, destKey: `${destinationKey}a.txt` },
        { sourceKey: `${sourceKeys[0]}sub/b.txt`, destKey: `${destinationKey}sub/b.txt` }
      ];
      return {
        results: all.slice(0, renameResult?.results ?? 2),
        failed: renameResult?.failed ?? 0
      };
    });
  }

  it.each(['copy', 'cut'] as const)(
    'renames a pasted folder via its root derived from child results (%s)',
    async (action) => {
      const transfer = folderTransfer();
      const api = makeApi({ copy: transfer, move: transfer });
      const state = makeState(api, clipboard(action, ['other/dir/']));

      await pasteRenamingTo(state, 'renamed');

      expect(api.move).toHaveBeenCalledWith(
        expect.objectContaining({ sourceKeys: ['dir (2)/'], destinationKey: 'renamed/' })
      );
      expect(addToast).toHaveBeenCalledWith('success', '1 item pasted');
      expect(addToast).not.toHaveBeenCalledWith('error', expect.anything());
      if (action === 'cut') {
        expect(state.clipboard).toEqual(expect.objectContaining({ keys: ['renamed/'] }));
      }
    }
  );

  it('reports a folder paste whose root cannot be derived as a failed rename', async () => {
    const api = makeApi();
    const state = makeState(api, clipboard('copy', ['other/dir/']));

    await pasteRenamingTo(state, 'renamed');

    expect(api.move).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      'error',
      'Could not rename "dir" to "renamed". The name may already be in use.'
    );
    expect(addToast).not.toHaveBeenCalledWith('success', expect.anything());
  });

  it('reports a partly renamed folder without claiming success', async () => {
    const transfer = folderTransfer({ results: 1, failed: 1 });
    const api = makeApi({ copy: transfer, move: transfer });
    const state = makeState(api, clipboard('cut', ['other/dir/']));

    await pasteRenamingTo(state, 'renamed');

    expect(addToast).toHaveBeenCalledWith(
      'error',
      '"dir" was only partly renamed to "renamed". Some items kept their previous name.'
    );
    expect(addToast).not.toHaveBeenCalledWith('success', expect.anything());
    expect(state.clipboard).toEqual(
      expect.objectContaining({ keys: ['renamed/a.txt', 'dir (2)/sub/b.txt'] })
    );
  });

  it('moves a dragged folder straight to its new name', async () => {
    const api = makeApi({
      move: vi.fn().mockResolvedValue({
        results: [{ sourceKey: 'src/dir/a.txt', destKey: 'renamed/a.txt' }],
        failed: 0
      })
    });
    const state = makeState(api, clipboard('copy', []));
    state.prefix = 'src/';

    await moveRenamingTo(state, ['src/dir/'], 'renamed');

    expect(movedSourceKeys(api)).toEqual([['src/dir/']]);
    expect(api.move).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKeys: ['src/dir/'], destinationKey: 'renamed/' })
    );
    expect(addToast).toHaveBeenCalledWith('success', '1 item moved');
  });

  it('reports a partly moved folder rename without claiming success', async () => {
    const api = makeApi({
      move: vi.fn().mockResolvedValue({
        results: [{ sourceKey: 'src/dir/a.txt', destKey: 'renamed/a.txt' }],
        failed: 1
      })
    });
    const state = makeState(api, clipboard('copy', []));
    state.prefix = 'src/';

    await moveRenamingTo(state, ['src/dir/'], 'renamed');

    expect(addToast).toHaveBeenCalledWith(
      'error',
      '"dir" was only partly renamed to "renamed". Some items kept their previous name.'
    );
    expect(addToast).not.toHaveBeenCalledWith('success', expect.anything());
  });
});
