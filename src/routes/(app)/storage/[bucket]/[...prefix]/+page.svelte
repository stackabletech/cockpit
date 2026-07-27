<script lang="ts">
  import { browser } from '$app/environment';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { getStorageState } from '$lib/storage/context.js';
  import FileExplorer from '$lib/components/storage/explorer/FileExplorer.svelte';

  let { data } = $props();
  const storage = getStorageState();

  // Set bucket/prefix immediately so breadcrumb renders correctly during SSR
  // ($effect doesn't run on the server, but data is available from the load function)
  // svelte-ignore state_referenced_locally
  storage.bucket = data.bucket;
  // svelte-ignore state_referenced_locally
  storage.prefix = data.prefix;

  // During SSR, $effect doesn't run, so storage.loading stays false and the
  // empty state renders instead of the loading overlay. Setting loading here
  // when hydrating ensures the loading spinner is present in the SSR HTML,
  // preventing a flash of empty state on F5 reload before the client load completes.
  // svelte-ignore state_referenced_locally
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

  // Inject refresh handler — navigates to the current bucket/prefix using
  // replaceState so that a refresh does not add a browser history entry.
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

    if (page.url.pathname === basePath) {
      void invalidateAll();
    } else {
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      void goto(url, { replaceState: true });
    }
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
      // Don't call syncFromServer yet — that would set loading=false with stale data.
      if (browser && data.hydrating) {
        storage.loading = true;
        return;
      }
    }
    storage.syncFromServer(data.bucket, data.prefix, data.objects);
  });
</script>

<FileExplorer />
