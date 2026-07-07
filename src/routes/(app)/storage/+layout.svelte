<script lang="ts">
  import { untrack } from 'svelte';
  import BucketList from '$lib/components/storage/sidebar/BucketList.svelte';
  import { StorageState } from '$lib/storage/state.svelte.js';
  import { setStorageState } from '$lib/storage/context.js';
  import StorageModals from '$lib/components/storage/modals/StorageModals.svelte';

  let { children, data } = $props();

  const storage = untrack(
    () =>
      new StorageState({
        connected: data.connected,
        buckets: data.buckets
      })
  );
  setStorageState(storage);

  // Keep layout-level data in sync when SvelteKit re-runs the load function
  $effect(() => {
    storage.connected = data.connected;
    storage.buckets = data.buckets;
  });
</script>

{#if data.connected}
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
