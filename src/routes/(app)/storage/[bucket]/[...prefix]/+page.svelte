<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getStorageState } from '$lib/storage/context.js';
  import FileExplorer from '$lib/components/storage/explorer/FileExplorer.svelte';
  import StorageErrorPanel from '$lib/components/storage/shared/StorageErrorPanel.svelte';
  import * as m from '$lib/paraglide/messages.js';

  let { data } = $props();
  const storage = getStorageState();

  // Inject navigation handler — page owns URL construction
  storage.setNavigationHandler((prefix, continuationToken, pageSize) => {
    const encodedPrefix = prefix
      ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';

    const basePath = resolve('/(app)/storage/[bucket]/[...prefix]', {
      bucket: encodeURIComponent(data.bucket),
      prefix: encodedPrefix
    });

    const url = new URL(basePath, location.origin);
    if (continuationToken) url.searchParams.set('continuationToken', String(continuationToken));
    if (pageSize) url.searchParams.set('pageSize', String(pageSize));

    // eslint-disable-next-line svelte/no-navigation-without-resolve -- base path is built with resolve(); URL object is needed to append query params
    goto(url, { replaceState: false });
  });

  // Sync server data into state whenever SvelteKit load runs
  $effect(() => {
    storage.syncFromServer(data.bucket, data.prefix, data.objects);
  });
</script>

{#if data.accessDenied}
  <!--
    403 is rendered in-page rather than via +error.svelte because throwing from a
    universal load during initial hydration (when data.connected=true causes
    BucketList to mount) can escape the storage error boundary and fall through
    to the root fallback. Rendering in-page keeps the sidebar visible.
  -->
  <StorageErrorPanel
    status={403}
    message={m.storage_error_access_denied({ bucket: data.bucket })}
  />
{:else}
  <FileExplorer />
{/if}
