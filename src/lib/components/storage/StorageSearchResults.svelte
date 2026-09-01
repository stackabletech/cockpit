<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { SearchResult, SearchSession } from '$lib/storage/search.svelte.js';
  import { keyToName } from '$lib/storage/utils.js';
  import IconArrowUpward from 'virtual:icons/material-symbols/arrow-upward';
  import IconArrowDownward from 'virtual:icons/material-symbols/arrow-downward';
  import IconDescription from 'virtual:icons/material-symbols/description';
  import IconFolder from 'virtual:icons/material-symbols/folder';
  import IconUnfoldMore from 'virtual:icons/material-symbols/unfold-more';

  interface Props {
    session: SearchSession;
    onOpen: (result: SearchResult) => void;
  }

  let { session, onOpen }: Props = $props();

  type SortKey = 'name' | 'bucket' | 'size' | 'lastModified';
  type SortDir = 'asc' | 'desc';

  let sortKey = $state<SortKey>('name');
  let sortDir = $state<SortDir>('asc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      // Default direction: size → desc, everything else → asc
      sortDir = key === 'size' ? 'desc' : 'asc';
    }
  }

  function sortAria(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortKey !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  const sortedResults = $derived.by(() => {
    return [...session.results].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = a.key.localeCompare(b.key);
      } else if (sortKey === 'bucket') {
        cmp = a.bucket.localeCompare(b.bucket);
      } else if (sortKey === 'size') {
        cmp = a.size - b.size;
      } else {
        cmp = a.lastModified.getTime() - b.lastModified.getTime();
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });

  function formatSize(size: number): string {
    return `${(size / 1024 ** 2).toFixed(1)} MB`;
  }
</script>

{#snippet SortIcon(key: SortKey)}
  {#if sortKey === key}
    {#if sortDir === 'asc'}
      <IconArrowUpward class="size-3 shrink-0" aria-hidden="true" />
    {:else}
      <IconArrowDownward class="size-3 shrink-0" aria-hidden="true" />
    {/if}
  {:else}
    <IconUnfoldMore class="text-base-content/30 size-3 shrink-0" aria-hidden="true" />
  {/if}
{/snippet}

{#if session.status !== 'idle'}
  <section class="mt-4" aria-live="polite">
    <div class="text-base-content/60 mb-2 flex items-center justify-between gap-3 text-xs">
      <span
        >{session.status === 'running'
          ? m.storage_search_searching()
          : m.storage_search_results_elapsed({
              count: session.results.length,
              elapsed: session.elapsed
            })}</span
      >
      {#if session.status === 'running'}<span class="badge badge-warning badge-sm"
          >{m.storage_search_status_running()}</span
        >{:else if session.status === 'done'}<span class="badge badge-success badge-sm"
          >{m.storage_search_status_done()}</span
        >{:else}<span class="badge badge-error badge-sm">{m.storage_search_status_error()}</span
        >{/if}
    </div>
    {#if session.status === 'running'}<progress class="progress progress-primary w-full"
      ></progress>{/if}
    {#if session.status === 'error'}<p class="text-error text-sm" role="alert">
        {m.storage_search_error()}
      </p>{/if}
    {#if session.truncated}<p class="alert alert-warning mt-2 text-sm" role="alert">
        {m.storage_search_truncated()}
      </p>{/if}
    {#if session.status === 'done' && session.results.length === 0}<p
        class="text-base-content/50 py-8 text-center text-sm"
      >
        {m.storage_search_no_results()}
      </p>{/if}
    {#if session.results.length > 0}
      <div class="border-base-300 mt-2 max-h-64 overflow-auto rounded-lg border">
        <table class="table-xs table-pin-rows table">
          <thead
            ><tr
              ><th>{m.storage_search_result_type()}</th><th aria-sort={sortAria('name')}
                ><button
                  type="button"
                  class="flex cursor-pointer items-center gap-1 font-medium"
                  onclick={() => toggleSort('name')}
                  >{m.storage_header_name()}{@render SortIcon('name')}</button
                ></th
              ><th aria-sort={sortAria('bucket')}
                ><button
                  type="button"
                  class="flex cursor-pointer items-center gap-1 font-medium"
                  onclick={() => toggleSort('bucket')}
                  >{m.storage_search_scope_label()}{@render SortIcon('bucket')}</button
                ></th
              ><th aria-sort={sortAria('size')}
                ><button
                  type="button"
                  class="flex cursor-pointer items-center gap-1 font-medium"
                  onclick={() => toggleSort('size')}
                  >{m.storage_header_size()}{@render SortIcon('size')}</button
                ></th
              ><th aria-sort={sortAria('lastModified')}
                ><button
                  type="button"
                  class="flex cursor-pointer items-center gap-1 font-medium"
                  onclick={() => toggleSort('lastModified')}
                  >{m.storage_header_last_modified()}{@render SortIcon('lastModified')}</button
                ></th
              ></tr
            ></thead
          >
          <tbody
            >{#each sortedResults as result (result.bucket + result.key)}<tr
                class="group hover:bg-base-300 cursor-pointer [&_td]:cursor-pointer"
                onclick={() => onOpen(result)}
                ><td
                  >{#if result.isDirectory}<IconFolder
                      class="size-4"
                      aria-label={m.storage_folder()}
                    />{:else}<IconDescription
                      class="size-4"
                      aria-label={m.storage_file()}
                    />{/if}</td
                ><td
                  ><button
                    type="button"
                    class="text-left"
                    onclick={(event) => {
                      event.stopPropagation();
                      onOpen(result);
                    }}
                    ><span class="block font-mono font-medium">{keyToName(result.key)}</span><span
                      class="text-base-content/50 block font-mono text-xs">{result.key}</span
                    ></button
                  ></td
                ><td><span class="badge badge-ghost badge-sm font-mono">{result.bucket}</span></td
                ><td class="text-base-content/60 font-mono text-xs"
                  >{result.isDirectory ? '-' : formatSize(result.size)}</td
                ><td class="text-base-content/60 font-mono text-xs"
                  >{result.lastModified.toLocaleDateString()}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>
    {/if}
  </section>
{/if}
