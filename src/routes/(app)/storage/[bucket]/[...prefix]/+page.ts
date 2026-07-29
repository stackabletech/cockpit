import { browser } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';
import { connectionStore } from '$lib/storage/connection-store.svelte.js';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import type { PageLoad } from './$types';
import type { StoragePage } from '$lib/storage/types.js';

const EMPTY_PAGE: StoragePage = {
  objects: [],
  hasNextPage: false,
  currentPage: 1,
  pageSize: 25
};

/**
 * Client-side load: fetches the object list from the server using the connection
 * config from localStorage. Redirects to /storage if no connection is available.
 * During SSR this returns an empty page — the load re-runs on the client.
 */
export const load: PageLoad = async ({ fetch, url, data }) => {
  // Always pass server data through so PageData includes bucket/prefix.
  const { bucket, prefix } = data;

  if (!browser) return { bucket, prefix, objects: EMPTY_PAGE };

  const connectionId = connectionStore.activeConnectionId;
  if (!connectionId) throw redirect(303, '/storage');

  const continuationToken = url.searchParams.get('continuationToken');
  const pageSizeParam = url.searchParams.get('pageSize');

  const query = new URLSearchParams({ bucket, prefix: prefix ?? '' });
  if (continuationToken) query.set('continuationToken', continuationToken);
  if (pageSizeParam) query.set('pageSize', pageSizeParam);

  const res = await fetch(`/api/storage/objects?${query}`, {
    headers: { [STORAGE_CONNECTION_ID_HEADER]: connectionId }
  });

  if (!res.ok) {
    if (res.status === 401) throw redirect(303, '/storage');
    // For 403 we return an accessDenied flag rather than throwing error().
    // Throwing from a universal load during initial hydration (e.g. after
    // page.goto) can bypass the +error.svelte boundary and fall through to the
    // root fallback when data.connected=true causes BucketList to mount — a
    // hydration-state mismatch that SvelteKit cannot safely recover from.
    // Handling 403 inline in +page.svelte avoids the boundary entirely and
    // keeps the sidebar visible so the user can navigate away.
    if (res.status === 403)
      return { bucket, prefix, objects: EMPTY_PAGE, accessDenied: true as const };
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw error(res.status, body.message ?? 'Failed to load objects');
  }

  const objects = (await res.json()) as StoragePage;
  return { bucket, prefix, objects };
};
