<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import Modal from '$lib/components/Modal.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';
  import type { RecentSearchEntry, SearchResultItem } from '$lib/storage/types.js';
  import { keyToName } from '$lib/storage/utils.js';
  import { onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import IconArrowBack from 'virtual:icons/material-symbols/arrow-back';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconDescription from 'virtual:icons/material-symbols/description';
  import IconFolder from 'virtual:icons/material-symbols/folder';
  import IconSearch from 'virtual:icons/material-symbols/search';

  interface Props {
    currentBucket?: string;
  }

  let { currentBucket }: Props = $props();

  const uid = $props.id();
  const storage = getStorageState();

  let open = $state(false);
  let view = $state<'start' | 'results'>('start');
  let query = $state('');
  let scopeBucket = $state('');
  let history = $state.raw<RecentSearchEntry[]>([]);
  let showAllHistory = $state(false);
  let results = $state.raw<SearchResultItem[]>([]);
  let truncated = $state(false);
  let searching = $state(false);
  let error = $state(false);
  let searchController: AbortController | null = null;

  onDestroy(() => searchController?.abort());

  const visibleHistory = $derived(showAllHistory ? history : history.slice(0, 3));
  const canSubmit = $derived(Boolean(scopeBucket && query.trim()));

  $effect(() => {
    const controller = searchController;
    if (!open && controller) controller.abort();
    return () => {
      if (controller) controller.abort();
    };
  });

  function motionSafeSlide(node: Element, options: Parameters<typeof slide>[1]) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { duration: 0 };
    }
    return slide(node, options);
  }

  async function loadHistory(): Promise<void> {
    try {
      history = await storage.api.listRecentSearches();
    } catch {
      history = [];
    }
  }

  function openSearch(): void {
    searchController?.abort();
    view = 'start';
    query = '';
    scopeBucket = currentBucket ?? '';
    history = [];
    showAllHistory = false;
    results = [];
    truncated = false;
    searching = false;
    error = false;
    open = true;
    void loadHistory();
  }

  async function submitSearch(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    const trimmedQuery = query.trim();
    if (!scopeBucket || !trimmedQuery) return;

    searchController?.abort();
    error = false;
    searching = true;
    const controller = new AbortController();
    searchController = controller;

    try {
      try {
        await storage.api.recordRecentSearch({ bucket: scopeBucket, query: trimmedQuery });
        await loadHistory();
      } catch {
        // Search history is non-essential; continue with the requested search.
      }

      const response = await storage.api.search({
        bucket: scopeBucket,
        query: trimmedQuery,
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      results = response.results;
      truncated = response.truncated;
      view = 'results';
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      error = true;
    } finally {
      if (searchController === controller) {
        searching = false;
        searchController = null;
      }
    }
  }

  function repeatSearch(entry: RecentSearchEntry): void {
    scopeBucket = entry.bucket;
    query = entry.query;
    void submitSearch();
  }

  async function clearHistory(): Promise<void> {
    try {
      await storage.api.clearRecentSearches();
      history = [];
      showAllHistory = false;
    } catch {
      error = true;
    }
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

  function navigateTo(bucket: string, prefix: string): void {
    storage.archive.reset();
    open = false;
    void goto(locationUrl(bucket, prefix));
  }

  function openResult(result: SearchResultItem): void {
    if (result.isDirectory) {
      navigateTo(scopeBucket, result.key);
      return;
    }

    const parentPrefix = result.key.slice(0, result.key.lastIndexOf('/') + 1);
    storage.openModal('preview', { key: result.key, bucket: scopeBucket });
    navigateTo(scopeBucket, parentPrefix);
  }
</script>

<button
  type="button"
  class="btn btn-ghost btn-sm btn-square"
  aria-label={m.storage_search_open()}
  title={m.storage_search_open()}
  onclick={openSearch}
>
  <IconSearch class="size-5" aria-hidden="true" />
</button>

<Modal bind:open class="modal" aria-labelledby="{uid}-title">
  <div class="modal-box w-full max-w-2xl p-0">
    {#if view === 'start'}
      <div class="border-base-300 flex items-center justify-between gap-4 border-b px-5 py-4">
        <h2 id="{uid}-title" class="text-lg font-semibold">{m.storage_search_title()}</h2>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square"
          aria-label={m.storage_search_close()}
          title={m.storage_search_close()}
          onclick={() => (open = false)}
        >
          <IconClose class="size-5" aria-hidden="true" />
        </button>
      </div>

      <form class="flex flex-col gap-4 p-5" onsubmit={submitSearch}>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="{uid}-query" class="label text-sm font-medium">
              {m.storage_search_query_label()}
            </label>
            <input
              id="{uid}-query"
              class="input w-full"
              type="search"
              bind:value={query}
              placeholder={m.storage_search_query_placeholder()}
              autocomplete="off"
            />
          </div>
          <div>
            <label for="{uid}-scope" class="label text-sm font-medium">
              {m.storage_search_scope_label()}
            </label>
            <select id="{uid}-scope" class="select w-full" bind:value={scopeBucket}>
              <option value="">{m.storage_search_scope_placeholder()}</option>
              {#each storage.buckets as bucket (bucket)}
                <option value={bucket}>{bucket}</option>
              {/each}
            </select>
          </div>
        </div>

        {#if error}
          <p class="text-error text-sm" role="alert">{m.storage_search_error()}</p>
        {/if}

        <div class="flex justify-end">
          <button type="submit" class="btn btn-primary btn-sm" disabled={!canSubmit || searching}>
            {#if searching}
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            {/if}
            {m.storage_search_submit()}
          </button>
        </div>
      </form>

      <div class="border-base-300 border-t p-5">
        <div class="mb-2 flex items-center justify-between gap-3">
          <h3 class="font-medium">{m.storage_search_recent_heading()}</h3>
          {#if history.length > 0}
            <button type="button" class="btn btn-ghost btn-xs" onclick={clearHistory}>
              {m.storage_search_recent_clear()}
            </button>
          {/if}
        </div>
        {#if history.length === 0}
          <p class="text-base-content/60 text-sm">{m.storage_search_recent_empty()}</p>
        {:else}
          <div in:motionSafeSlide={{ duration: 150 }}>
            <ul class="menu gap-1 p-0">
              {#each visibleHistory as entry (entry.bucket + entry.query)}
                <li>
                  <button type="button" onclick={() => repeatSearch(entry)}>
                    <span class="truncate">{entry.query}</span>
                    <span class="text-base-content/60 text-xs">{entry.bucket}</span>
                  </button>
                </li>
              {/each}
            </ul>
            {#if history.length > 3}
              <button
                type="button"
                class="btn btn-ghost btn-xs mt-2"
                onclick={() => (showAllHistory = !showAllHistory)}
              >
                {showAllHistory
                  ? m.storage_search_recent_show_fewer()
                  : m.storage_search_recent_show_all()}
              </button>
            {/if}
          </div>
        {/if}
      </div>

      {#if storage.bookmarks.pinnedLocations.length > 0}
        <div class="border-base-300 border-t p-5">
          <h3 class="mb-2 font-medium">{m.storage_search_pinned_heading()}</h3>
          <ul class="menu gap-1 p-0">
            {#each storage.bookmarks.pinnedLocations as location (location.bucket + location.prefix)}
              <li>
                <button type="button" onclick={() => navigateTo(location.bucket, location.prefix)}>
                  <span class="truncate">{location.prefix || location.bucket}</span>
                  <span class="text-base-content/60 text-xs">{location.bucket}</span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="border-base-300 border-t p-5">
        <h3 class="mb-2 font-medium">{m.storage_search_bucket_heading()}</h3>
        <ul class="menu gap-1 p-0 sm:grid sm:grid-cols-2">
          {#each storage.buckets as bucket (bucket)}
            <li><button type="button" onclick={() => (scopeBucket = bucket)}>{bucket}</button></li>
          {/each}
        </ul>
      </div>
    {:else}
      <div class="border-base-300 flex items-center justify-between gap-4 border-b px-5 py-4">
        <div class="flex items-center gap-3">
          <button type="button" class="btn btn-ghost btn-sm gap-1" onclick={() => (view = 'start')}>
            <IconArrowBack class="size-5" aria-hidden="true" />
            {m.storage_search_back()}
          </button>
          <h2 id="{uid}-title" class="text-lg font-semibold">
            {m.storage_search_results_heading()}
          </h2>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square"
          aria-label={m.storage_search_close()}
          title={m.storage_search_close()}
          onclick={() => (open = false)}
        >
          <IconClose class="size-5" aria-hidden="true" />
        </button>
      </div>
      <div class="p-5">
        <p class="mb-3 text-sm" aria-live="polite">
          {m.storage_search_results_count({ count: results.length })}
        </p>
        {#if truncated}
          <p class="alert alert-warning mb-3 text-sm" role="alert">
            {m.storage_search_truncated()}
          </p>
        {/if}
        {#if results.length === 0}
          <p class="text-base-content/60 text-sm">{m.storage_search_no_results()}</p>
        {:else}
          <ul class="menu gap-1 p-0">
            {#each results as result (result.key)}
              {@const ResultIcon = result.isDirectory ? IconFolder : IconDescription}
              <li>
                <button type="button" class="items-start" onclick={() => openResult(result)}>
                  <ResultIcon class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <span class="min-w-0 text-left">
                    <span class="block truncate">{keyToName(result.key)}</span>
                    <span class="text-base-content/60 block truncate text-xs">
                      {scopeBucket}/{result.key}
                    </span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
</Modal>
