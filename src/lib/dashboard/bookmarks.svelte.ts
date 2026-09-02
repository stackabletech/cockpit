import { browser } from '$app/environment';
import type { Bookmark } from './types';

const LS_KEY = 'dashboard_bookmarks';

const BOOKMARK_ID_PATTERN = /^[A-Za-z0-9-]+$/;

function isValidBookmarkId(id: string): boolean {
  return id.length > 0 && BOOKMARK_ID_PATTERN.test(id);
}

function generateBookmarkId(): string {
  return crypto.randomUUID();
}

function loadBookmarks(): Bookmark[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as unknown[];
    let migrated = false;
    const normalized = items
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => {
        const bookmark = item as unknown as Bookmark;
        if (typeof bookmark.id === 'string' && isValidBookmarkId(bookmark.id)) {
          return bookmark;
        }
        migrated = true;
        return { ...bookmark, id: generateBookmarkId() };
      });
    if (migrated) {
      localStorage.setItem(LS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return [];
  }
}

function saveBookmarks(items: Bookmark[]): void {
  if (browser) {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  }
}

const bookmarks = $state<Bookmark[]>(loadBookmarks());

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
