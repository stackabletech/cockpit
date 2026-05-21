<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getStorageState } from '$lib/storage/context.js';
  import FileExplorer from '$lib/components/storage/FileExplorer.svelte';

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

<FileExplorer />
