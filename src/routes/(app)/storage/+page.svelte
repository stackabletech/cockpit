<script lang="ts">
  import { navigating } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import BucketGrid from '$lib/components/storage/landing/BucketGrid.svelte';
  import StorageConnectForm from '$lib/components/storage/landing/StorageConnectForm.svelte';
  import RecentItems from '$lib/components/storage/landing/RecentItems.svelte';
  import AddBucketModal from '$lib/components/storage/landing/AddBucketModal.svelte';
  import IconAdd from 'virtual:icons/material-symbols/add';

  let { data } = $props();
  const storage = getStorageState();

  let addBucketOpen = $state(false);
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
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="mb-1 text-xl font-semibold">{m.storage_buckets_label()}</h1>
        <p class="text-base-content/60 text-sm">{m.storage_buckets_subtitle()}</p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm shrink-0"
        onclick={() => (addBucketOpen = true)}
        aria-label={m.storage_add_bucket()}
      >
        <IconAdd class="size-4" aria-hidden="true" />
        {m.storage_add_bucket()}
      </button>
    </div>
    <BucketGrid buckets={storage.buckets} />
    <RecentItems />
  </div>
  <AddBucketModal bind:open={addBucketOpen} />
{:else}
  <StorageConnectForm connectionForm={data.connectionForm} />
{/if}
