import { browser } from '$app/environment';
import type { Bookmark } from './types';

const LS_KEY = 'dashboard_bookmarks';

function loadBookmarks(): Bookmark[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Bookmark[]) : [];
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

export function addBookmark(bookmark: Bookmark): void {
  bookmarks.push(bookmark);
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
