<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getStorageState } from '$lib/storage/context.js';
  import FileExplorer from '$lib/components/storage/explorer/FileExplorer.svelte';

  let { data } = $props();
  const storage = getStorageState();

  // Set bucket/prefix immediately so breadcrumb renders correctly during SSR
  // ($effect doesn't run on the server, but data is available from the load function)
  storage.bucket = data.bucket;
  storage.prefix = data.prefix;

  // During SSR, $effect doesn't run, so storage.loading stays false and "This bucket
  // is empty" renders instead of the loading overlay. Setting loading here when
  // hydrating ensures the loading spinner is present in the SSR HTML, preventing a
  // flash of empty state on F5 reload before the client load completes.
  if (data.hydrating) storage.loading = true;

  let hydrated = false;

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

  // Sync server data into state whenever SvelteKit load runs.
  // On first client render (hydration) with SSR empty data, set loading=true
  // so the spinner shows while the client-side load re-runs. Subsequent renders
  // from client navigation call syncFromServer normally.
  $effect(() => {
    if (!hydrated) {
      hydrated = true;
      // First client render — SSR data has hydrating:true. Set loading so the
      // spinner appears while the universal load re-fetches on the client.
      if (browser && data.hydrating) {
        storage.loading = true;
        return;
      }
    }
    storage.syncFromServer(data.bucket, data.prefix, data.objects);
  });
</script>

<FileExplorer />
