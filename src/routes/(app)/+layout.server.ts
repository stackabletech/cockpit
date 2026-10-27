import type { LayoutServerLoad } from './$types';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';
import { listBookmarks } from '$lib/server/dashboard/bookmarks-db.js';
import { dashboardBookmarksTotal } from '$lib/server/metrics.js';
import { BOOKMARKS_DEPENDENCY, type Bookmark } from '$lib/dashboard/types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
  depends(BOOKMARKS_DEPENDENCY);
  return { user: locals.user, storageBrowserEnabled, bookmarks: await loadBookmarks(locals) };
};

/**
 * The signed-in user's bookmarks, or null when bookmarks are unavailable:
 * without OIDC there is no user to store them for, and a database failure
 * must not take down every page of the app.
 */
async function loadBookmarks(locals: App.Locals): Promise<Bookmark[] | null> {
  if (!locals.user) return null;
  try {
    const bookmarks = await listBookmarks(locals.user.id);
    dashboardBookmarksTotal.inc({ operation: 'load', outcome: 'success' });
    return bookmarks;
  } catch (err) {
    dashboardBookmarksTotal.inc({ operation: 'load', outcome: 'error' });
    locals.logger.error({ err, user_id: locals.user.id }, 'Failed to load bookmarks');
    return null;
  }
}
