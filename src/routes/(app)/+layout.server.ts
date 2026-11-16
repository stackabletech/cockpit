import type { LayoutServerLoad } from './$types';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';
import { oidcEnabled } from '$lib/server/auth';
import { listBookmarks } from '$lib/server/dashboard/bookmarks-db.js';
import { globalBookmarks } from '$lib/server/dashboard/config.js';
import { dashboardBookmarksTotal } from '$lib/server/metrics.js';
import { BOOKMARKS_DEPENDENCY, type Bookmark } from '$lib/dashboard/types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
  depends(BOOKMARKS_DEPENDENCY);
  return {
    // Without OIDC everyone shares the local user: there is nothing to sign
    // out of and no session to lose, so the UI shows no user.
    user: oidcEnabled ? locals.user : null,
    storageBrowserEnabled,
    globalBookmarks,
    ...(await loadBookmarks(locals))
  };
};

/**
 * The user's bookmarks, or null when they are unavailable: a database failure
 * must not take down every page of the app.
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
