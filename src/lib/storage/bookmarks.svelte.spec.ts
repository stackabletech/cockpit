import { describe, it, expect, beforeEach } from 'vitest';
import { BookmarksState } from '$lib/storage/bookmarks.svelte.js';
import { LS_PINS, LS_RECENT_FILES, LS_RECENT_LOCATIONS } from '$lib/storage/persistence.js';

describe('BookmarksState — connectionId scoping', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('constructor filtering', () => {
    it('loads only pins tagged with the given connectionId', () => {
      localStorage.setItem(
        LS_PINS,
        JSON.stringify([
          { bucket: 'a', prefix: 'data/', connectionId: 'conn-1' },
          { bucket: 'b', prefix: 'other/', connectionId: 'conn-2' }
        ])
      );

      const bookmarks = new BookmarksState('conn-1');

      expect(bookmarks.pinnedLocations).toHaveLength(1);
      expect(bookmarks.pinnedLocations[0].bucket).toBe('a');
    });

    it('loads only recent files tagged with the given connectionId', () => {
      localStorage.setItem(
        LS_RECENT_FILES,
        JSON.stringify([
          {
            key: 'a.txt',
            bucket: 'x',
            size: 1,
            visitedAt: new Date().toISOString(),
            connectionId: 'conn-1'
          },
          {
            key: 'b.txt',
            bucket: 'y',
            size: 2,
            visitedAt: new Date().toISOString(),
            connectionId: 'conn-2'
          }
        ])
      );

      const bookmarks = new BookmarksState('conn-1');

      expect(bookmarks.recentFiles).toHaveLength(1);
      expect(bookmarks.recentFiles[0].key).toBe('a.txt');
    });

    it('loads only recent locations tagged with the given connectionId', () => {
      localStorage.setItem(
        LS_RECENT_LOCATIONS,
        JSON.stringify([
          {
            bucket: 'x',
            prefix: 'images/',
            visitedAt: new Date().toISOString(),
            connectionId: 'conn-1'
          },
          {
            bucket: 'y',
            prefix: 'docs/',
            visitedAt: new Date().toISOString(),
            connectionId: 'conn-2'
          }
        ])
      );

      const bookmarks = new BookmarksState('conn-1');

      expect(bookmarks.recentLocations).toHaveLength(1);
      expect(bookmarks.recentLocations[0].prefix).toBe('images/');
    });

    it('silently drops entries without connectionId', () => {
      localStorage.setItem(
        LS_PINS,
        JSON.stringify([
          { bucket: 'legacy', prefix: '' } // no connectionId — pre-migration entry
        ])
      );

      const bookmarks = new BookmarksState('conn-1');

      expect(bookmarks.pinnedLocations).toHaveLength(0);
    });
  });

  describe('pin()', () => {
    it('tags new pins with the connectionId', () => {
      const bookmarks = new BookmarksState('conn-1');
      bookmarks.pin('my-bucket', 'images/');

      const stored = JSON.parse(localStorage.getItem(LS_PINS) ?? '[]') as unknown[];
      expect(stored).toHaveLength(1);
      expect((stored[0] as { connectionId: string }).connectionId).toBe('conn-1');
    });

    it('does not overwrite pins from other connections on persist', () => {
      localStorage.setItem(
        LS_PINS,
        JSON.stringify([{ bucket: 'other', prefix: 'data/', connectionId: 'conn-2' }])
      );

      const bookmarks = new BookmarksState('conn-1');
      bookmarks.pin('my-bucket', 'images/');

      const stored = JSON.parse(localStorage.getItem(LS_PINS) ?? '[]') as unknown[];
      expect(stored).toHaveLength(2);
    });
  });

  describe('recordFileVisit()', () => {
    it('tags new entries with the connectionId', () => {
      const bookmarks = new BookmarksState('conn-1');
      bookmarks.recordFileVisit('my-bucket', 'photo.jpg', 1024);

      const stored = JSON.parse(localStorage.getItem(LS_RECENT_FILES) ?? '[]') as unknown[];
      expect(stored).toHaveLength(1);
      expect((stored[0] as { connectionId: string }).connectionId).toBe('conn-1');
    });

    it('preserves recent files from other connections on persist', () => {
      localStorage.setItem(
        LS_RECENT_FILES,
        JSON.stringify([
          {
            key: 'other.txt',
            bucket: 'y',
            size: 1,
            visitedAt: new Date().toISOString(),
            connectionId: 'conn-2'
          }
        ])
      );

      const bookmarks = new BookmarksState('conn-1');
      bookmarks.recordFileVisit('my-bucket', 'photo.jpg', 1024);

      const stored = JSON.parse(localStorage.getItem(LS_RECENT_FILES) ?? '[]') as unknown[];
      expect(stored).toHaveLength(2);
    });
  });
});
