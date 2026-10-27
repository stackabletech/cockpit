import type { LayoutServerLoad } from './$types';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';
import { listBookmarks } from '$lib/server/dashboard/bookmarks-db.js';
import { dashboardBookmarksTotal } from '$lib/server/metrics.js';
import { BOOKMARKS_DEPENDENCY, type Bookmark } from '$lib/dashboard/types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
  depends(BOOKMARKS_DEPENDENCY);
  return { user: locals.user, storageBrowserEnabled, ...(await loadBookmarks(locals)) };
};

/**
 * The signed-in user's bookmarks, or null when they are unavailable: without
 * OIDC there is no user to store them for, and a database failure must not
 * take down every page of the app; `bookmarksFailed` tells the two apart.
 */
async function loadBookmarks(
  locals: App.Locals
): Promise<{ bookmarks: Bookmark[] | null; bookmarksFailed: boolean }> {
  if (!locals.user) return { bookmarks: null, bookmarksFailed: false };
  try {
    const bookmarks = await listBookmarks(locals.user.id);
    dashboardBookmarksTotal.inc({ operation: 'load', outcome: 'success' });
    return { bookmarks, bookmarksFailed: false };
  } catch (err) {
    dashboardBookmarksTotal.inc({ operation: 'load', outcome: 'error' });
    locals.logger.error({ err, user_id: locals.user.id }, 'Failed to load bookmarks');
    return { bookmarks: null, bookmarksFailed: true };
  }
}
