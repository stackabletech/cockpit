import type { LayoutServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';
import { auth, oidcEnabled } from '$lib/server/auth.js';
import { listUserConnections, getConnectionForUser } from '$lib/server/storage/connections-db.js';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import { storageAutoConnectEnabled } from '$lib/client/feature-flags.js';

const DISCONNECTED_BASE = {
  connected: false as const,
  buckets: [] as string[],
  connectionType: null as null
};

export const load: LayoutServerLoad = async ({ locals, request, url }) => {
  if (!storageBrowserEnabled) {
    throw error(404, 'Not found');
  }
  if (!oidcEnabled) {
    throw error(404, 'Not found');
  }

  const userId = locals.user!.id;
  locals.logger.debug('loading storage layout');

  const connections = await listUserConnections(userId);

  // The ?disconnected=1 parameter is used after the disconnect action and by
  // test helpers to force the disconnected UI without clearing the session.
  if (url.searchParams.has('disconnected')) {
    return { ...DISCONNECTED_BASE, connections, connectError: null };
  }

  const activeId = locals.session?.activeStorageConnectionId ?? null;

  if (!activeId) {
    return { ...DISCONNECTED_BASE, connections, connectError: null };
  }

  const config = await getConnectionForUser(userId, activeId);
  if (!config) {
    // Connection was deleted — clear the stale session field silently.
    await auth.api.updateSession({
      headers: request.headers,
      body: { activeStorageConnectionId: null }
    });
    return { ...DISCONNECTED_BASE, connections, connectError: null };
  }

  if (!storageAutoConnectEnabled) {
    return { ...DISCONNECTED_BASE, connections, connectError: null };
  }

  // Auto-connect: test the stored connection and list buckets.
  try {
    const buckets = await getConnectionProvider(config).listContainers();
    return {
      connected: true,
      buckets,
      connectionType: config.type,
      connections,
      connectError: null
    };
  } catch (err) {
    locals.logger.warn({ err }, 'storage auto-connect failed');
    return {
      ...DISCONNECTED_BASE,
      connections,
      connectError: 'storage_connect_error_unreachable' as const
    };
  }
};
