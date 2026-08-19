<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import Modal from '$lib/components/Modal.svelte';
  import StorageSearchForm from '$lib/components/storage/StorageSearchForm.svelte';
  import StorageSearchResults from '$lib/components/storage/StorageSearchResults.svelte';
  import StorageSearchSessions from '$lib/components/storage/StorageSearchSessions.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { StorageSearchState, type SearchResult } from '$lib/storage/search.svelte.js';
  import { getStorageState } from '$lib/storage/context.js';
  import IconAdd from 'virtual:icons/material-symbols/add';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconSearch from 'virtual:icons/material-symbols/search';

  interface Props {
    currentBucket?: string;
  }

  const uid = $props.id();
  const storage = getStorageState();
  let { currentBucket }: Props = $props();
  let open = $state(false);
  const search = new StorageSearchState({
    api: storage.api,
    getBuckets: () => storage.buckets,
    getCurrentBucket: () => currentBucket
  });

  function closeSearch(): void {
    search.close();
    open = false;
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
    void goto(locationUrl(result.bucket, prefix));
  }

  function handleKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open = true;
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
  title={`${m.storage_search_open()} (${m.storage_search_key_control()} + ${m.storage_search_key_k()})`}
  onclick={() => (open = true)}
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
    <StorageSearchSessions
      sessions={search.sessions}
      activeId={search.activeId}
      onSelect={(id) => (search.activeId = id)}
      onRemove={(id) => search.removeSession(id)}
    />
    {#if search.active}<div class="flex-1 overflow-y-auto p-5">
        <StorageSearchForm
          id={uid}
          session={search.active}
          buckets={storage.buckets}
          state={search}
        /><StorageSearchResults session={search.active} onOpen={openResult} />
      </div>{/if}
    <footer
      class="border-base-300 bg-base-300/30 text-base-content/50 flex flex-wrap gap-x-4 gap-y-1 border-t px-5 py-2 text-xs"
      aria-label={m.storage_search_keyboard_hint()}
    >
      <span class="flex items-center gap-1">
        <kbd class="kbd kbd-xs">{m.storage_search_key_enter()}</kbd
        >{m.storage_search_shortcut_search()}
      </span>
      <span class="flex items-center gap-1">
        <kbd class="kbd kbd-xs">{m.storage_search_key_control()}</kbd>+<kbd class="kbd kbd-xs"
          >{m.storage_search_key_t()}</kbd
        >{m.storage_search_shortcut_new_session()}
      </span>
      <span class="flex items-center gap-1">
        <kbd class="kbd kbd-xs">{m.storage_search_key_escape()}</kbd
        >{m.storage_search_shortcut_close()}</span
      >
    </footer>
  </div>
</Modal>
