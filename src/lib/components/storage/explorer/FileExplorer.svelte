<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { navigating } from '$app/state';
  import { getStorageState } from '$lib/storage/context.js';
  import { TabsState } from '$lib/storage/tabs.svelte.js';
  import { setTabsState } from '$lib/storage/tabs-context.js';
  import { storageRestoreTabsEnabled } from '$lib/client/feature-flags.js';
  import StorageBreadcrumb from './StorageBreadcrumb.svelte';
  import TabBar from './TabBar.svelte';
  import ObjectTable from './ObjectTable.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import StorageModals from '../modals/StorageModals.svelte';
  import Pagination from '$lib/components/Pagination.svelte';

  const storage = getStorageState();

  function navigateToLocation(bucket: string, prefix: string): void {
    const encodedPrefix = prefix
      ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';
    goto(
      resolve('/(app)/storage/[bucket]/[...prefix]', {
        bucket: encodeURIComponent(bucket),
        prefix: encodedPrefix
      }),
      { replaceState: false }
    );
  }

  /** Updates the browser URL bar to reflect the active tab's location without
   *  triggering a SvelteKit navigation or server refetch. Used when restoring
   *  an in-memory snapshot on tab switch. */
  function replaceLocationUrl(bucket: string, prefix: string): void {
    const encodedPrefix = prefix
      ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';
    const newPath = resolve('/(app)/storage/[bucket]/[...prefix]', {
      bucket: encodeURIComponent(bucket),
      prefix: encodedPrefix
    });
    history.replaceState(history.state, '', newPath);
  }

  const tabsState = new TabsState(storage, {
    persistEnabled: storageRestoreTabsEnabled,
    connectionId: storage.connectionId,
    navigateToLocation,
    replaceLocationUrl
  });
  setTabsState(tabsState);

  // Initialise tabs once storage has bucket data.
  $effect(() => {
    if (storage.bucket) {
      untrack(() => tabsState.ensureInitialTab());
    }
  });

  // Keep the active tab snapshot in sync whenever location or page data
  // changes. Both methods are called inside untrack to prevent a reactive
  // loop: they read from this.tabs internally, and writing this.tabs would
  // otherwise re-trigger the effect.
  $effect(() => {
    void [storage.bucket, storage.prefix, storage.objects];
    untrack(() => {
      tabsState.markActiveTabLoaded();
      tabsState.syncActiveTab();
    });
  });

  // Record location visit whenever the current bucket/prefix changes.
  $effect(() => {
    const b = storage.bucket;
    const p = storage.prefix;
    if (b) untrack(() => storage.bookmarks.recordLocationVisit(b, p));
  });
</script>

<svelte:window onkeydown={storage.handleKeydown} />

<div class="bg-base-100 flex flex-1 flex-col overflow-hidden">
  {#if tabsState.hasTabs}
    <TabBar {tabsState} />
  {/if}

  <StorageBreadcrumb />

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative min-h-0 flex-1 overflow-hidden"
    onclick={(e) => {
      if (!(e.target as HTMLElement).closest('tr')) storage.clearSelection();
    }}
  >
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
