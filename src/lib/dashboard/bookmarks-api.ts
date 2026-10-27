import { invalidate } from '$app/navigation';
import { BOOKMARKS_DEPENDENCY, type Bookmark, type BookmarkUpdate } from './types';

// The bookmarks live in the `(app)` layout data rather than a module-level
// store, which the server would share between users during SSR. Every change
// reloads them from there.

async function send(path: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  });
  if (!response.ok) {
    throw new Error(`Bookmark request failed with status ${response.status}`);
  }
  try {
    await invalidate(BOOKMARKS_DEPENDENCY);
  } catch {
    // The change is saved; reporting it as failed would invite a duplicate.
    // The list catches up on the next navigation.
  }
}

export function addBookmark(bookmark: Omit<Bookmark, 'id' | 'createdAt'>): Promise<void> {
  return send('/api/bookmarks', 'POST', bookmark);
}

export function updateBookmark(id: string, update: BookmarkUpdate): Promise<void> {
  return send(`/api/bookmarks/${encodeURIComponent(id)}`, 'PATCH', update);
}

export function removeBookmark(id: string): Promise<void> {
  return send(`/api/bookmarks/${encodeURIComponent(id)}`, 'DELETE');
}
