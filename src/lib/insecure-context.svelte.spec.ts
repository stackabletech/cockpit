import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryStorageApi } from '$lib/storage/api.test-utils.js';
import { startDownload } from '$lib/storage/download.js';
import type { OperationsState } from '$lib/storage/operations.svelte.js';
import { StorageState } from '$lib/storage/state.svelte.js';
import { TabsState, type PersistedTabsState } from '$lib/storage/tabs.svelte.js';
import { runTransfer } from '$lib/storage/transfer.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * `crypto.randomUUID` is only exposed in secure contexts, so it is `undefined`
 * when the app is served over plain HTTP on a non-`localhost` host. Calling it
 * there throws `TypeError: crypto.randomUUID is not a function`, which breaks
 * every feature that mints an id in the browser — see `randomUUID()` in
 * `$lib/utils/uuid.js`, which falls back to `crypto.getRandomValues()`.
 *
 * These regressions live in one file rather than next to each store on
 * purpose. Browser-mode Vitest evaluates SvelteKit's SSR module runner once per
 * run and its first evaluation races under full-suite parallelism; splitting
 * these across several spec files gives that race more than one entry point and
 * leaves a Vite error overlay on the page, which then fails unrelated specs.
 */

/** `randomUUID` lives on `Crypto.prototype`; shadow it so the fallback runs. */
function removeRandomUUID() {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: undefined,
    configurable: true
  });
}

function restoreRandomUUID() {
  delete (globalThis.crypto as unknown as Record<string, unknown>).randomUUID;
}

function importTabStore() {
  vi.resetModules();
  return import('$lib/stores/tab-store.svelte.js');
}

describe('tabStore in an insecure context', () => {
  beforeEach(() => {
    removeRandomUUID();
  });

  afterEach(() => {
    restoreRandomUUID();
  });

  // Regression: over plain HTTP on a non-localhost host `crypto.randomUUID` is
  // undefined, and this module-scope initialisation threw during hydration —
  // /trino stayed blank despite a 200 response.
  //
  // The timeout is generous because browser-mode SvelteKit SSR init is slow
  // under full-suite parallelism and occasionally races on the first import
  // (surfacing as `wrapDynamicImport`); this test triggers that first import.
  it('initialises where crypto.randomUUID is unavailable', async () => {
    const { tabStore } = await importTabStore();

    expect(tabStore.tabs).toHaveLength(1);
    expect(tabStore.tabs[0]!.id).toMatch(UUID_V4);
    expect(tabStore.activeTabId).toBe(tabStore.tabs[0]!.id);
  }, 60_000);

  // `resetModules` does not re-evaluate Svelte-compiled modules in browser
  // mode, so this reuses the singleton built above. Either way the store holds
  // exactly one tab at this point, which is what makes the count below stable.
  it('still mints valid v4 ids for tabs created later', async () => {
    const { tabStore } = await importTabStore();

    const created = tabStore.createTab();

    expect(created).not.toBeNull();
    expect(created!.id).toMatch(UUID_V4);
    expect(new Set(tabStore.tabs.map((tab) => tab.id)).size).toBe(2);
    expect(tabStore.activeTabId).toBe(created!.id);
  }, 60_000);
});

describe('storage id minting in an insecure context', () => {
  beforeEach(() => {
    removeRandomUUID();
  });

  afterEach(() => {
    restoreRandomUUID();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function makeTabs(bucket = 'bucket', prefix = '') {
    const storage = new StorageState({ connected: true });
    storage.bucket = bucket;
    storage.prefix = prefix;
    storage.connectionHostname = 's3.example.com';
    storage.objects = { objects: [], hasNextPage: false, currentPage: 1, pageSize: 25 };

    return new TabsState(storage, {
      persistEnabled: false,
      connectionId: null,
      navigateToLocation: vi.fn(),
      replaceLocationUrl: vi.fn()
    });
  }

  it('mints a v4 id for the initial storage tab', () => {
    const ts = makeTabs();

    ts.ensureInitialTab();

    expect(ts.tabs).toHaveLength(1);
    expect(ts.tabs[0].id).toMatch(UUID_V4);
    expect(ts.activeTabId).toBe(ts.tabs[0].id);
  });

  it('mints a distinct v4 id per added storage tab', () => {
    const ts = makeTabs();
    ts.ensureInitialTab();

    ts.addTab();

    expect(ts.tabs).toHaveLength(2);
    for (const tab of ts.tabs) {
      expect(tab.id).toMatch(UUID_V4);
    }
    expect(new Set(ts.tabs.map((tab) => tab.id)).size).toBe(2);
    expect(ts.activeTabId).toBe(ts.tabs[1].id);
  });

  it('mints fresh v4 ids when restoring persisted tabs', () => {
    const saved: PersistedTabsState = {
      tabs: [
        { id: 'old-a', label: 'A', bucket: 'bucket', prefix: '' },
        { id: 'old-b', label: 'B', bucket: 'bucket', prefix: 'x/' }
      ],
      activeTabId: 'old-b'
    };
    const ts = makeTabs();

    ts.restorePersistedTabs(saved);

    const ids = ts.tabs.map((tab) => tab.id);

    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(id).toMatch(UUID_V4);
    }
    // The saved ids must not be reused.
    expect(ids).not.toContain('old-a');
    expect(ids).not.toContain('old-b');
  });

  it('mints a v4 job id per file when starting a download', async () => {
    // `triggerDownload` builds a real anchor pointing at the manifest route and
    // clicks it. Leaving that alone makes the dev server evaluate that
    // `+server.ts` module, which races SvelteKit's first SSR evaluation and
    // leaves a Vite error overlay on the page for unrelated specs. `document`
    // itself is non-configurable in the browser, so spy on the two methods it
    // uses rather than replacing the global like the node-env spec does.
    const click = vi.fn();
    const anchor = { click, style: {}, href: '', remove: vi.fn() };
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLElement);
    const appendChild = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation(() => anchor as unknown as HTMLElement);
    vi.useFakeTimers();

    try {
      const api = createMemoryStorageApi({
        createDownloadManifest: async () => ({
          id: 'manifest-1',
          expiresAt: new Date().toISOString(),
          files: [{ filename: 'one.txt', size: 1, part: 1 }]
        })
      });

      const promise = startDownload(api, 'bucket', '', ['one.txt']);
      await vi.advanceTimersByTimeAsync(500);
      const result = await promise;

      expect(result.jobIds).toHaveLength(1);
      expect(result.jobIds[0]).toMatch(UUID_V4);
      expect(click).toHaveBeenCalledTimes(1);
      expect(anchor.href).toContain('/api/storage/download/manifests/manifest-1/1?jobId=');
    } finally {
      createElement.mockRestore();
      appendChild.mockRestore();
    }
  });

  it('mints v4 operation and job ids when running a transfer', async () => {
    const api = createMemoryStorageApi({
      async transfer(_body, onEvent) {
        onEvent({
          type: 'complete',
          summary: { done: 1, partial: 0, failed: 0, refused: 0, cancelled: 0 }
        } as Parameters<typeof onEvent>[0]);
        return { complete: true };
      }
    });
    const operations = {
      startOp: vi.fn(),
      updateOpJobIds: vi.fn(),
      updateOpProgress: vi.fn(),
      finishOp: vi.fn()
    };

    await runTransfer({
      api,
      operations: operations as unknown as OperationsState,
      body: {
        op: 'copy',
        source: { bucket: 'x' },
        dest: { bucket: 'x', prefix: 'dest/' },
        items: [{ sourceKey: 'a' }]
      },
      label: 'Copy',
      type: 'paste',
      destPath: 'x/dest/'
    });

    const opId = operations.startOp.mock.calls[0][0];
    const jobIds = operations.updateOpJobIds.mock.calls[0][1] as string[];

    expect(opId).toMatch(UUID_V4);
    expect(jobIds.length).toBeGreaterThan(0);
    for (const jobId of jobIds) {
      expect(jobId).toMatch(UUID_V4);
    }
  });
});
