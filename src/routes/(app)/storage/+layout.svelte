<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import BucketList from '$lib/components/storage/BucketList.svelte';
  import { storageKeys } from '$lib/queries/storage.js';

  let { children, data } = $props();

  const bucketsQuery = createQuery(() => ({
    queryKey: storageKeys.buckets(),
    queryFn: (): Promise<string[]> => fetch('/storage/buckets').then((r) => r.json()),
    enabled: data.connected,
    // Clear cache when query becomes inactive (i.e. user disconnects) so that
    // reconnecting with different credentials never shows stale bucket data.
    gcTime: 0
  }));

  const buckets = $derived(bucketsQuery.data ?? []);
</script>

{#if data.connected}
  <div class="flex h-full min-h-0 gap-4">
    <BucketList {buckets} />
    <div class="flex min-w-0 flex-1 flex-col">
      {@render children()}
    </div>
  </div>
{:else}
  {@render children()}
{/if}
