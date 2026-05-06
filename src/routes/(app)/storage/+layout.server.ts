import type { LayoutServerLoad } from './$types';
import { getUserConnection, listBucketsForUser } from '$lib/server/storage/user-connections.js';
import { getUserId } from '$lib/server/auth-utils.js';

export const load: LayoutServerLoad = async ({ locals }) => {
  const userId = getUserId(locals);
  const connection = getUserConnection(userId);

  if (!connection) {
    return { connected: false, buckets: [] as string[], connectionType: null };
  }

  try {
    const buckets = await listBucketsForUser(userId);
    return { connected: true, buckets, connectionType: connection.type };
  } catch (err) {
    locals.logger.warn({ err }, 'failed to list buckets for storage layout');
    return { connected: true, buckets: [] as string[], connectionType: connection.type };
  }
};
