import { browser } from '$app/environment';
import { error, isHttpError, redirect } from '@sveltejs/kit';
import { connectionHostname, connectionStore } from '$lib/storage/connection-store.svelte.js';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import * as m from '$lib/paraglide/messages.js';
import type { PageLoad } from './$types';
import type { StoragePage } from '$lib/storage/types.js';
import { isNotConnectedBody } from '$lib/storage/storage-fetch.js';

const EMPTY_PAGE: StoragePage = {
  objects: [],
  hasNextPage: false,
  currentPage: 1,
  pageSize: 25
};

/** A session or connection problem sends the user back to the connect form. */
async function throwListError(res: Response, bucket: string): Promise<never> {
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 401 || isNotConnectedBody(body)) throw redirect(303, '/storage');
  if (res.status === 403) throw error(403, m.storage_error_access_denied({ bucket }));
  const message = (body as { message?: string } | null)?.message;
  throw error(res.status, message ?? 'Failed to load objects');
}

/**
 * Universal load: fetches the object list from the API.
 *
 * During SSR the fetch runs server-side so that permission errors (403) are
 * caught by the SSR error boundary — this ensures our custom +error.svelte
 * renders the full error page (breadcrumbs, icon, message, action buttons).
 * On success during SSR we still return hydrating data; the client re-fetches
 * and updates the page after hydration.
 */
export const load: PageLoad = async ({ fetch, url, data, parent }) => {
  const { connection, bucket, prefix } = data;

  // The storage layout load populates `connectionStore` in the browser and
  // provides the saved connections for the hostname check below.
  const { connections } = await parent();

  const connectionId = connectionStore.activeConnectionId ?? data.activeConnectionId;
  if (!connectionId) throw redirect(303, '/storage');
  // A link to a storage the user is not connected to (e.g. from another
  // connection's recent locations) must not list the active connection's bucket.
  const active = connections.find((c) => c.id === connectionId);
  if (!active) throw redirect(303, '/storage');
  if (connectionHostname(active) !== connection) {
    throw error(404, { message: 'Not connected', reason: 'not-connected', connection });
  }

  const query = new URLSearchParams({ bucket, prefix: prefix ?? '' });

  if (!browser) {
    let res: Response;
    try {
      res = await fetch(`/api/storage/list?${query}`, {
        headers: { [STORAGE_CONNECTION_ID_HEADER]: connectionId }
      });
    } catch (err) {
      if (isHttpError(err) && err.status === 403) {
        throw error(403, m.storage_error_access_denied({ bucket }));
      }
      throw err;
    }

    if (!res.ok) await throwListError(res, bucket);

    return { connection, bucket, prefix, objects: EMPTY_PAGE, hydrating: true };
  }

  const continuationToken = url.searchParams.get('continuationToken');
  const pageSizeParam = url.searchParams.get('pageSize');

  if (continuationToken) query.set('continuationToken', continuationToken);
  if (pageSizeParam) query.set('pageSize', pageSizeParam);

  const res = await fetch(`/api/storage/list?${query}`, {
    headers: { [STORAGE_CONNECTION_ID_HEADER]: connectionId }
  });

  if (!res.ok) await throwListError(res, bucket);

  const objects = (await res.json()) as StoragePage;
  return { connection, bucket, prefix, objects, hydrating: false };
};
