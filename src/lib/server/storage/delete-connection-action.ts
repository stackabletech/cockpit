import { fail, type ActionFailure, type RequestEvent } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { ConnectionIdSchema } from '$lib/storage/schemas.js';
import { auth } from '$lib/server/auth.js';
import { deleteConnection } from './connections-db.js';
import * as m from '$lib/paraglide/messages.js';

/**
 * Body of the `deleteConnection` form actions: deletes the posted connection of the current user
 * and clears the session's active connection if it was that one. Returns a failure to hand back
 * to the form, or `undefined` on success; the caller redirects.
 */
export async function deleteConnectionAction({
  request,
  locals
}: RequestEvent): Promise<ActionFailure<{ error: string }> | undefined> {
  const log = locals.logger;
  const form = await superValidate(request, zod(ConnectionIdSchema));

  if (!form.valid) {
    log.debug({ errors: form.errors }, 'invalid connection id for delete');
    return fail(400, { error: m.storage_connection_edit_not_found() });
  }

  const { connectionId } = form.data;
  const userId = locals.user!.id;
  const activeId = locals.session?.activeStorageConnectionId ?? null;

  try {
    if (connectionId === activeId) {
      await auth.api.updateSession({
        headers: request.headers,
        body: { activeStorageConnectionId: null }
      });
      log.info(
        { connection_id: connectionId },
        'active storage connection deleted, session cleared'
      );
    }

    await deleteConnection(userId, connectionId);
  } catch (err) {
    log.error({ err, connection_id: connectionId }, 'failed to delete storage connection');
    return fail(500, { error: m.storage_connections_delete_failed() });
  }

  return undefined;
}
