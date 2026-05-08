<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { createQuery } from '@tanstack/svelte-query';
  import BucketGrid from '$lib/components/storage/BucketGrid.svelte';
  import StorageConnectForm from '$lib/components/storage/StorageConnectForm.svelte';
  import { storageKeys } from '$lib/queries/storage.js';

  let { data } = $props();

  const bucketsQuery = createQuery(() => ({
    queryKey: storageKeys.buckets(),
    queryFn: (): Promise<string[]> => fetch('/storage/buckets').then((r) => r.json()),
    enabled: data.connected,
    gcTime: 0
  }));

  const buckets = $derived(bucketsQuery.data ?? []);
</script>

{#if data.connected}
  <div class="p-2">
    <h1 class="mb-1 text-xl font-semibold">{m.storage_buckets_label()}</h1>
    <p class="text-base-content/60 mb-6 text-sm">{m.storage_connect_subtitle()}</p>
    <BucketGrid {buckets} />
  </div>
{:else}
  <StorageConnectForm connectionForm={data.connectionForm} />
{/if}
