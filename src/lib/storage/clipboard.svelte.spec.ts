vi.mock('$lib/client/feature-flags.js', () => ({
  storageMoveEnabled: true,
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
import type { PlanItem, TransferBody, TransferPlanBody } from './transfer-types.js';
import { createMemoryStorageApi, fakeTransfer } from './api.test-utils.js';
import { makePage } from './state.test-utils.js';
import { addToast } from '$lib/stores/toast.svelte.js';

type ConflictPayload = {
  entries: ConflictEntry[];
  refused: Array<{ name: string; reason: string }>;
  closeOnly: boolean;
};

function makeState(api: StorageApi, clip: ClipboardData | null = null): StorageState {
  const state = new StorageState({ connected: true, buckets: ['test-bucket'], api });
  state.bucket = 'test-bucket';
  state.prefix = 'dest/';
  state.objects = makePage();
  state.clipboardState.clipboard = clip;
  return state;
}

function clipboard(action: 'copy' | 'cut', keys: string[], sourceBucket = 'test-bucket') {
  return {
    action,
    keys,
    connectionId: 'test-connection-id',
    sourceBucket,
    sourcePrefix: 'src/',
    fileSizes: {}
  } satisfies ClipboardData;
}

/** A plan with the given per-key fields; other keys plan without conflict. */
function planWith(fields: Record<string, Partial<PlanItem>>): StorageApi['planTransfer'] {
  return async (body) =>
    body.source.keys.map((sourceKey) => ({
      sourceKey,
      kind: sourceKey.endsWith('/') ? 'folder' : 'file',
      destKey: body.dest.prefix + sourceKey.split('/').filter(Boolean).pop(),
      conflict: 'none',
      ...fields[sourceKey]
    }));
}

function sentBody(transfer: StorageApi['transfer']): TransferBody {
  return vi.mocked(transfer).mock.calls[0][0];
}

function conflictPayload(state: StorageState): ConflictPayload {
  expect(state.activeModal?.type).toBe('resolve-conflicts');
  return (state.activeModal as unknown as { payload: ConflictPayload }).payload;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('paste', () => {
  it('sends one request for the whole selection', async () => {
    const transfer = vi.fn(fakeTransfer());
    const state = makeState(
      createMemoryStorageApi({ transfer }),
      clipboard('copy', ['src/a', 'src/b/'])
    );

    await state.clipboardState.paste('dest/');

    expect(transfer).toHaveBeenCalledTimes(1);
    expect(sentBody(transfer)).toMatchObject({
      op: 'copy',
      source: { bucket: 'test-bucket' },
      dest: { bucket: 'test-bucket', prefix: 'dest/' },
      items: [{ sourceKey: 'src/a' }, { sourceKey: 'src/b/' }]
    });
  });

  it('keeps both for a copy onto itself without asking', async () => {
    const transfer = vi.fn(fakeTransfer());
    const api = createMemoryStorageApi({
      transfer,
      planTransfer: planWith({ 'dest/a.txt': { conflict: 'file', selfConflict: true } })
    });
    const state = makeState(api, clipboard('copy', ['dest/a.txt']));

    await state.clipboardState.paste('dest/');

    expect(state.activeModal).toBeNull();
    expect(sentBody(transfer).items).toEqual([{ sourceKey: 'dest/a.txt', policy: 'keepBoth' }]);
  });

  it('blocks a second paste while one is running', async () => {
    let finish!: () => void;
    const running = new Promise<void>((resolve) => (finish = resolve));
    const transfer = vi.fn(
      async (body: TransferBody, onEvent: Parameters<StorageApi['transfer']>[1]) => {
        await running;
        return fakeTransfer()(body, onEvent);
      }
    );
    const state = makeState(createMemoryStorageApi({ transfer }), clipboard('cut', ['src/a']));

    const first = state.clipboardState.paste('dest/');
    await vi.waitFor(() => expect(transfer).toHaveBeenCalledTimes(1));
    await state.clipboardState.paste('other/');
    finish();
    await first;

    expect(transfer).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('info', expect.stringContaining('still running'));
  });

  it('blocks a drag-move while a paste is running, and a paste while a move runs', async () => {
    let finish!: () => void;
    const running = new Promise<void>((resolve) => (finish = resolve));
    const transfer = vi.fn(
      async (body: TransferBody, onEvent: Parameters<StorageApi['transfer']>[1]) => {
        await running;
        return fakeTransfer()(body, onEvent);
      }
    );
    const state = makeState(createMemoryStorageApi({ transfer }), clipboard('cut', ['src/a']));

    const paste = state.clipboardState.paste('dest/');
    await vi.waitFor(() => expect(transfer).toHaveBeenCalledTimes(1));
    state.performMove('other/', ['src/a']);
    expect(state.activeModal).toBeNull();
    finish();
    await paste;

    let finishMove!: () => void;
    const moving = new Promise<void>((resolve) => (finishMove = resolve));
    transfer.mockImplementationOnce(async (body, onEvent) => {
      await moving;
      return fakeTransfer()(body, onEvent);
    });
    state.performMove('other/', ['src/b']);
    const move = state.confirmMove();
    await vi.waitFor(() => expect(transfer).toHaveBeenCalledTimes(2));
    await state.clipboardState.paste('dest/');
    finishMove();
    await move;

    expect(transfer).toHaveBeenCalledTimes(2);
    expect(vi.mocked(addToast).mock.calls.filter(([type]) => type === 'info')).toHaveLength(2);
  });

  it('refuses more than 1000 items up front without a request', async () => {
    const planTransfer = vi.fn();
    const keys = Array.from({ length: 1001 }, (_, i) => `src/${i}`);
    const state = makeState(createMemoryStorageApi({ planTransfer }), clipboard('copy', keys));

    await state.clipboardState.paste('dest/');

    expect(planTransfer).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('error', expect.stringContaining('1000'));
  });

  it('keeps the destination fixed when the user switches tab during a paste (R1)', async () => {
    let releasePlan!: () => void;
    const planned = new Promise<void>((resolve) => (releasePlan = resolve));
    const transfer = vi.fn(fakeTransfer());
    const api = createMemoryStorageApi({
      transfer,
      planTransfer: async (body) => {
        await planned;
        return planWith({})(body);
      }
    });
    const state = makeState(api, clipboard('copy', ['src/a']));

    const paste = state.clipboardState.paste('dest/');
    state.bucket = 'other-bucket';
    state.prefix = 'elsewhere/';
    releasePlan();
    await paste;

    expect(sentBody(transfer).dest).toEqual({ bucket: 'test-bucket', prefix: 'dest/' });
  });
});

describe('conflict dialog', () => {
  const api = () =>
    createMemoryStorageApi({
      transfer: vi.fn(fakeTransfer()),
      planTransfer: planWith({
        'src/a.txt': { conflict: 'file', suggestedName: 'a (1).txt' },
        'src/docs/': { conflict: 'folder', suggestedName: 'docs (1)' },
        'src/dest/': { refused: 'into_itself' }
      })
    });

  it('offers per-kind choices and lists refused items with their reason', async () => {
    const state = makeState(
      api(),
      clipboard('copy', ['src/a.txt', 'src/docs/', 'src/dest/', 'src/new'])
    );

    await state.clipboardState.paste('dest/');

    const payload = conflictPayload(state);
    expect(payload.entries).toEqual([
      expect.objectContaining({
        sourceKey: 'src/a.txt',
        kind: 'file',
        allowKeepBoth: true,
        customName: 'a (1).txt',
        destPrefix: 'dest/'
      }),
      expect.objectContaining({ sourceKey: 'src/docs/', kind: 'folder' })
    ]);
    expect(payload.refused).toEqual([
      { name: 'dest', reason: 'A folder cannot be placed inside itself.' }
    ]);
    expect(payload.closeOnly).toBe(false);
  });

  it('sends the chosen policies in selection order and leaves skipped items out', async () => {
    const transferApi = api();
    const state = makeState(
      transferApi,
      clipboard('copy', ['src/a.txt', 'src/new', 'src/docs/', 'src/dest/'])
    );
    await state.clipboardState.paste('dest/');
    const { entries } = conflictPayload(state);

    await state.confirmConflictResolution([
      { ...entries[0], resolution: 'rename', customName: ' b.txt ' },
      { ...entries[1], resolution: 'merge' }
    ]);

    expect(sentBody(transferApi.transfer).items).toEqual([
      { sourceKey: 'src/a.txt', policy: 'rename', name: 'b.txt' },
      { sourceKey: 'src/new' },
      { sourceKey: 'src/docs/', policy: 'merge' }
    ]);
  });

  it('keeps the dialog open while another transfer runs, then sends on a later confirm', async () => {
    const transferApi = api();
    let finish!: () => void;
    const running = new Promise<void>((resolve) => (finish = resolve));
    const transfer = vi.mocked(transferApi.transfer);
    const state = makeState(transferApi, clipboard('copy', ['src/a.txt']));
    await state.clipboardState.paste('dest/');
    const { entries } = conflictPayload(state);
    const chosen = [{ ...entries[0], resolution: 'replace' as const }];

    // A drag-move starts while the dialog is open.
    transfer.mockImplementationOnce(async (body, onEvent) => {
      await running;
      return fakeTransfer()(body, onEvent);
    });
    state.clipboardState.performMove('other/', ['src/b']);
    const move = state.clipboardState.confirmMove();
    await vi.waitFor(() => expect(transfer).toHaveBeenCalledTimes(1));

    await state.confirmConflictResolution(chosen);
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('info', expect.stringContaining('still running'));

    finish();
    await move;
    await state.confirmConflictResolution(chosen);
    expect(transfer).toHaveBeenCalledTimes(2);
    expect(sentBody(transfer).items).toEqual([{ sourceKey: 'src/b' }]);
    expect(transfer.mock.calls[1][0].items).toEqual([
      { sourceKey: 'src/a.txt', policy: 'replace' }
    ]);
  });

  it('sends nothing when every conflict is skipped', async () => {
    const transferApi = api();
    const state = makeState(transferApi, clipboard('copy', ['src/a.txt']));
    await state.clipboardState.paste('dest/');
    const { entries } = conflictPayload(state);

    await state.confirmConflictResolution([{ ...entries[0], resolution: 'skip' }]);

    expect(transferApi.transfer).not.toHaveBeenCalled();
  });

  it('checks a new name with a one-item plan under that name', async () => {
    const planTransfer = vi.fn(async (body: TransferPlanBody) =>
      body.names?.['src/a.txt'] === 'taken.txt'
        ? planWith({ 'src/a.txt': { conflict: 'file' } })(body)
        : planWith({})(body)
    );
    const transferApi = api();
    const state = makeState(transferApi, clipboard('copy', ['src/a.txt', 'src/docs/']));
    await state.clipboardState.paste('dest/');
    const { entries } = conflictPayload(state);
    transferApi.planTransfer = planTransfer;

    const check = (customName: string) =>
      state.checkConflictRename({ ...entries[0], resolution: 'rename', customName });

    await expect(check(' taken.txt ')).resolves.toBe(false);
    await expect(check('free.txt')).resolves.toBe(true);
    expect(planTransfer.mock.calls[0][0]).toEqual({
      op: 'copy',
      source: { bucket: 'test-bucket', keys: ['src/a.txt'] },
      dest: { bucket: 'test-bucket', prefix: 'dest/' },
      names: { 'src/a.txt': 'taken.txt' }
    });
  });

  it('does not accept a new name the plan refuses', async () => {
    const transferApi = api();
    const state = makeState(transferApi, clipboard('copy', ['src/a.txt']));
    await state.clipboardState.paste('dest/');
    const { entries } = conflictPayload(state);
    transferApi.planTransfer = planWith({ 'src/a.txt': { refused: 'overlaps_source' } });

    await expect(
      state.checkConflictRename({ ...entries[0], resolution: 'rename', customName: 'x' })
    ).resolves.toBe(false);
  });

  it('reports a name taken by an item pasted without a conflict, without asking the server', async () => {
    const transferApi = api();
    const state = makeState(transferApi, clipboard('copy', ['src/a.txt', 'src/c.txt', 'src/d/']));
    await state.clipboardState.paste('dest/');
    const { entries } = conflictPayload(state);
    const planTransfer = vi.fn(planWith({}));
    transferApi.planTransfer = planTransfer;

    const check = (customName: string) =>
      state.checkConflictRename({ ...entries[0], resolution: 'rename', customName });

    await expect(check('c.txt')).resolves.toBe(false);
    expect(planTransfer).not.toHaveBeenCalled();
    // A file may take the name of a folder: `d` and `d/` are different keys.
    await expect(check('d')).resolves.toBe(true);
  });

  it('toasts and rethrows when the name check fails', async () => {
    const transferApi = api();
    const state = makeState(transferApi, clipboard('copy', ['src/a.txt']));
    await state.clipboardState.paste('dest/');
    const { entries } = conflictPayload(state);
    transferApi.planTransfer = async () => {
      throw new Error('offline');
    };

    await expect(
      state.checkConflictRename({ ...entries[0], resolution: 'rename', customName: 'x' })
    ).rejects.toThrow('offline');
    expect(addToast).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('only offers Close when every item is refused', async () => {
    const state = makeState(api(), clipboard('copy', ['src/dest/']));

    await state.clipboardState.paste('dest/');

    expect(conflictPayload(state)).toMatchObject({ entries: [], closeOnly: true });
  });
});

describe('clipboard after a cut', () => {
  it('copies moved folders from their new location, still as folders (F2)', async () => {
    const state = makeState(createMemoryStorageApi(), clipboard('cut', ['src/docs/', 'src/a.txt']));

    await state.clipboardState.paste('dest/');

    expect(state.clipboard).toMatchObject({
      action: 'copy',
      keys: ['dest/docs/', 'dest/a.txt'],
      sourceBucket: 'test-bucket',
      sourcePrefix: 'dest/'
    });
  });

  it('keeps unmoved items cut at the source and drops the moved ones', async () => {
    const api = createMemoryStorageApi({
      transfer: fakeTransfer({ 'src/b.txt': { status: 'failed', copied: 0 } })
    });
    const state = makeState(api, clipboard('cut', ['src/a.txt', 'src/b.txt']));

    await state.clipboardState.paste('dest/');

    expect(state.clipboard).toMatchObject({ action: 'cut', keys: ['src/b.txt'] });
  });

  it('points a partly moved item at its destination copy', async () => {
    const api = createMemoryStorageApi({
      transfer: fakeTransfer({ 'src/docs/': { status: 'partial' } })
    });
    const state = makeState(api, clipboard('cut', ['src/docs/']));

    await state.clipboardState.paste('dest/');

    expect(state.clipboard).toMatchObject({ action: 'copy', keys: ['dest/docs/'] });
  });

  it('keeps a partial move whose copies failed cut, so a paste retries the move', async () => {
    const api = createMemoryStorageApi({
      transfer: fakeTransfer({ 'src/docs/': { status: 'partial', deletedOriginals: 0 } })
    });
    const state = makeState(api, clipboard('cut', ['src/docs/']));

    await state.clipboardState.paste('dest/');

    expect(state.clipboard).toMatchObject({ action: 'cut', keys: ['src/docs/'] });
  });

  it('leaves a clipboard alone that was replaced during the move', async () => {
    const state = makeState(createMemoryStorageApi(), clipboard('cut', ['src/a.txt']));
    const replacement = clipboard('copy', ['other.txt']);
    const api = state.api;
    const transfer = api.transfer;
    api.transfer = async (body, onEvent) => {
      state.clipboardState.clipboard = replacement;
      return transfer(body, onEvent);
    };

    await state.clipboardState.paste('dest/');

    expect(state.clipboard).toEqual(replacement);
  });
});

describe('drag and drop', () => {
  it('moves from the drag source bucket into the bucket of the tab it is dropped on (R5)', async () => {
    const transfer = vi.fn(fakeTransfer());
    const state = makeState(createMemoryStorageApi({ transfer }));

    state.performMove('target/', ['a.txt'], 'tab-bucket', {
      connectionId: 'test-connection-id',
      bucket: 'drag-bucket'
    });
    await state.confirmMove();

    expect(sentBody(transfer)).toMatchObject({
      op: 'move',
      source: { bucket: 'drag-bucket' },
      dest: { bucket: 'tab-bucket', prefix: 'target/' }
    });
  });

  it('moves an item to the same path in another bucket', () => {
    const state = makeState(createMemoryStorageApi());

    state.performMove('', ['file.txt'], 'other-bucket');

    expect(state.activeModal?.type).toBe('confirm-move');
  });
});

describe('feedback', () => {
  it('shows exactly one toast with counts and a capped name list', async () => {
    const keys = ['src/1', 'src/2', 'src/3', 'src/4', 'src/5', 'src/6'];
    const api = createMemoryStorageApi({
      transfer: fakeTransfer({
        'src/2': { status: 'failed', copied: 0 },
        'src/3': { status: 'refused', reason: 'conflict', copied: 0 },
        'src/4': { status: 'partial' },
        'src/5': { status: 'failed', copied: 0 },
        'src/6': { status: 'cancelled', copied: 0 }
      })
    });
    const state = makeState(api, clipboard('cut', keys));

    await state.clipboardState.paste('dest/');

    expect(addToast).toHaveBeenCalledTimes(1);
    const [type, message] = vi.mocked(addToast).mock.calls[0];
    expect(type).toBe('warning');
    expect(message).toContain('1 done, 1 partly done, 2 failed, 1 refused, 1 cancelled');
    expect(message).toContain('2: failed');
    expect(message).toContain('3: An item with this name already exists.');
    expect(message).toContain('4: only partly transferred');
    expect(message).toContain('+ 2 more');
  });

  it('reports items without any result as unknown, never as success', async () => {
    const keys = ['src/1', 'src/2', 'src/3', 'src/4', 'src/5'];
    // The stream drops after two items and the job cannot be read back either.
    const transfer: StorageApi['transfer'] = async (body, onEvent) => {
      await fakeTransfer()({ ...body, items: body.items.slice(0, 2) }, (event) => {
        if (event.type !== 'complete') onEvent(event);
      });
      return { complete: false };
    };
    const state = makeState(createMemoryStorageApi({ transfer }), clipboard('cut', keys));

    await state.clipboardState.paste('dest/');

    expect(addToast).toHaveBeenCalledTimes(1);
    const [type, message] = vi.mocked(addToast).mock.calls[0];
    expect(type).toBe('warning');
    expect(message).toContain('2 done, 3 with unknown outcome.');
    expect(message).toContain('3: outcome unknown');
    expect(state.operations.at(-1)?.status).toBe('error');
    // Only the items known to be moved leave the clipboard.
    expect(state.clipboard).toMatchObject({ action: 'cut', keys: ['src/3', 'src/4', 'src/5'] });
  });

  it('reports a stream that drops before the first result', async () => {
    const api = createMemoryStorageApi({ transfer: async () => ({ complete: false }) });
    const state = makeState(api, clipboard('copy', ['src/a', 'src/b']));

    await state.clipboardState.paste('dest/');

    expect(addToast).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('2 with unknown outcome.'),
      8000
    );
    expect(state.operations.at(-1)?.status).toBe('error');
  });

  it('reads the results back from the job when the stream ends without complete (#21)', async () => {
    const readTransferJob = vi
      .fn()
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({
        status: 'done',
        items: [
          {
            sourceKey: 'src/a.txt',
            destRoot: 'dest/a.txt',
            status: 'done',
            copied: 1,
            failed: [],
            deletedOriginals: 0
          }
        ]
      });
    vi.useFakeTimers();
    try {
      const api = createMemoryStorageApi({
        transfer: async () => ({ complete: false }),
        readTransferJob
      });
      const state = makeState(api, clipboard('copy', ['src/a.txt']));

      const paste = state.clipboardState.paste('dest/');
      await vi.runAllTimersAsync();
      await paste;

      expect(readTransferJob).toHaveBeenCalledTimes(2);
      expect(addToast).toHaveBeenCalledWith('success', expect.stringContaining('1 item pasted'));
    } finally {
      vi.useRealTimers();
    }
  });
});
