import { describe, it, expect, afterEach, vi } from 'vitest';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Regression coverage for the module-scope `tabStore` initialisation over plain
 * HTTP.
 *
 * `crypto.randomUUID` is only exposed in secure contexts, so it is `undefined`
 * when the app is served over plain HTTP on a non-`localhost` host. The store is
 * built at module scope (`export const tabStore = createTabStore()`), so the
 * initial tab minted an id on import and the whole page crashed during
 * hydration — SSR succeeded (Node has a global `crypto`) and the browser still
 * received a 200, so `/trino` rendered blank.
 *
 * These tests live in their own file because the module-scope store is created
 * exactly once, on first import, and can never be re-created within a file.
 * Browser-mode Vitest isolates each spec file into its own module registry, so
 * a dedicated file is what gives this test control of that first import.
 */
describe('tabStore in an insecure context', () => {
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

  afterEach(() => {
    restoreRandomUUID();
  });

  function importTabStoreWithFallback() {
    removeRandomUUID();
    vi.resetModules();
    return import('$lib/stores/tab-store.svelte.js');
  }

  // The timeout is generous because browser-mode SvelteKit SSR init is slow
  // under full-suite parallelism and occasionally races on the first import
  // (surfacing as `wrapDynamicImport`); this test triggers that first import.
  it('initialises where crypto.randomUUID is unavailable', async () => {
    const { tabStore } = await importTabStoreWithFallback();

    expect(tabStore.tabs).toHaveLength(1);
    expect(tabStore.tabs[0]!.id).toMatch(UUID_V4);
    expect(tabStore.activeTabId).toBe(tabStore.tabs[0]!.id);
  }, 60_000);

  // `resetModules` does not re-evaluate Svelte-compiled modules in browser
  // mode, so this reuses the singleton built above. Either way the store holds
  // exactly one tab at this point, which is what makes the count below stable.
  it('still mints valid v4 ids for tabs created later', async () => {
    const { tabStore } = await importTabStoreWithFallback();

    const created = tabStore.createTab();

    expect(created).not.toBeNull();
    expect(created!.id).toMatch(UUID_V4);
    expect(new Set(tabStore.tabs.map((tab) => tab.id)).size).toBe(2);
    expect(tabStore.activeTabId).toBe(created!.id);
  }, 60_000);
});
