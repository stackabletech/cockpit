<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { getStorageState } from '$lib/storage/context.js';
  import FileExplorer from '$lib/components/storage/explorer/FileExplorer.svelte';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import * as m from '$lib/paraglide/messages.js';

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

{#if data.accessDenied}
  <!--
    403 is rendered inline rather than via +error.svelte because throwing from a
    universal load during initial hydration (when data.connected=true causes
    BucketList to mount) can escape the storage error boundary and fall through
    to the root fallback. Rendering inline keeps the sidebar visible.
  -->
  <div
    class="
      flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center
    "
  >
    <div
      class="
        bg-error/10 text-error flex size-20 items-center justify-center
        rounded-full
      "
      aria-hidden="true"
    >
      <IconWarning class="size-10" aria-hidden="true" />
    </div>

    <div>
      <p
        class="
          text-base-content/50 mb-1 text-sm font-medium tracking-widest uppercase
        "
      >
        {m.storage_error_title()}
      </p>
      <h1 class="text-base-content text-3xl font-bold">403</h1>
      <p class="text-base-content/70 mt-2 max-w-sm text-sm">
        {m.storage_error_access_denied({ bucket: data.bucket })}
      </p>
    </div>

    <div class="flex flex-wrap items-center justify-center gap-3">
      <a href={resolve('/storage')} class="btn btn-sm btn-primary">
        {m.storage_error_back_to_storage()}
      </a>
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => history.back()}>
        {m.storage_error_go_back()}
      </button>
    </div>
  </div>
{:else}
  <FileExplorer />
{/if}
