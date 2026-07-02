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
  storageRenameEnabled: true
}));

vi.mock('$lib/storage/connection-storage.js', () => ({
  STORAGE_CONNECTION_HEADER: 'x-storage-connection',
  loadConnectionLocally: vi.fn(() => ({ id: 'test-conn', type: 's3' })),
  getConnectionHeader: vi.fn(() => 'test-conn-header'),
  saveConnectionLocally: vi.fn(),
  loadAllConnectionsLocally: vi.fn(() => []),
  removeConnectionLocally: vi.fn()
}));

vi.mock('$lib/stores/toast.svelte.js', () => ({
  addToast: vi.fn()
}));

vi.mock('$app/navigation', () => ({
  invalidateAll: vi.fn()
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { StorageState } from './state.svelte.js';
import type { StorageObject, StoragePage } from './types.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import { invalidateAll } from '$app/navigation';

function makeObjects(): StorageObject[] {
  return [
    {
      key: 'file.txt',
      size: 100,
      lastModified: new Date('2025-01-01'),
      isDirectory: false,
      contentType: 'text/plain'
    },
    {
      key: 'dir/',
      size: 0,
      lastModified: new Date('2025-01-01'),
      isDirectory: true,
      contentType: undefined
    },
    {
      key: 'photo.jpg',
      size: 500,
      lastModified: new Date('2025-01-01'),
      isDirectory: false,
      contentType: 'image/jpeg'
    },
    {
      key: 'nested/file.js',
      size: 200,
      lastModified: new Date('2025-01-01'),
      isDirectory: false,
      contentType: 'application/javascript'
    }
  ];
}

function makePage(objects?: StorageObject[]): StoragePage {
  return {
    objects: objects ?? makeObjects(),
    hasNextPage: false,
    currentPage: 1,
    pageSize: 25
  };
}

function makeState(overrides?: Partial<StorageState>): StorageState {
  const state = new StorageState({ connected: true, buckets: ['test-bucket'] });
  state.bucket = 'test-bucket';
  state.prefix = '';
  state.objects = makePage();
  if (overrides) {
    Object.assign(state, overrides);
  }
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// executeAction – cut
// ────────────────────────────────────────────────────────────────────────────

describe('executeAction("cut")', () => {
  it('sets clipboard with action="cut" and selected keys', async () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt', 'dir/']);

    await state.executeAction('cut');

    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.action).toBe('cut');
    expect(state.clipboard!.keys.sort()).toEqual(['dir/', 'file.txt']);
    expect(state.clipboard!.sourceBucket).toBe('test-bucket');
  });

  it('stores file sizes for non-directory items', async () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt', 'photo.jpg']);

    await state.executeAction('cut');

    expect(state.clipboard!.fileSizes).toEqual({ 'file.txt': 100, 'photo.jpg': 500 });
  });

  it('does nothing with empty selection', async () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>();

    await state.executeAction('cut');

    expect(state.clipboard).toBeNull();
  });

  it('shows an info toast with the count', async () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);

    await state.executeAction('cut');

    expect(addToast).toHaveBeenCalledWith('info', expect.stringContaining('cut'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// executeAction – copy
// ────────────────────────────────────────────────────────────────────────────

describe('executeAction("copy")', () => {
  it('sets clipboard with action="copy" and selected keys', async () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt', 'nested/file.js']);

    await state.executeAction('copy');

    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.action).toBe('copy');
    expect(state.clipboard!.keys.sort()).toEqual(['file.txt', 'nested/file.js']);
  });

  it('stores file sizes for non-directory items', async () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt', 'dir/']);

    await state.executeAction('copy');

    expect(state.clipboard!.fileSizes).toEqual({ 'file.txt': 100 });
  });

  it('does nothing with empty selection', async () => {
    const state = makeState();

    await state.executeAction('copy');

    expect(state.clipboard).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// isCutKey
// ────────────────────────────────────────────────────────────────────────────

describe('isCutKey', () => {
  it('returns true when key is in clipboard with cut action and matching bucket', () => {
    const state = makeState();
    state.clipboard = {
      action: 'cut',
      keys: ['file.txt', 'dir/'],
      sourceBucket: 'test-bucket',
      fileSizes: {}
    };

    expect(state.isCutKey('file.txt')).toBe(true);
    expect(state.isCutKey('dir/')).toBe(true);
  });

  it('returns false for keys not in clipboard', () => {
    const state = makeState();
    state.clipboard = {
      action: 'cut',
      keys: ['file.txt'],
      sourceBucket: 'test-bucket',
      fileSizes: {}
    };

    expect(state.isCutKey('photo.jpg')).toBe(false);
  });

  it('returns false when clipboard action is copy', () => {
    const state = makeState();
    state.clipboard = {
      action: 'copy',
      keys: ['file.txt'],
      sourceBucket: 'test-bucket',
      fileSizes: {}
    };

    expect(state.isCutKey('file.txt')).toBe(false);
  });

  it('returns false when bucket does not match', () => {
    const state = makeState();
    state.clipboard = {
      action: 'cut',
      keys: ['file.txt'],
      sourceBucket: 'other-bucket',
      fileSizes: {}
    };

    expect(state.isCutKey('file.txt')).toBe(false);
  });

  it('returns false when clipboard is null', () => {
    const state = makeState();
    state.clipboard = null;

    expect(state.isCutKey('file.txt')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// executeAction – paste
// ────────────────────────────────────────────────────────────────────────────

describe('executeAction("paste")', () => {
  it('shows warning when inside an archive', async () => {
    const state = makeState();
    state.clipboard = {
      action: 'copy',
      keys: ['file.txt'],
      sourceBucket: 'test-bucket',
      fileSizes: {}
    };
    Object.assign(state, { archiveKey: 'archive.zip' });

    await state.executeAction('paste');

    expect(addToast).toHaveBeenCalledWith('warning', expect.any(String));
  });

  describe('from copy', () => {
    it('calls the copy endpoint and shows success', async () => {
      const state = makeState();
      state.clipboard = {
        action: 'copy',
        keys: ['file.txt'],
        sourceBucket: 'test-bucket',
        fileSizes: { 'file.txt': 100 }
      };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ sourceKey: 'file.txt', destKey: 'dest/file.txt' }],
            failed: []
          })
      } as Response);

      await state.executeAction('paste');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/storage/copy'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"sourceKeys":["file.txt"]')
        })
      );
      expect(addToast).toHaveBeenCalledWith('success', expect.stringContaining('pasted'));
      expect(invalidateAll).toHaveBeenCalled();
    });

    it('shows error toast when all items fail (source not found)', async () => {
      const state = makeState();
      state.clipboard = {
        action: 'copy',
        keys: ['file.txt'],
        sourceBucket: 'test-bucket',
        fileSizes: {}
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ results: [], failed: [{ sourceKey: 'file.txt', error: 'Not found' }] })
      } as Response);

      await state.executeAction('paste');

      expect(addToast).toHaveBeenCalledWith(
        'error',
        expect.stringMatching(/source.*deleted|not found/i)
      );
      expect(invalidateAll).not.toHaveBeenCalled();
    });

    it('shows warning when some items fail', async () => {
      const state = makeState();
      state.clipboard = {
        action: 'copy',
        keys: ['file.txt', 'photo.jpg'],
        sourceBucket: 'test-bucket',
        fileSizes: { 'file.txt': 100, 'photo.jpg': 500 }
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ sourceKey: 'file.txt', destKey: 'dest/file.txt' }],
            failed: [{ sourceKey: 'photo.jpg', error: 'Not found' }]
          })
      } as Response);

      await state.executeAction('paste');

      expect(addToast).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('could not be pasted')
      );
    });
  });

  describe('from cut', () => {
    it('calls the move endpoint and updates clipboard to destination keys', async () => {
      const state = makeState();
      state.clipboard = {
        action: 'cut',
        keys: ['file.txt'],
        sourceBucket: 'test-bucket',
        fileSizes: { 'file.txt': 100 }
      };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            moved: [{ sourceKey: 'file.txt', destKey: 'dest/file.txt' }],
            failed: []
          })
      } as Response);

      await state.executeAction('paste');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/storage/move'),
        expect.any(Object)
      );
      // Clipboard updated to destination keys with action='copy'
      expect(state.clipboard).not.toBeNull();
      expect(state.clipboard!.action).toBe('copy');
      expect(state.clipboard!.keys).toEqual(['dest/file.txt']);
      expect(state.clipboard!.sourceBucket).toBe('test-bucket');
    });

    it('keeps original clipboard on failed move (no results)', async () => {
      const state = makeState();
      state.clipboard = {
        action: 'cut',
        keys: ['file.txt'],
        sourceBucket: 'test-bucket',
        fileSizes: { 'file.txt': 100 }
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ moved: [], failed: [{ sourceKey: 'file.txt', error: 'Not found' }] })
      } as Response);

      await state.executeAction('paste');

      // Clipboard unchanged (still cut keys)
      expect(state.clipboard!.action).toBe('cut');
      expect(state.clipboard!.keys).toEqual(['file.txt']);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// confirmRename
// ────────────────────────────────────────────────────────────────────────────

describe('confirmRename', () => {
  it('closes modal if new name is same as current', async () => {
    const state = makeState();
    state.openModal('rename', { key: 'file.txt' });
    expect(state.activeModal).not.toBeNull();

    await state.confirmRename('file.txt', 'file.txt');

    expect(state.activeModal).toBeNull();
    expect(state.renameLoading).toBe(false);
  });

  it('shows inline error on 409 conflict and keeps modal open', async () => {
    const state = makeState();
    state.openModal('rename', { key: 'file.txt' });
    const resp = new Response(null, { status: 409, statusText: 'Conflict' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp);

    await state.confirmRename('file.txt', 'renamed.txt');

    expect(state.activeModal?.type).toBe('rename');
    expect(state.renameError).toContain('already exists');
    expect(state.renameLoading).toBe(false);
  });

  it('shows toast on 403 and closes modal', async () => {
    const state = makeState();
    state.openModal('rename', { key: 'file.txt' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }));

    await state.confirmRename('file.txt', 'renamed.txt');

    expect(state.activeModal).toBeNull();
    expect(addToast).toHaveBeenCalledWith('error', expect.stringContaining('denied'));
  });

  it('shows toast on 404 and closes modal', async () => {
    const state = makeState();
    state.openModal('rename', { key: 'file.txt' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

    await state.confirmRename('file.txt', 'renamed.txt');

    expect(state.activeModal).toBeNull();
    expect(addToast).toHaveBeenCalledWith('error', expect.stringContaining('could not be found'));
  });

  it('shows success toast on successful rename and updates recent files', async () => {
    const state = makeState();
    state.openModal('rename', { key: 'file.txt' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    } as Response);
    // Seed a recent file entry for the old key
    state.bookmarks.recordFileVisit('test-bucket', 'file.txt', 100);

    await state.confirmRename('file.txt', 'renamed.txt');

    expect(state.activeModal).toBeNull();
    expect(addToast).toHaveBeenCalledWith('success', expect.stringContaining('Renamed'));
    expect(invalidateAll).toHaveBeenCalled();
    // Recent files updated
    expect(state.bookmarks.recentFiles.some((f) => f.key === 'renamed.txt')).toBe(true);
    expect(state.bookmarks.recentFiles.some((f) => f.key === 'file.txt')).toBe(false);
  });

  it('handles directory rename (trailing slash)', async () => {
    const state = makeState();
    state.openModal('rename', { key: 'dir/' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    } as Response);

    await state.confirmRename('dir/', 'renamed-dir');

    expect(addToast).toHaveBeenCalledWith('success', expect.stringContaining('Renamed'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// performMove (drag-and-drop)
// ────────────────────────────────────────────────────────────────────────────

describe('performMove', () => {
  it('does nothing when destination is the same prefix', async () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await state.performMove('');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when moving a folder into itself', async () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['dir/']);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await state.performMove('dir/sub/');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the move endpoint with selected keys', async () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          moved: [{ sourceKey: 'file.txt', destKey: 'dest/file.txt' }],
          failed: []
        })
    } as Response);

    await state.performMove('dest/');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/storage/move'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"sourceKeys":["file.txt"]')
      })
    );
    expect(addToast).toHaveBeenCalledWith('success', expect.stringContaining('moved'));
  });

  it('shows warning on partial failures', async () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt', 'photo.jpg']);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          moved: [{ sourceKey: 'file.txt', destKey: 'dest/file.txt' }],
          failed: [{ sourceKey: 'photo.jpg', error: 'Access denied' }]
        })
    } as Response);

    await state.performMove('dest/');

    expect(addToast).toHaveBeenCalledWith('warning', expect.stringContaining('could not be moved'));
  });

  it('uses explicit keys when provided', async () => {
    const state = makeState();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ moved: [], failed: [] })
    } as Response);

    await state.performMove('dest/', ['dir/file.ts']);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/storage/move'),
      expect.objectContaining({
        body: expect.stringContaining('"sourceKeys":["dir/file.ts"]')
      })
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Keyboard shortcuts
// ────────────────────────────────────────────────────────────────────────────

describe('handleKeydown', () => {
  function dispatch(state: StorageState, key: string, ctrl = false, meta = false): void {
    const event = new KeyboardEvent('keydown', {
      key,
      ctrlKey: ctrl,
      metaKey: meta,
      bubbles: true
    });
    state.handleKeydown(event);
  }

  it('Ctrl+X triggers cut when items selected', () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);

    dispatch(state, 'x', true);

    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.action).toBe('cut');
  });

  it('Ctrl+C triggers copy when items selected', () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);

    dispatch(state, 'c', true);

    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.action).toBe('copy');
  });

  it('Ctrl+V triggers paste when clipboard non-empty', async () => {
    const state = makeState();
    state.clipboard = {
      action: 'copy',
      keys: ['file.txt'],
      sourceBucket: 'test-bucket',
      fileSizes: {}
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [{ sourceKey: 'file.txt', destKey: 'paste/file.txt' }],
          failed: []
        })
    } as Response);

    await state.executeAction('paste');

    expect(addToast).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('Ctrl+V does nothing when clipboard is empty', () => {
    const state = makeState();
    state.clipboard = null;

    dispatch(state, 'v', true);

    expect(addToast).not.toHaveBeenCalled();
  });

  it('F2 triggers rename when one item is selected', () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);

    dispatch(state, 'F2');

    expect(state.activeModal?.type).toBe('rename');
  });

  it('F2 does nothing when no items selected', () => {
    const state = makeState();

    dispatch(state, 'F2');

    expect(state.activeModal).toBeNull();
  });

  it('Delete opens delete modal', () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);

    dispatch(state, 'Delete');

    expect(state.activeModal?.type).toBe('delete');
  });

  it('Escape clears selection', () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);

    dispatch(state, 'Escape');

    expect(state.selectedKeys.size).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Clipboard cleanup on delete
// ────────────────────────────────────────────────────────────────────────────

describe('performDelete clipboard cleanup', () => {
  it('removes deleted keys from clipboard', async () => {
    const state = makeState();
    state.clipboard = {
      action: 'cut',
      keys: ['file.txt', 'photo.jpg', 'nested/file.js'],
      sourceBucket: 'test-bucket',
      fileSizes: { 'file.txt': 100, 'photo.jpg': 500, 'nested/file.js': 200 }
    };
    state.selectedKeys = new SvelteSet<string>(['file.txt', 'photo.jpg']);
    state.openModal('delete', { keys: ['file.txt', 'photo.jpg'] });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ failed: [] })
    } as Response);

    await state.confirmDelete();

    expect(state.clipboard!.keys).toEqual(['nested/file.js']);
  });

  it('clears clipboard when all keys are deleted', async () => {
    const state = makeState();
    state.clipboard = {
      action: 'copy',
      keys: ['file.txt'],
      sourceBucket: 'test-bucket',
      fileSizes: { 'file.txt': 100 }
    };
    state.selectedKeys = new SvelteSet<string>(['file.txt']);
    state.openModal('delete', { keys: ['file.txt'] });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ failed: [] })
    } as Response);

    await state.confirmDelete();

    expect(state.clipboard).toBeNull();
  });

  it('does not affect clipboard when source bucket differs', async () => {
    const state = makeState();
    state.clipboard = {
      action: 'copy',
      keys: ['file.txt'],
      sourceBucket: 'other-bucket',
      fileSizes: {}
    };
    state.selectedKeys = new SvelteSet<string>(['file.txt']);
    state.openModal('delete', { keys: ['file.txt'] });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ failed: [] })
    } as Response);

    await state.confirmDelete();

    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.keys).toEqual(['file.txt']);
  });
});
