<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import BucketList from '$lib/components/storage/sidebar/BucketList.svelte';
  import { StorageState } from '$lib/storage/state.svelte.js';
  import { setStorageState } from '$lib/storage/context.js';
  import { setStorageRouteBase, APP_STORAGE_ROUTES } from '$lib/storage/route-context.js';

  let { children, data } = $props();

  const storage = untrack(
    () =>
      new StorageState({
        connected: data.connected,
        buckets: data.buckets,
        connectionId: data.connectionId
      })
  );
  setStorageState(storage);
  setStorageRouteBase(APP_STORAGE_ROUTES);

  // Keep layout-level data in sync when SvelteKit re-runs the load function
  $effect(() => {
    storage.connected = data.connected;
    storage.buckets = data.buckets;
  });

  // Connections management pages have their own full-page layout — no sidebar.
  const isConnectionsRoute = $derived(page.url.pathname.startsWith('/storage/connections'));
</script>

{#if data.connected && !isConnectionsRoute}
  <div class="flex h-full min-h-0 gap-4">
    <BucketList />
    <div class="flex min-w-0 flex-1 flex-col">
      {@render children()}
    </div>
  </div>
{:else}
  {@render children()}
{/if}
