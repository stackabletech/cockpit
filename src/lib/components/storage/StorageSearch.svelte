<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import Modal from '$lib/components/Modal.svelte';
  import StorageSearchForm from '$lib/components/storage/StorageSearchForm.svelte';
  import StorageSearchHistory from '$lib/components/storage/StorageSearchHistory.svelte';
  import StorageSearchResults from '$lib/components/storage/StorageSearchResults.svelte';
  import StorageSearchSessions from '$lib/components/storage/StorageSearchSessions.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { StorageSearchState, type SearchResult } from '$lib/storage/search.svelte.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { RecentSearchEntry } from '$lib/storage/types.js';
  import IconAdd from 'virtual:icons/material-symbols/add';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconHistory from 'virtual:icons/material-symbols/history';
  import IconSearch from 'virtual:icons/material-symbols/search';

  interface Props {
    currentBucket?: string;
  }

  const uid = $props.id();
  const storage = getStorageState();
  let { currentBucket }: Props = $props();
  let open = $state(false);
  let view = $state<'search' | 'recent'>('search');
  const search = new StorageSearchState({
    api: storage.api,
    getBuckets: () => storage.buckets,
    getCurrentBucket: () => currentBucket
  });

  function openSearch(): void {
    view = 'search';
    open = true;
    void search.open();
  }

  function closeSearch(): void {
    search.close();
    open = false;
  }

  function useRecentEntry(entry: RecentSearchEntry, buckets?: string[]): void {
    search.useRecentEntry(entry, buckets);
    view = 'search';
  }

  function locationUrl(bucket: string, prefix: string): string {
    const encodedPrefix = prefix
      ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';
    return resolve('/(app)/storage/[bucket]/[...prefix]', {
      bucket: encodeURIComponent(bucket),
      prefix: encodedPrefix
    });
  }

  function openResult(result: SearchResult): void {
    const prefix = result.isDirectory
      ? result.key
      : result.key.slice(0, result.key.lastIndexOf('/') + 1);
    if (!result.isDirectory)
      storage.openModal('preview', { key: result.key, bucket: result.bucket });
    closeSearch();
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- path is built with resolve() in locationUrl()
    void goto(locationUrl(result.bucket, prefix));
  }

  function handleKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
    if (open && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 't') {
      event.preventDefault();
      search.addSession();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<button
  type="button"
  class="btn btn-ghost btn-xs gap-1"
  aria-label={m.storage_search_open()}
  title={m.storage_search_open()}
  onclick={openSearch}
  ><IconSearch class="size-3.5" aria-hidden="true" />{m.storage_search_open()}</button
>

<Modal bind:open class="modal modal-top-search" aria-labelledby="{uid}-title">
  <div
    class="modal-box bg-base-200 flex max-h-[90vh] w-11/12 max-w-4xl flex-col overflow-hidden p-0"
  >
    <header
      class="border-base-300 bg-base-300/50 flex items-center justify-between gap-3 border-b px-5 py-3"
    >
      <div class="flex items-center gap-3">
        <h2 id="{uid}-title" class="text-sm font-semibold">{m.storage_search_title()}</h2>
        {#if search.runningCount > 0}<span class="badge badge-warning badge-sm gap-1"
            ><span class="loading loading-spinner loading-xs" aria-hidden="true"
            ></span>{m.storage_search_running({ count: search.runningCount })}</span
          >{:else if search.completedCount > 0}<span class="badge badge-success badge-sm"
            >{m.storage_search_completed({ count: search.completedCount })}</span
          >{/if}
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          title={m.storage_search_add_session()}
          onclick={() => search.addSession()}
          ><IconAdd class="size-4" aria-hidden="true" />{m.storage_search_add_session()}</button
        ><button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          aria-label={m.storage_search_close()}
          title={m.storage_search_close()}
          onclick={closeSearch}><IconClose class="size-4" aria-hidden="true" /></button
        >
      </div>
    </header>
    <div
      role="tablist"
      class="tabs border-base-300 tabs-border bg-base-300/30 mb-0 px-5"
      aria-label={m.storage_search_view_label()}
    >
      <button
        type="button"
        role="tab"
        class="tab gap-1 {view === 'search' ? 'tab-active' : ''}"
        aria-selected={view === 'search'}
        onclick={() => (view = 'search')}
        ><IconSearch class="size-3.5" aria-hidden="true" />{m.storage_search_tab_search()}</button
      ><button
        type="button"
        role="tab"
        class="tab gap-1 {view === 'recent' ? 'tab-active' : ''}"
        aria-selected={view === 'recent'}
        onclick={() => (view = 'recent')}
        ><IconHistory class="size-3.5" aria-hidden="true" />{m.storage_search_tab_recent()}</button
      >
    </div>
    {#if view === 'search'}
      <StorageSearchSessions
        sessions={search.sessions}
        activeId={search.activeId}
        onSelect={(id) => (search.activeId = id)}
        onRemove={(id) => search.removeSession(id)}
      />
    {/if}
    <div class="flex-1 overflow-y-auto p-5">
      {#if view === 'recent'}
        <StorageSearchHistory
          entries={search.history}
          onUse={useRecentEntry}
          onClear={() => void search.clearHistory()}
        />
      {:else if search.active}
        <StorageSearchForm
          id={uid}
          session={search.active}
          buckets={storage.buckets}
          state={search}
        /><StorageSearchResults session={search.active} onOpen={openResult} />
      {/if}
    </div>
    <footer
      class="border-base-300 bg-base-300/30 text-base-content/50 flex flex-wrap gap-x-4 gap-y-1 border-t px-5 py-2 text-xs"
      aria-label={m.storage_search_keyboard_hint()}
    >
      <span class="flex items-center gap-1">
        <kbd class="kbd kbd-xs">{m.storage_search_key_enter()}</kbd
        >{m.storage_search_shortcut_search()}
      </span>
      <span class="flex items-center gap-1"
        ><kbd class="kbd kbd-xs">{m.storage_search_key_escape()}</kbd
        >{m.storage_search_shortcut_close()}</span
      >
    </footer>
  </div>
</Modal>
