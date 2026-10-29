import { invalidate } from '$app/navigation';
import { BOOKMARKS_DEPENDENCY, type Bookmark, type BookmarkUpdate } from './types';

// The bookmarks live in the `(app)` layout data rather than a module-level
// store, which the server would share between users during SSR. Every request
// reloads them from there. `invalidate` does not reject when that reload fails:
// SvelteKit shows its error page instead, so there is no failure to handle here.

/** A bookmark request the server answered with an error status. */
export class BookmarkRequestError extends Error {
  constructor(readonly status: number) {
    super(`Bookmark request failed with status ${status}`);
  }
}

async function send(path: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  });
  if (!response.ok) {
    // Reload on failure too: the list may be outdated, e.g. after a change in
    // another tab, which is often why the request failed. Not awaited, so the
    // caller can show the error without waiting for the reload.
    void invalidate(BOOKMARKS_DEPENDENCY);
    throw new BookmarkRequestError(response.status);
  }
  await invalidate(BOOKMARKS_DEPENDENCY);
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
