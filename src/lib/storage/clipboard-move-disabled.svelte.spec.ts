// The flags are read once per module in the browser project, so the disabled
// move flag gets its own spec file.
vi.mock('$lib/client/feature-flags.js', () => ({
  storageRestoreTabsEnabled: false,
  storageCutCopyEnabled: true,
  storagePasteEnabled: true,
  storageRenameEnabled: true,
  storageMoveEnabled: false
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

import { describe, it, expect, vi } from 'vitest';
import { StorageState } from './state.svelte.js';
import { createMemoryStorageApi } from './api.test-utils.js';

describe('drag and drop with moving disabled', () => {
  it('ignores drops', () => {
    const transfer = vi.fn();
    const state = new StorageState({
      connected: true,
      buckets: ['test-bucket'],
      api: createMemoryStorageApi({ transfer })
    });
    state.bucket = 'test-bucket';

    state.performMove('dest/', ['a.txt']);

    expect(state.activeModal).toBeNull();
    expect(transfer).not.toHaveBeenCalled();
  });
});
