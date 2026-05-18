<script lang="ts">
  import { navigating } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import BucketGrid from '$lib/components/storage/BucketGrid.svelte';
  import StorageConnectForm from '$lib/components/storage/StorageConnectForm.svelte';
  import RecentItems from '$lib/components/storage/RecentItems.svelte';

  let { data } = $props();
</script>

{#if data.connected}
  <div class="relative flex h-full min-h-0 flex-col overflow-hidden p-2">
    {#if navigating?.to?.url.pathname.startsWith('/storage/')}
      <div
        class="bg-base-100/70 absolute inset-0 z-10 flex items-center justify-center rounded-xl"
        aria-live="polite"
        aria-label={m.storage_loading()}
      >
        <span class="loading loading-md loading-spinner text-primary" aria-hidden="true"></span>
      </div>
    {/if}
    <h1 class="mb-1 text-xl font-semibold">{m.storage_buckets_label()}</h1>
    <p class="text-base-content/60 mb-6 text-sm">{m.storage_connect_subtitle()}</p>
    <BucketGrid buckets={data.buckets} />
    <RecentItems />
  </div>
{:else}
  <StorageConnectForm connectionForm={data.connectionForm} />
{/if}
