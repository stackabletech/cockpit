import { error } from '@sveltejs/kit';
import { createBookmark, listBookmarks } from '$lib/server/dashboard/bookmarks-db.js';
import { dashboardBookmarksTotal } from '$lib/server/metrics.js';
import { requireUserId } from '$lib/server/auth-utils.js';
import { BOOKMARK_LIMIT, bookmarkCreateSchema } from '$lib/dashboard/types.js';
import type { RequestHandler } from './$types';

/** Lists the current user's bookmarks. */
export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUserId(locals);
  try {
    const bookmarks = await listBookmarks(userId);
    dashboardBookmarksTotal.inc({ operation: 'list', outcome: 'success' });
    return Response.json(bookmarks);
  } catch (err) {
    dashboardBookmarksTotal.inc({ operation: 'list', outcome: 'error' });
    throw err;
  }
};

/** Creates a bookmark for the current user, up to `BOOKMARK_LIMIT`. */
export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUserId(locals);
  const parsed = bookmarkCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid bookmark');

  let bookmark;
  try {
    bookmark = await createBookmark(userId, parsed.data);
  } catch (err) {
    dashboardBookmarksTotal.inc({ operation: 'create', outcome: 'error' });
    throw err;
  }
  if (!bookmark) {
    dashboardBookmarksTotal.inc({ operation: 'create', outcome: 'limit_reached' });
    throw error(409, `Bookmark limit of ${BOOKMARK_LIMIT} reached`);
  }
  dashboardBookmarksTotal.inc({ operation: 'create', outcome: 'success' });
  locals.logger.info(
    { user_id: userId, bookmark_id: bookmark.id, product_id: bookmark.productId },
    'bookmark created'
  );
  return Response.json(bookmark, { status: 201 });
};
