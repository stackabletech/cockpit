<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import StorageSearchHistoryEntry from '$lib/components/storage/StorageSearchHistoryEntry.svelte';
  import type { RecentSearchEntry } from '$lib/storage/types.js';
  import IconDelete from 'virtual:icons/material-symbols/delete';

  interface Props {
    entries: RecentSearchEntry[];
    onUse: (entry: RecentSearchEntry, buckets: string[]) => void;
    onClear: () => void;
  }

  let { entries, onUse, onClear }: Props = $props();

  let confirmOpen = $state(false);

  function confirmClear(): void {
    confirmOpen = false;
    onClear();
  }
</script>

<section class="flex h-full flex-col" aria-label={m.storage_search_recent_heading()}>
  <div class="mb-2 flex items-center justify-between gap-3">
    <h3 class="text-sm font-semibold">{m.storage_search_recent_heading()}</h3>
    {#if entries.length > 0}
      <button
        type="button"
        class="btn btn-ghost btn-xs hover:bg-error/10 hover:text-error gap-1"
        onclick={() => (confirmOpen = true)}
      >
        <IconDelete class="size-3.5" aria-hidden="true" />
        {m.storage_search_recent_clear()}
      </button>
    {/if}
  </div>

  {#if entries.length === 0}
    <p class="text-base-content/50 py-8 text-center text-sm">{m.storage_search_recent_empty()}</p>
  {:else}
    <ul class="flex w-full flex-col gap-1 p-0">
      {#each entries as entry (entry.buckets.join(',') + entry.query + String(entry.useRegex) + entry.excludePatterns.join(',') + entry.searchPath + (entry.maxDepth ?? '') + entry.buckets.length)}
        <li class="w-full">
          <StorageSearchHistoryEntry {entry} onUse={(e, buckets) => onUse(e, buckets)} />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<Modal bind:open={confirmOpen} class="modal">
  <div class="modal-box max-w-sm">
    <h3 class="mb-3 flex items-center gap-2 text-lg font-bold">
      <IconDelete class="text-error size-5 shrink-0" aria-hidden="true" />
      {m.storage_search_recent_clear_confirm_title()}
    </h3>
    <p class="text-base-content/80 text-sm">{m.storage_search_recent_clear_confirm_message()}</p>
    <div class="modal-action mt-6">
      <button class="btn btn-ghost" onclick={() => (confirmOpen = false)}>
        {m.storage_search_recent_clear_cancel()}
      </button>
      <button class="btn btn-outline btn-error" onclick={confirmClear}>
        <IconDelete class="size-4" aria-hidden="true" />
        {m.storage_search_recent_clear_confirm()}
      </button>
    </div>
  </div>
</Modal>
