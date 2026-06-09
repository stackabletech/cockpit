<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { getStorageState } from '$lib/storage/context.js';
  import FileExplorer from '$lib/components/storage/explorer/FileExplorer.svelte';

  let { data } = $props();
  const storage = getStorageState();

  // Inject navigation handler — page owns URL construction.
  // Uses storage.bucket (not data.bucket) so that after a tab switch via
  // snapshot restore the handler still builds URLs for the active tab's bucket.
  storage.setNavigationHandler((prefix, continuationToken, pageSize) => {
    const encodedPrefix = prefix
      ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';

    const basePath = resolve('/(app)/storage/[bucket]/[...prefix]', {
      bucket: encodeURIComponent(storage.bucket),
      prefix: encodedPrefix
    });

    const url = new URL(basePath, location.origin);
    if (continuationToken) url.searchParams.set('continuationToken', String(continuationToken));
    if (pageSize) url.searchParams.set('pageSize', String(pageSize));

    // eslint-disable-next-line svelte/no-navigation-without-resolve -- base path is built with resolve(); URL object is needed to append query params
    goto(url, { replaceState: false });
  });

  // Inject refresh handler — navigates to the current bucket/prefix using
  // replaceState so that a refresh does not add a browser history entry.
  // Reads storage.bucket/prefix at call time so it always reflects the active
  // tab's location, even after a snapshot restore via history.replaceState.
  storage.setRefreshHandler(() => {
    const encodedPrefix = storage.prefix
      ? storage.prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';

    const basePath = resolve('/(app)/storage/[bucket]/[...prefix]', {
      bucket: encodeURIComponent(storage.bucket),
      prefix: encodedPrefix
    });

    const url = new URL(basePath, location.origin);
    if (storage.pageSize) url.searchParams.set('pageSize', String(storage.pageSize));

    // If SvelteKit's internal route already points at the correct location,
    // goto() would be a no-op (same URL) and loading would never clear.
    // Use invalidateAll() instead — the route params are already correct.
    if (page.url.pathname === basePath) {
      void invalidateAll();
    } else {
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- base path is built with resolve(); URL object is needed to append query params
      void goto(url, { replaceState: true });
    }
  });

  // Sync server data into state whenever SvelteKit load runs
  $effect(() => {
    storage.syncFromServer(data.bucket, data.prefix, data.objects);
  });
</script>

<FileExplorer />
