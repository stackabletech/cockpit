import { invalidate } from '$app/navigation';
import * as m from '$lib/paraglide/messages.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import { BOOKMARKS_DEPENDENCY, type Bookmark, type BookmarkUpdate } from './types';

// The bookmarks live in the `(app)` layout data rather than a module-level
// store, which the server would share between users during SSR. Every request
// reloads them from there.

/** A bookmark request the server answered with an error status. */
export class BookmarkRequestError extends Error {
  constructor(readonly status: number) {
    super(`Bookmark request failed with status ${status}`);
  }
}

/** Reload the layout's bookmarks, with one retry; false if both attempts failed. */
async function refresh(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await invalidate(BOOKMARKS_DEPENDENCY);
      return true;
    } catch {
      // Retry once, then give up.
    }
  }
  return false;
}

async function send(path: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  });
  if (!response.ok) {
    // The list may be outdated, e.g. after a change in another tab, which is
    // often why the request failed.
    await refresh();
    throw new BookmarkRequestError(response.status);
  }
  // The change is saved, so a failed reload must not be reported as a failed
  // save, which would invite a duplicate. The layout load does not rerun on
  // navigation, so only a full reload brings the list up to date.
  if (!(await refresh())) {
    addToast('warning', m.bookmark_refresh_error(), 0, [
      { label: m.bookmark_reload(), onClick: () => location.reload() }
    ]);
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
