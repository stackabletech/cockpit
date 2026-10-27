import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteBookmark, updateBookmark } from '$lib/server/dashboard/bookmarks-db.js';
import { dashboardBookmarksTotal } from '$lib/server/metrics.js';
import { requireUserId } from '$lib/server/auth-utils.js';
import { bookmarkUpdateSchema } from '$lib/dashboard/types.js';
import type { RequestHandler } from './$types';

/** Bookmark ids are UUIDs; anything else cannot exist and would fail the query. */
function bookmarkIdFromParams(params: { id: string }): string {
  const parsed = z.guid().safeParse(params.id);
  if (!parsed.success) throw error(404, 'Bookmark not found');
  return parsed.data;
}

/** Updates fields of one of the current user's bookmarks. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const userId = requireUserId(locals);
  const id = bookmarkIdFromParams(params);
  const parsed = bookmarkUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid bookmark update');

  let bookmark;
  try {
    bookmark = await updateBookmark(userId, id, parsed.data);
  } catch (err) {
    dashboardBookmarksTotal.inc({ operation: 'update', outcome: 'error' });
    throw err;
  }
  if (!bookmark) {
    dashboardBookmarksTotal.inc({ operation: 'update', outcome: 'not_found' });
    throw error(404, 'Bookmark not found');
  }
  dashboardBookmarksTotal.inc({ operation: 'update', outcome: 'success' });
  locals.logger.info(
    { user_id: userId, bookmark_id: id, fields: Object.keys(parsed.data) },
    'bookmark updated'
  );
  return Response.json(bookmark);
};

/** Deletes one of the current user's bookmarks. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
  const userId = requireUserId(locals);
  const id = bookmarkIdFromParams(params);

  let deleted;
  try {
    deleted = await deleteBookmark(userId, id);
  } catch (err) {
    dashboardBookmarksTotal.inc({ operation: 'delete', outcome: 'error' });
    throw err;
  }
  if (!deleted) {
    dashboardBookmarksTotal.inc({ operation: 'delete', outcome: 'not_found' });
    throw error(404, 'Bookmark not found');
  }
  dashboardBookmarksTotal.inc({ operation: 'delete', outcome: 'success' });
  locals.logger.info({ user_id: userId, bookmark_id: id }, 'bookmark deleted');
  return new Response(null, { status: 204 });
};
