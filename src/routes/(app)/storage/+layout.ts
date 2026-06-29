import { browser } from '$app/environment';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import { connectionStore } from '$lib/storage/connection-store.svelte.js';
import type { LayoutLoad } from './$types';

const DISCONNECTED = {
  connected: false,
  buckets: [] as string[],
  connectionType: null,
  connections: [] as import('$lib/storage/connection-store.svelte.js').ConnectionListItem[]
};

/**
 * Universal load: on the client, auto-connects to the session's active storage
 * connection. The session's `activeStorageConnectionId` (set by the connect/use
 * actions and cleared by disconnect/deleteConnection) is the source of truth —
 * no URL-param tricks needed.
 *
 * During SSR returns the disconnected default; the layout re-runs after hydration.
 */
export const load: LayoutLoad = async ({ fetch, data }) => {
  if (!browser) return DISCONNECTED;

  const connections = data.connections ?? [];
  connectionStore.connections = connections;

  // Session's active connection ID is the authoritative signal. null means the
  // user explicitly disconnected (or never connected) — show the connect form.
  const targetId = data.activeConnectionId ?? null;
  if (!targetId) {
    connectionStore.activeConnectionId = null;
    return DISCONNECTED;
  }

  const target = connections.find((c) => c.id === targetId);
  if (!target) {
    // Session refers to a connection that has since been deleted.
    connectionStore.activeConnectionId = null;
    return DISCONNECTED;
  }

  connectionStore.activeConnectionId = target.id;

  try {
    const res = await fetch('/api/storage/buckets', {
      headers: { [STORAGE_CONNECTION_ID_HEADER]: target.id }
    });

    if (!res.ok) return DISCONNECTED;

    const buckets = (await res.json()) as string[];
    return { connected: true, buckets, connectionType: 's3', connections };
  } catch {
    return DISCONNECTED;
  }
};
