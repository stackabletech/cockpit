import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// `randomUUID` lives on `Crypto.prototype`; shadow it with an own property so
// the fallback path is exercised.
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

describe('tabStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    restoreRandomUUID();
  });

  // Must stay first: the module-scope `tabStore` is built on first import and
  // is never re-created, so this is the only test able to cover initialisation
  // with `crypto.randomUUID` absent. `vi.resetModules()` does not re-evaluate
  // Svelte-compiled modules and a cache-busting query is not resolvable at
  // runtime in browser mode, so later tests necessarily reuse this singleton.
  //
  // Regression: over plain HTTP on a non-localhost host `crypto.randomUUID` is
  // undefined, and this module-scope initialisation threw
  // `TypeError: crypto.randomUUID is not a function` during hydration — /trino
  // stayed blank despite a 200 response.
  //
  // The timeout is generous because browser-mode SvelteKit SSR init is slow
  // under full-suite parallelism and occasionally races on the first import
  // (surfacing as `wrapDynamicImport`); this test triggers that first import.
  it('initialises in an insecure context where crypto.randomUUID is unavailable', async () => {
    removeRandomUUID();

    const { tabStore } = await importTabStore();

    expect(tabStore.tabs).toHaveLength(1);
    expect(tabStore.tabs[0]!.id).toMatch(UUID_V4);
    expect(tabStore.activeTabId).toBe(tabStore.tabs[0]!.id);
  }, 60_000);

  it('creates further tabs with distinct ids', async () => {
    const { tabStore } = await importTabStore();
    const created = tabStore.createTab();

    expect(created).not.toBeNull();
    expect(created!.id).toMatch(UUID_V4);
    expect(new Set(tabStore.tabs.map((tab) => tab.id)).size).toBe(2);
    expect(tabStore.activeTabId).toBe(created!.id);
  });
});
