import type { LayoutServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getConnection, listBuckets } from '$lib/server/storage/service.js';
import { deriveConnectionId } from '$lib/server/storage/user-connections.js';
import { getUserId } from '$lib/server/auth-utils.js';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!storageBrowserEnabled) {
    throw error(404, 'Not found');
  }

  const userId = getUserId(locals);
  const connection = getConnection(userId);

  if (!connection) {
    return { connected: false, buckets: [] as string[], connectionType: null, connectionId: null };
  }

  try {
    const buckets = await listBuckets(userId);
    return {
      connected: true,
      buckets,
      connectionType: connection.type,
      connectionId: deriveConnectionId(connection)
    };
  } catch (err) {
    locals.logger.warn({ err }, 'failed to list buckets for storage layout');
    return {
      connected: true,
      buckets: [] as string[],
      connectionType: connection.type,
      connectionId: deriveConnectionId(connection)
    };
  }
};
