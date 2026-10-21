import { afterEach, describe, expect, it, vi } from 'vitest';

const LS_KEY = 'dashboard_bookmarks';

const validBookmark = {
  id: 'b1',
  productId: 'superset',
  name: 'Dashboards',
  environment: '',
  url: 'https://superset.example.com',
  pinned: false,
  createdAt: '2026-01-01T00:00:00.000Z'
};

let instance = 0;

/**
 * The store reads localStorage once at module load. A unique query string makes
 * Vite evaluate a fresh module instance per test (vi.resetModules() does not in
 * browser mode).
 */
async function loadStore(stored: string): Promise<typeof import('./bookmarks.svelte.js')> {
  localStorage.setItem(LS_KEY, stored);
  instance += 1;
  return import(/* @vite-ignore */ `./bookmarks.svelte.js?instance=${instance}`);
}

describe('bookmarks store', () => {
  afterEach(() => {
    localStorage.removeItem(LS_KEY);
    vi.restoreAllMocks();
  });

  it('keeps valid bookmarks when another stored entry is invalid', async () => {
    const invalid = { ...validBookmark, id: 'b2', url: 'javascript:alert(1)' };
    const { getBookmarks } = await loadStore(JSON.stringify([invalid, validBookmark]));

    expect(getBookmarks().map((b) => b.id)).toEqual(['b1']);
  });

  it('does not overwrite valid stored bookmarks on the next save', async () => {
    const { addBookmark } = await loadStore(JSON.stringify([{ broken: true }, validBookmark]));

    addBookmark({ ...validBookmark, name: 'Pipelines' });

    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    expect(saved.map((b: { name: string }) => b.name)).toEqual(['Dashboards', 'Pipelines']);
  });

  it('returns no bookmarks for non-array data', async () => {
    const { getBookmarks } = await loadStore(JSON.stringify({ not: 'an array' }));

    expect(getBookmarks()).toEqual([]);
  });

  it('keeps bookmarks added in another tab when saving', async () => {
    const { addBookmark, getBookmarks } = await loadStore('[]');

    // Simulate another tab saving a bookmark.
    const otherTab = JSON.stringify([validBookmark]);
    localStorage.setItem(LS_KEY, otherTab);
    window.dispatchEvent(new StorageEvent('storage', { key: LS_KEY, newValue: otherTab }));

    expect(getBookmarks().map((b) => b.id)).toEqual(['b1']);

    addBookmark({ ...validBookmark, name: 'Pipelines' });

    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    expect(saved.map((b: { name: string }) => b.name)).toEqual(['Dashboards', 'Pipelines']);
  });

  it('ignores storage events for other keys', async () => {
    const { getBookmarks } = await loadStore(JSON.stringify([validBookmark]));

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: '[]' }));

    expect(getBookmarks().map((b) => b.id)).toEqual(['b1']);
  });

  it('keeps the bookmark in memory when saving to localStorage fails', async () => {
    const { addBookmark, getBookmarks } = await loadStore('[]');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    expect(() => addBookmark(validBookmark)).not.toThrow();
    expect(getBookmarks()).toHaveLength(1);
  });
});
