<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { navigating } from '$app/state';
  import { getStorageState } from '$lib/storage/context.js';
  import { TabsState } from '$lib/storage/tabs.svelte.js';
  import { setTabsState } from '$lib/storage/context.js';
  import { storageRestoreTabsEnabled } from '$lib/client/feature-flags.js';
  import StorageBreadcrumb from './StorageBreadcrumb.svelte';
  import TabBar from './TabBar.svelte';
  import ObjectTable from './ObjectTable.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import Pagination from '$lib/components/Pagination.svelte';

  const storage = getStorageState();

  function navigateToLocation(bucket: string, prefix: string): void {
    const encodedPrefix = prefix
      ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';
    const basePath = resolve('/(app)/storage/[bucket]/[...prefix]', {
      bucket: encodeURIComponent(bucket),
      prefix: encodedPrefix
    });
    const url = new URL(basePath, location.origin);
    if (storage.pageSize) url.searchParams.set('pageSize', String(storage.pageSize));
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- base path is built with resolve(); URL object is needed to append query params
    goto(url, { replaceState: false });
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

  // Wire up source-tab invalidation so that after a move, source tabs refetch.
  storage.setTabsInvalidationHandler((prefix: string) => {
    tabsState.setStalePrefix(prefix);
  });

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

  // Clicking anywhere inside the object-list container that is not a table row
  // clears the current selection (left-click) or opens the empty-space context
  // menu (right-click). Keyboard users already have Escape via the svelte:window
  // handler below, so no key handler is needed here.
  let objectListEl: HTMLDivElement;
  $effect(() => {
    function handleClick(e: MouseEvent) {
      if (objectListEl.contains(e.target as Node) && !(e.target as HTMLElement).closest('tr')) {
        storage.clearSelection();
      }
    }
    function handleContextMenu(e: MouseEvent) {
      if (objectListEl.contains(e.target as Node) && !(e.target as HTMLElement).closest('tr')) {
        storage.openEmptyContextMenu(e);
      }
    }
    document.addEventListener('click', handleClick);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  });
</script>

<svelte:window onkeydown={storage.handleKeydown} />

<div class="bg-base-100 flex flex-1 flex-col overflow-hidden">
  <TabBar {tabsState} />

  <StorageBreadcrumb />

  <div bind:this={objectListEl} class="relative min-h-0 flex-1 overflow-hidden">
    {#if storage.loading || storage.deleting || storage.archiveLoading || navigating.to}
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
