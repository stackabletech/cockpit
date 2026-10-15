vi.mock('$lib/client/feature-flags.js', () => ({
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

vi.mock('$lib/storage/download.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/storage/download.js')>();
  return {
    ...actual,
    startDownload: vi.fn(),
    triggerManifestDownloads: vi.fn()
  };
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { StorageState } from './state.svelte.js';
import type { StorageApi, DownloadHistoryEntry } from './api.js';
import type { ClipboardData } from './types.js';
import { createMemoryStorageApi, fakeTransfer } from './api.test-utils.js';
import { makePage } from './state.test-utils.js';
import { StorageError } from './errors.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import { invalidateAll } from '$app/navigation';
import {
  estimateArchiveSize,
  startDownload,
  triggerManifestDownloads
} from '$lib/storage/download.js';

describe('selection and navigation', () => {
  it.each(['folder/', ''])('reloads S3 when leaving an archive for %s', async (prefix) => {
    const state = makeState(undefined, { prefix: 'folder/' });
    const navigate = vi.fn();
    state.setNavigationHandler(navigate);
    await state.archive.enterArchive('folder/archive.zip');

    state.navigate(prefix);

    expect(navigate).toHaveBeenCalledWith(prefix, null, state.pageSize, true);
    expect(state.archive.isInArchive).toBe(false);
    expect(state.loading).toBe(true);

    state.syncFromServer('test-bucket', prefix, makePage());
    expect(state.loading).toBe(false);
  });

  it('reloads the containing S3 folder when exiting from the archive root', async () => {
    const state = makeState(undefined, { prefix: 'folder/' });
    const navigate = vi.fn();
    state.setNavigationHandler(navigate);
    await state.archive.enterArchive('folder/archive.zip');

    state.archive.navigateUpFromArchive();

    expect(navigate).toHaveBeenCalledWith('folder/', null, state.pageSize, true);
    expect(state.archive.isInArchive).toBe(false);
  });

  it('selects the inclusive range from the selection anchor', () => {
    const state = new StorageState({ api: makeApi() });
    state.objects = makePage();
    state.toggleSelect('file.txt');

    state.toggleSelect('photo.jpg', false, true);

    expect([...state.selectedKeys]).toEqual(['file.txt', 'photo.jpg']);
  });

  it('clears selection mode when navigating', () => {
    const state = new StorageState({ api: makeApi() });
    state.selectedKeys = new SvelteSet(['file.txt']);
    state.selectionMode = true;

    state.navigate('folder/');

    expect(state.selectedKeys.size).toBe(0);
    expect(state.selectionMode).toBe(false);
  });
});

function makeApi(overrides?: Partial<StorageApi>): StorageApi {
  return createMemoryStorageApi({ list: async () => makePage(), ...overrides });
}

function clip(action: 'cut' | 'copy', keys: string[], sourcePrefix = ''): ClipboardData {
  return {
    action,
    keys,
    connectionId: 'test-connection-id',
    sourceBucket: 'test-bucket',
    sourcePrefix,
    fileSizes: {}
  };
}

function makeState(
  apiOverrides?: Partial<StorageApi>,
  stateOverrides?: Partial<StorageState>
): StorageState {
  const state = new StorageState({
    connected: true,
    buckets: ['test-bucket'],
    api: makeApi(apiOverrides)
  });
  state.bucket = 'test-bucket';
  state.prefix = '';
  state.objects = makePage();
  if (stateOverrides) {
    Object.assign(state, stateOverrides);
  }
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('isCutKey', () => {
  it('returns true when key is in clipboard with cut action and matching bucket', () => {
    const state = makeState();
    state.clipboardState.clipboard = {
      action: 'cut',
      keys: ['file.txt', 'dir/'],
      connectionId: 'test-connection-id',
      sourceBucket: 'test-bucket',
      sourcePrefix: '',
      fileSizes: {}
    };

    expect(state.isCutKey('file.txt')).toBe(true);
    expect(state.isCutKey('dir/')).toBe(true);
  });

  it('returns false for keys not in clipboard', () => {
    const state = makeState();
    state.clipboardState.clipboard = {
      action: 'cut',
      keys: ['file.txt'],
      connectionId: 'test-connection-id',
      sourceBucket: 'test-bucket',
      sourcePrefix: '',
      fileSizes: {}
    };

    expect(state.isCutKey('photo.jpg')).toBe(false);
  });

  it('returns false when clipboard action is copy', () => {
    const state = makeState();
    state.clipboardState.clipboard = {
      action: 'copy',
      keys: ['file.txt'],
      connectionId: 'test-connection-id',
      sourceBucket: 'test-bucket',
      sourcePrefix: '',
      fileSizes: {}
    };

    expect(state.isCutKey('file.txt')).toBe(false);
  });

  it('returns false when bucket does not match', () => {
    const state = makeState();
    state.clipboardState.clipboard = {
      action: 'cut',
      keys: ['file.txt'],
      connectionId: 'test-connection-id',
      sourceBucket: 'other-bucket',
      sourcePrefix: '',
      fileSizes: {}
    };

    expect(state.isCutKey('file.txt')).toBe(false);
  });

  it('returns false when clipboard is null', () => {
    const state = makeState();
    state.clipboardState.clipboard = null;

    expect(state.isCutKey('file.txt')).toBe(false);
  });
});

describe('executeAction("paste")', () => {
  it('shows warning when inside an archive', async () => {
    const state = makeState();
    state.clipboardState.clipboard = clip('copy', ['file.txt']);
    state.archive.archiveKey = 'archive.zip';

    await state.executeAction('paste');

    expect(addToast).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('copies through the transfer API and shows one success toast', async () => {
    const transfer = vi.fn(fakeTransfer());
    const state = makeState({ transfer });
    state.clipboardState.clipboard = clip('copy', ['file.txt']);

    await state.executeAction('paste');

    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'copy',
        source: { bucket: 'test-bucket' },
        dest: { bucket: 'test-bucket', prefix: '' },
        items: [{ sourceKey: 'file.txt' }]
      }),
      expect.any(Function)
    );
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('success', expect.stringContaining('pasted'));
    expect(invalidateAll).toHaveBeenCalled();
  });

  it('refuses a clipboard from another connection', async () => {
    const transfer = vi.fn();
    const state = makeState({ transfer });
    state.clipboardState.clipboard = { ...clip('copy', ['file.txt']), connectionId: 'other' };

    await state.executeAction('paste');

    expect(transfer).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('warning', expect.stringContaining('another storage'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// confirmRename
// ────────────────────────────────────────────────────────────────────────────

describe('confirmRename', () => {
  it('closes modal if new name is same as current', async () => {
    const state = makeState();
    state.openModal('rename', { key: 'file.txt' });

    await state.confirmRename('file.txt', 'file.txt');

    expect(state.activeModal).toBeNull();
    expect(state.renameLoading).toBe(false);
  });

  it('sends a rename that keeps the item in its folder', async () => {
    const transfer = vi.fn(fakeTransfer());
    const state = makeState({ transfer });
    state.openModal('rename', { key: 'a//b.txt' });

    await state.confirmRename('a//b.txt', 'c.txt');

    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'rename',
        source: { bucket: 'test-bucket' },
        items: [{ sourceKey: 'a//b.txt', name: 'c.txt' }]
      }),
      expect.any(Function)
    );
    expect(transfer.mock.calls[0][0].dest).toBeUndefined();
  });

  it('shows a taken name in the modal, keeps it open and never overwrites', async () => {
    const state = makeState({
      transfer: fakeTransfer({ 'file.txt': { status: 'refused', reason: 'conflict' } })
    });
    state.openModal('rename', { key: 'file.txt' });

    await state.confirmRename('file.txt', 'renamed.txt');

    expect(state.activeModal?.type).toBe('rename');
    expect(state.renameError).toContain('already exists');
    expect(state.renameLoading).toBe(false);
    expect(addToast).not.toHaveBeenCalled();
  });

  it('shows toast on access_denied and closes modal', async () => {
    const state = makeState({
      transfer: vi.fn().mockRejectedValue(new StorageError('access_denied', 'Access denied'))
    });
    state.openModal('rename', { key: 'file.txt' });

    await state.confirmRename('file.txt', 'renamed.txt');

    expect(state.activeModal).toBeNull();
    expect(addToast).toHaveBeenCalledWith('error', expect.stringContaining('denied'));
  });

  it('shows success toast on successful rename and updates recent files', async () => {
    const state = makeState();
    state.openModal('rename', { key: 'file.txt' });
    state.bookmarks.recordFileVisit('test-bucket', 'file.txt', 100);

    await state.confirmRename('file.txt', 'renamed.txt');

    expect(state.activeModal).toBeNull();
    expect(addToast).toHaveBeenCalledWith('success', expect.stringContaining('Renamed'));
    expect(invalidateAll).toHaveBeenCalled();
    expect(state.bookmarks.recentFiles.some((f) => f.key === 'renamed.txt')).toBe(true);
    expect(state.bookmarks.recentFiles.some((f) => f.key === 'file.txt')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// confirmCreate
// ────────────────────────────────────────────────────────────────────────────

describe('confirmCreate', () => {
  it('numbers a taken name from (1), as copies do', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const taken = new Set(['report.txt', 'report (1).txt']);
    const state = makeState({
      create,
      checkObjectExists: async ({ key }) => taken.has(key)
    });

    await state.confirmCreate('report.txt', 'file');

    expect(create).toHaveBeenLastCalledWith({ bucket: 'test-bucket', key: 'report (2).txt' });
  });

  it('treats a folder without a marker object as taken', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const state = makeState({
      create,
      checkObjectExists: async () => false,
      list: async ({ prefix }) =>
        prefix === 'docs/'
          ? makePage([
              {
                key: 'docs/child.txt',
                size: 1,
                lastModified: new Date('2025-01-01'),
                isDirectory: false,
                contentType: 'text/plain'
              }
            ])
          : makePage([])
    });

    await state.confirmCreate('docs', 'folder');

    expect(create).toHaveBeenLastCalledWith({ bucket: 'test-bucket', key: 'docs (1)/' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// performMove (drag-and-drop) + confirmMove
// ────────────────────────────────────────────────────────────────────────────

describe('performMove', () => {
  it('does nothing when every item is already in the destination', () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);

    state.performMove('');

    expect(state.activeModal).toBeNull();
  });

  it('opens confirm-move modal with selected keys', () => {
    const state = makeState();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);

    state.performMove('dest/');

    expect(state.activeModal?.type).toBe('confirm-move');
    const payload = (
      state.activeModal as { type: 'confirm-move'; payload: { keys: string[]; destPrefix: string } }
    )?.payload;
    expect(payload?.keys).toEqual(['file.txt']);
    expect(payload?.destPrefix).toBe('dest/');
  });

  it('refuses a drag from another connection', () => {
    const state = makeState();

    state.performMove('dest/', ['file.txt'], 'test-bucket', {
      connectionId: 'other',
      bucket: 'test-bucket'
    });

    expect(state.activeModal).toBeNull();
    expect(addToast).toHaveBeenCalledWith('warning', expect.stringContaining('another storage'));
  });
});

describe('confirmMove', () => {
  it('moves through the transfer API and shows success toast', async () => {
    const transfer = vi.fn(fakeTransfer());
    const state = makeState({ transfer });
    state.selectedKeys = new SvelteSet<string>(['file.txt']);
    state.performMove('dest/');

    await state.confirmMove();

    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'move',
        dest: { bucket: 'test-bucket', prefix: 'dest/' },
        items: [{ sourceKey: 'file.txt' }]
      }),
      expect.any(Function)
    );
    expect(addToast).toHaveBeenCalledWith('success', expect.stringContaining('moved'));
    expect(state.activeModal).toBeNull();
  });

  it('cancelMove closes the modal without calling API', () => {
    const transfer = vi.fn();
    const state = makeState({ transfer });
    state.selectedKeys = new SvelteSet<string>(['file.txt']);
    state.performMove('dest/');

    state.cancelMove();

    expect(state.activeModal).toBeNull();
    expect(transfer).not.toHaveBeenCalled();
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
    state.clipboardState.clipboard = clip('copy', ['file.txt']);

    await state.executeAction('paste');

    expect(addToast).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('Ctrl+V does nothing when clipboard is empty', () => {
    const state = makeState();
    state.clipboardState.clipboard = null;

    dispatch(state, 'v', true);

    expect(addToast).not.toHaveBeenCalled();
  });

  it('does not handle Ctrl+A from an open dialog', () => {
    const state = makeState();
    const dialog = document.createElement('dialog');
    const input = document.createElement('input');
    dialog.setAttribute('open', '');
    dialog.appendChild(input);
    document.body.appendChild(dialog);
    state.selectedKeys = new SvelteSet<string>(['file.txt']);

    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true });
    input.dispatchEvent(event);
    state.handleKeydown(event);

    expect(event.defaultPrevented).toBe(false);
    expect(state.selectedKeys).toEqual(new SvelteSet(['file.txt']));

    dialog.remove();
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
    const deleteSpy = vi.fn().mockResolvedValue({ failed: [] });
    const state = makeState({ delete: deleteSpy });
    state.clipboardState.clipboard = {
      action: 'cut',
      keys: ['file.txt', 'photo.jpg', 'nested/file.js'],
      connectionId: 'test-connection-id',
      sourceBucket: 'test-bucket',
      sourcePrefix: '',
      fileSizes: { 'file.txt': 100, 'photo.jpg': 500, 'nested/file.js': 200 }
    };
    state.selectedKeys = new SvelteSet<string>(['file.txt', 'photo.jpg']);
    state.openModal('delete', { keys: ['file.txt', 'photo.jpg'] });

    await state.confirmDelete();

    expect(state.clipboard!.keys).toEqual(['nested/file.js']);
  });

  it('clears clipboard when all keys are deleted', async () => {
    const deleteSpy = vi.fn().mockResolvedValue({ failed: [] });
    const state = makeState({ delete: deleteSpy });
    state.clipboardState.clipboard = {
      action: 'copy',
      keys: ['file.txt'],
      connectionId: 'test-connection-id',
      sourceBucket: 'test-bucket',
      sourcePrefix: '',
      fileSizes: { 'file.txt': 100 }
    };
    state.selectedKeys = new SvelteSet<string>(['file.txt']);
    state.openModal('delete', { keys: ['file.txt'] });

    await state.confirmDelete();

    expect(state.clipboard).toBeNull();
  });

  it('does not affect clipboard when source bucket differs', async () => {
    const deleteSpy = vi.fn().mockResolvedValue({ failed: [] });
    const state = makeState({ delete: deleteSpy });
    state.clipboardState.clipboard = {
      action: 'copy',
      keys: ['file.txt'],
      connectionId: 'test-connection-id',
      sourceBucket: 'other-bucket',
      sourcePrefix: '',
      fileSizes: {}
    };
    state.selectedKeys = new SvelteSet<string>(['file.txt']);
    state.openModal('delete', { keys: ['file.txt'] });

    await state.confirmDelete();

    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.keys).toEqual(['file.txt']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// executeAction – download (archive size estimation)
// ────────────────────────────────────────────────────────────────────────────

describe('executeAction("download")', () => {
  it('starts an operation with an estimated archive size, then refines it from the manifest', async () => {
    let resolveStartDownload!: (value: {
      id: string;
      fileCount: number;
      totalBytes: number;
      jobIds: string[];
    }) => void;
    vi.mocked(startDownload).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStartDownload = resolve;
        })
    );
    let resolveHistoryFn!: (entries: DownloadHistoryEntry[]) => void;
    const state = makeState({
      listDownloadHistory: () =>
        new Promise((resolve) => {
          resolveHistoryFn = resolve;
        })
    });
    state.connectionId = 'test-connection-id';
    state.selectionMode = true;
    state.selectedKeys = new SvelteSet(['dir/', 'file.txt', 'photo.jpg', 'nested/file.js']);

    const promise = state.executeAction('download');
    await vi.waitFor(() => expect(state.operations).toHaveLength(1));

    const op = state.operations[0]!;
    const downloadItems = [
      { key: 'dir/', size: 0, isDirectory: true },
      { key: 'file.txt', size: 100, isDirectory: false },
      { key: 'photo.jpg', size: 500, isDirectory: false },
      { key: 'nested/file.js', size: 200, isDirectory: false }
    ];
    expect(op.type).toBe('download');
    expect(op.totalBytes).toBe(estimateArchiveSize(downloadItems));

    resolveStartDownload({
      id: 'download-manifest',
      fileCount: 1,
      totalBytes: 900,
      jobIds: ['download-job-1']
    });
    await vi.waitFor(() => expect(state.operations[0]?.totalBytes).toBe(900));

    resolveHistoryFn([]);
    await promise;

    expect(state.operations).toHaveLength(1);
    expect(state.operations[0]).toMatchObject({
      status: 'running',
      fileJobIds: ['download-job-1']
    });
  });

  it('marks the operation as failed when the download cannot be started', async () => {
    vi.mocked(startDownload).mockRejectedValueOnce(new StorageError('server_error', 'Boom'));
    const state = makeState();
    state.selectionMode = true;
    state.selectedKeys = new SvelteSet(['file.txt', 'photo.jpg']);

    await state.executeAction('download');

    expect(state.operations).toHaveLength(1);
    expect(state.operations[0]?.status).toBe('error');
    expect(addToast).toHaveBeenCalledWith('error', expect.any(String));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// redownloadHistory
// ────────────────────────────────────────────────────────────────────────────

function makeHistoryEntry(): DownloadHistoryEntry {
  return {
    id: 'manifest-1',
    bucket: 'test-bucket',
    connectionId: 'test-connection-id',
    entries: [
      { key: 'a.txt', size: 1000, isDirectory: false },
      { key: 'b.txt', size: 2000, isDirectory: false },
      { key: 'c.txt', size: 4000, isDirectory: false }
    ],
    archive: true,
    archiveFilename: 'test-bucket.zip',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString()
  };
}

describe('redownloadHistory', () => {
  beforeEach(() => {
    vi.mocked(triggerManifestDownloads).mockResolvedValue(['download-job-1']);
  });

  it('tracks an operation with the estimated size of the selected entries', async () => {
    const recreateSpy = vi.fn().mockResolvedValue({
      id: 'manifest-2',
      files: [{ filename: 'selection.zip', size: 3000, part: 1 }],
      expiresAt: new Date().toISOString()
    });
    const state = makeState({ recreateDownloadManifest: recreateSpy });
    state.downloadHistory = [makeHistoryEntry()];

    await state.redownloadHistory('manifest-1', ['a.txt', 'b.txt']);

    expect(recreateSpy).toHaveBeenCalledWith(
      'manifest-1',
      ['a.txt', 'b.txt'],
      expect.any(AbortSignal)
    );
    expect(triggerManifestDownloads).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'manifest-2',
        files: [{ filename: 'selection.zip', size: 3000, part: 1 }]
      }),
      expect.any(AbortSignal),
      expect.any(Function)
    );
    expect(state.operations).toHaveLength(1);
    expect(state.operations[0]).toMatchObject({
      status: 'running',
      fileJobIds: ['download-job-1']
    });
  });

  it('marks the operation as failed and drops vanished history entries', async () => {
    const state = makeState({
      recreateDownloadManifest: vi
        .fn()
        .mockRejectedValue(new StorageError('not_found', 'reports/moved.txt'))
    });
    state.downloadHistory = [makeHistoryEntry()];

    await state.redownloadHistory('manifest-1', ['a.txt']);

    expect(state.operations[0]?.status).toBe('error');
    expect(state.operations[0]?.errorMessage).toBe(
      'Failed: File "reports/moved.txt" cannot be found'
    );
    expect(state.downloadHistory).toHaveLength(0);
  });
});

describe('clearOperationHistory', () => {
  it('clears both operation and download history', async () => {
    const clearDownloadHistory = vi.fn();
    const state = makeState({ clearDownloadHistory });
    state.downloadHistory = [makeHistoryEntry()];

    await state.clearOperationHistory();

    expect(clearDownloadHistory).toHaveBeenCalledOnce();
    expect(state.downloadHistory).toEqual([]);
  });
});
