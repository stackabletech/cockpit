<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import BucketList from '$lib/components/storage/sidebar/BucketList.svelte';
  import { StorageState } from '$lib/storage/state.svelte.js';
  import { setStorageState, setTabsState } from '$lib/storage/context.js';
  import StorageModals from '$lib/components/storage/modals/StorageModals.svelte';
  import { connectionHostname, connectionStore } from '$lib/storage/connection-store.svelte.js';
  import { createFetchStorageApi } from '$lib/storage/api.js';
  import { storageHref } from '$lib/storage/display-helpers.js';
  import { TabsState } from '$lib/storage/tabs.svelte.js';

  let { children, data } = $props();

  const storageApi = createFetchStorageApi(() => connectionStore.activeConnectionId);

  const storage = untrack(
    () =>
      new StorageState({
        connected: data.connected,
        buckets: data.buckets,
        connectionId: connectionStore.activeConnectionId,
        api: storageApi
      })
  );
  setStorageState(storage);

  const tabsState = new TabsState(storage, {
    connectionId: storage.connectionId,
    navigateToLocation: (connection, bucket, prefix) => {
      // Keep focus on the tab that triggered the switch instead of resetting it to <body>
      void goto(storageHref(connection, bucket, prefix), { keepFocus: true });
    },
    replaceLocationUrl: (connection, bucket, prefix) => {
      void goto(storageHref(connection, bucket, prefix), { replaceState: true, keepFocus: true });
    }
  });
  setTabsState(tabsState);

  // Keep layout-level data in sync when SvelteKit re-runs the load function
  $effect(() => {
    storage.connected = data.connected;
    storage.buckets = data.buckets;
    connectionStore.connections = data.connections;
  });

  $effect(() => {
    storage.connectionId = connectionStore.activeConnectionId;
    storage.connectionHostname = connectionHostname(connectionStore.activeConnection);
  });

  // Connections management pages have their own full-page layout — no sidebar.
  const isConnectionsRoute = $derived(page.url.pathname.startsWith('/settings/connections'));
</script>

{#if !isConnectionsRoute && (data.connected || (data.hydrating && data.hasActiveConnection))}
  <div class="flex h-full min-h-0 gap-4">
    <BucketList />
    <div class="flex min-w-0 flex-1 flex-col">
      {@render children()}
    </div>
  </div>
{:else}
  {@render children()}
{/if}

<!-- Global modals — always mounted so bucket details work from sidebar/landing page -->
<StorageModals />
