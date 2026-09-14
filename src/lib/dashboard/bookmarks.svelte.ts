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
    const items = JSON.parse(raw);
    const parsed = bookmarkSchema.array().safeParse(items);
    return parsed.success ? parsed.data : [];
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
