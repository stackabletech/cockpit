<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { getStorageState } from '$lib/storage/context.js';
  import FileExplorer from '$lib/components/storage/explorer/FileExplorer.svelte';
  import IconWarning from 'virtual:icons/material-symbols/warning';
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

  // Sync server data into state whenever SvelteKit data load or URL changes
  // page.url.href ensures this re-runs after every navigation, even if data
  // appears unchanged (e.g. same-route navigation to a different prefix).
  $effect(() => {
    page.url.href;
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
