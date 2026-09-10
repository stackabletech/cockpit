<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import BucketList from '$lib/components/storage/sidebar/BucketList.svelte';
  import { StorageState } from '$lib/storage/state.svelte.js';
  import { setStorageState, setTabsState } from '$lib/storage/context.js';
  import StorageModals from '$lib/components/storage/modals/StorageModals.svelte';
  import { connectionHostname, connectionStore } from '$lib/storage/connection-store.svelte.js';
  import { createFetchStorageApi } from '$lib/storage/api.js';
  import { TabsState } from '$lib/storage/tabs.svelte.js';
  import { storageRestoreTabsEnabled } from '$lib/client/feature-flags.js';

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

  function locationPath(connection: string, bucket: string, prefix: string): string {
    return resolve('/(app)/storage/browse/[connection]/[bucket]/[...prefix]', {
      connection: encodeURIComponent(connection),
      bucket: encodeURIComponent(bucket),
      prefix: prefix ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/') : ''
    });
  }

  const tabsState = new TabsState(storage, {
    persistEnabled: storageRestoreTabsEnabled,
    connectionId: storage.connectionId,
    navigateToLocation: (connection, bucket, prefix) => {
      void goto(locationPath(connection, bucket, prefix));
    },
    replaceLocationUrl: (connection, bucket, prefix) => {
      void goto(locationPath(connection, bucket, prefix), { replaceState: true });
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
