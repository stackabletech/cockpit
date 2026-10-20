import { browser } from '$app/environment';
import { bookmarkSchema, type Bookmark } from './types';

const LS_KEY = 'dashboard_bookmarks';

function generateBookmarkId(): string {
  return crypto.randomUUID();
}

function loadBookmarks(): Bookmark[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    // Validate entries one by one so a single invalid entry does not discard
    // (and, on the next save, overwrite) all other bookmarks.
    return items.flatMap((item) => {
      const parsed = bookmarkSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

function saveBookmarks(items: Bookmark[]): void {
  if (!browser) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch {
    // Storage blocked or full: bookmarks stay in memory for this session.
  }
}

let bookmarks = $state<Bookmark[]>(loadBookmarks());

if (browser) {
  // Every write stores the whole list, so pick up changes from other tabs
  // before the next write here would overwrite them. A null key means storage
  // was cleared.
  window.addEventListener('storage', (event) => {
    if (event.key === LS_KEY || event.key === null) {
      bookmarks = loadBookmarks();
    }
  });
}

export function getBookmarks(): Bookmark[] {
  return bookmarks;
}

export function addBookmark(bookmark: Omit<Bookmark, 'id'>): void {
  bookmarks.push({ ...bookmark, id: generateBookmarkId() });
  saveBookmarks(bookmarks);
}

export function removeBookmark(id: string): void {
  const idx = bookmarks.findIndex((b) => b.id === id);
  if (idx !== -1) {
    bookmarks.splice(idx, 1);
    saveBookmarks(bookmarks);
  }
}

export function updateBookmark(updated: Bookmark): void {
  const idx = bookmarks.findIndex((b) => b.id === updated.id);
  if (idx !== -1) {
    bookmarks[idx] = updated;
    saveBookmarks(bookmarks);
  }
}

export function togglePinBookmark(id: string): void {
  const idx = bookmarks.findIndex((b) => b.id === id);
  if (idx !== -1) {
    bookmarks[idx] = { ...bookmarks[idx], pinned: !bookmarks[idx].pinned };
    saveBookmarks(bookmarks);
  }
}
