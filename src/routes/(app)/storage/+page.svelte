<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import BucketGrid from '$lib/components/storage/BucketGrid.svelte';
  import StorageConnectForm from '$lib/components/storage/StorageConnectForm.svelte';

  let { data } = $props();
</script>

{#if data.connected}
  <div class="p-2">
    <h1 class="mb-1 text-xl font-semibold">{m.storage_buckets_label()}</h1>
    <p class="text-base-content/60 mb-6 text-sm">{m.storage_connect_subtitle()}</p>
    <BucketGrid buckets={data.buckets} />
  </div>
{:else}
  <StorageConnectForm connectionForm={data.connectionForm} />
{/if}
