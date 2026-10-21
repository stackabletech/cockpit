import { browser } from '$app/environment';
import { loadFromStorage, persistToStorage } from '$lib/client/local-storage.js';
import { bookmarkSchema, type Bookmark } from './types';

const LS_KEY = 'dashboard_bookmarks';

function generateBookmarkId(): string {
  return crypto.randomUUID();
}

let bookmarks = $state<Bookmark[]>(loadFromStorage(LS_KEY, bookmarkSchema));

if (browser) {
  // Every write stores the whole list, so pick up changes from other tabs
  // before the next write here would overwrite them. A null key means storage
  // was cleared.
  window.addEventListener('storage', (event) => {
    if (event.key === LS_KEY || event.key === null) {
      bookmarks = loadFromStorage(LS_KEY, bookmarkSchema);
    }
  });
}

export function getBookmarks(): Bookmark[] {
  return bookmarks;
}

export function addBookmark(bookmark: Omit<Bookmark, 'id'>): void {
  bookmarks.push({ ...bookmark, id: generateBookmarkId() });
  persistToStorage(LS_KEY, bookmarks);
}

export function removeBookmark(id: string): void {
  const idx = bookmarks.findIndex((b) => b.id === id);
  if (idx !== -1) {
    bookmarks.splice(idx, 1);
    persistToStorage(LS_KEY, bookmarks);
  }
}

export function updateBookmark(updated: Bookmark): void {
  const idx = bookmarks.findIndex((b) => b.id === updated.id);
  if (idx !== -1) {
    bookmarks[idx] = updated;
    persistToStorage(LS_KEY, bookmarks);
  }
}

export function togglePinBookmark(id: string): void {
  const idx = bookmarks.findIndex((b) => b.id === id);
  if (idx !== -1) {
    bookmarks[idx] = { ...bookmarks[idx], pinned: !bookmarks[idx].pinned };
    persistToStorage(LS_KEY, bookmarks);
  }
}
