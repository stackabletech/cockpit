<script lang="ts">
  import { browser } from '$app/environment';
  import { untrack } from 'svelte';
  import BucketList from '$lib/components/storage/sidebar/BucketList.svelte';
  import { StorageState } from '$lib/storage/state.svelte.js';
  import { setStorageState, setBucketSidebarToggle } from '$lib/storage/context.js';

  let { children, data } = $props();

  const storage = untrack(
    () =>
      new StorageState({
        connected: data.connected,
        buckets: data.buckets
      })
  );
  setStorageState(storage);

  let bucketSidebarOpen = $state(false);
  setBucketSidebarToggle(() => {
    bucketSidebarOpen = !bucketSidebarOpen;
  });

  // Keep layout-level data in sync when SvelteKit re-runs the load function
  $effect(() => {
    storage.connected = data.connected;
    storage.buckets = data.buckets;
  });

  // Close the bucket sidebar on navigation (mobile)
  $effect(() => {
    if (browser && data.connected) {
      void data;
      bucketSidebarOpen = false;
    }
  });
</script>

{#if data.connected}
  <!-- Mobile backdrop for bucket sidebar -->
  {#if bucketSidebarOpen}
    <button
      class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
      onclick={() => (bucketSidebarOpen = false)}
      aria-label="Close bucket browser"
      tabindex="-1"
    ></button>
  {/if}

  <div class="flex h-full min-h-0 gap-4">
    <div
      class="
        border-base-300 bg-base-100 fixed inset-y-0 left-0 z-50 mt-16 flex
        w-48 shrink-0 flex-col
        rounded-lg border transition-[transform] duration-200 ease-out
        lg:relative lg:inset-auto lg:z-auto lg:mt-0 lg:translate-x-0
        {bucketSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      "
    >
      <BucketList />
    </div>
    <div class="flex min-w-0 flex-1 flex-col">
      {@render children()}
    </div>
  </div>
{:else}
  {@render children()}
{/if}
