import { browser } from '$app/environment';
import { loadConnectionLocally, getConnectionHeader } from '$lib/storage/connection-storage.js';
import type { LayoutLoad } from './$types';

const DISCONNECTED = { connected: false, buckets: [] as string[], connectionType: null };

/**
 * Client-side load: reads the connection from localStorage and fetches the bucket
 * list from the server. During SSR this returns the disconnected default — the
 * layout re-runs on the client after hydration to populate the real state.
 */
export const load: LayoutLoad = async ({ fetch, url }) => {
  if (!browser) return DISCONNECTED;

  // When the user has just explicitly disconnected, skip the auto-reconnect.
  if (url.searchParams.has('disconnected')) return DISCONNECTED;

  const connection = loadConnectionLocally();
  if (!connection) return DISCONNECTED;

  const header = getConnectionHeader(connection);

  try {
    const res = await fetch('/api/storage/buckets', {
      headers: { 'x-storage-connection': header }
    });

    if (!res.ok) return DISCONNECTED;

    const buckets = (await res.json()) as string[];
    return { connected: true, buckets, connectionType: connection.type };
  } catch {
    return DISCONNECTED;
  }
};
