import type { LayoutServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { storageBrowserEnabled, storageHdfsEnabled } from '$lib/server/feature-flags.js';
import { listConnectionItems } from '$lib/server/storage/connections-db.js';
import { getActiveStorageConnectionId } from '$lib/server/storage/active-connection.js';
import { getUserId } from '$lib/server/auth-utils.js';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  if (!storageBrowserEnabled) {
    throw error(404, 'Not found');
  }

  locals.logger.debug('loading storage layout');

  const connections = await listConnectionItems(getUserId(locals));

  return {
    connected: false,
    buckets: [] as string[],
    connectionType: null,
    connections,
    hdfsEnabled: storageHdfsEnabled,
    activeConnectionId: getActiveStorageConnectionId(locals, cookies)
  };
};
