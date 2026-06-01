<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { untrack } from 'svelte';
  import { navigating } from '$app/state';
  import { getStorageState } from '$lib/storage/context.js';
  import StorageBreadcrumb from './StorageBreadcrumb.svelte';
  import ObjectTable from './ObjectTable.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import StorageModals from '../modals/StorageModals.svelte';
  import Pagination from '$lib/components/Pagination.svelte';

  const storage = getStorageState();

  // Record location visit whenever the current bucket/prefix changes.
  $effect(() => {
    const b = storage.bucket;
    const p = storage.prefix;
    if (b) untrack(() => storage.bookmarks.recordLocationVisit(b, p));
  });

  // Clicking anywhere inside the object-list container that is not a table row
  // clears the current selection. Keyboard users already have Escape via the
  // svelte:window handler below, so no key handler is needed here.
  let objectListEl: HTMLDivElement;
  $effect(() => {
    function handleClick(e: MouseEvent) {
      if (objectListEl.contains(e.target as Node) && !(e.target as HTMLElement).closest('tr')) {
        storage.clearSelection();
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  });
</script>

<svelte:window onkeydown={storage.handleKeydown} />

<div class="bg-base-100 flex flex-1 flex-col overflow-hidden">
  <StorageBreadcrumb />

  <div bind:this={objectListEl} class="relative min-h-0 flex-1 overflow-hidden">
    {#if storage.loading || storage.deleting || navigating.to}
      <div
        class="bg-base-100/70 absolute inset-0 z-20 flex items-center justify-center"
        aria-live="polite"
        aria-label={m.storage_loading()}
      >
        <span class="loading loading-md loading-spinner text-primary" aria-hidden="true"></span>
      </div>
    {/if}
    <ObjectTable />
  </div>

  <!-- Fixed pagination bar at bottom -->
  <div class="border-base-200/40 bg-base-100 sticky bottom-0 z-10 border-t px-4 py-3">
    <Pagination
      bind:pageSize={storage.pageSize}
      storageKey="storage_page_size"
      pageSizeLabel={m.storage_page_size()}
      infoLabel="{m.storage_page()} {storage.currentPage}"
      current={storage.prevTokens.length}
      hasNext={storage.objects.hasNextPage}
      onfirst={storage.navigateFirst}
      onprev={storage.navigatePrev}
      onnext={storage.navigateNext}
      onpagesizechange={storage.onPageSizeChange}
    />
  </div>
</div>

<!-- Context menu -->
{#if storage.contextMenu}
  <ContextMenu />
{/if}

<!-- Modals -->
<StorageModals />
