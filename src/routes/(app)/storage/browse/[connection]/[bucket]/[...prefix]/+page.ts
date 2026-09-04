import { browser } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';
import { connectionHostname, connectionStore } from '$lib/storage/connection-store.svelte.js';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import * as m from '$lib/paraglide/messages.js';
import type { PageLoad } from './$types';
import type { StoragePage } from '$lib/storage/types.js';

const EMPTY_PAGE: StoragePage = {
  objects: [],
  hasNextPage: false,
  currentPage: 1,
  pageSize: 25
};

/**
 * Universal load: fetches the object list from the API.
 *
 * During SSR the fetch runs server-side so that permission errors (403) are
 * caught by the SSR error boundary — this ensures our custom +error.svelte
 * renders the full error page (breadcrumbs, icon, message, action buttons).
 * On success during SSR we still return hydrating data; the client re-fetches
 * and updates the page after hydration.
 */
export const load: PageLoad = async ({ fetch, url, data }) => {
  const { connection, bucket, prefix } = data;

  const connectionId = connectionStore.activeConnectionId ?? data.activeConnectionId;
  if (!connectionId) throw redirect(303, '/storage');
  if (browser && connectionHostname(connectionStore.activeConnection) !== connection) {
    throw redirect(303, '/storage');
  }

  const query = new URLSearchParams({ bucket, prefix: prefix ?? '' });

  if (!browser) {
    const res = await fetch(`/api/storage/list?${query}`, {
      headers: { [STORAGE_CONNECTION_ID_HEADER]: connectionId }
    });

    if (!res.ok) {
      if (res.status === 401) throw redirect(303, '/storage');
      if (res.status === 403) throw error(403, m.storage_error_access_denied({ bucket }));
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw error(res.status, body.message ?? 'Failed to load objects');
    }

    return { connection, bucket, prefix, objects: EMPTY_PAGE, hydrating: true };
  }

  const continuationToken = url.searchParams.get('continuationToken');
  const pageSizeParam = url.searchParams.get('pageSize');

  if (continuationToken) query.set('continuationToken', continuationToken);
  if (pageSizeParam) query.set('pageSize', pageSizeParam);

  const res = await fetch(`/api/storage/list?${query}`, {
    headers: { [STORAGE_CONNECTION_ID_HEADER]: connectionId }
  });

  if (!res.ok) {
    if (res.status === 401) throw redirect(303, '/storage');
    if (res.status === 403) throw error(403, m.storage_error_access_denied({ bucket }));
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw error(res.status, body.message ?? 'Failed to load objects');
  }

  const objects = (await res.json()) as StoragePage;
  return { connection, bucket, prefix, objects, hydrating: false };
};
