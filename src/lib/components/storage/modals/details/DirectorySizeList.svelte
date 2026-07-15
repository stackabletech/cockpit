<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { formatFileSize } from '$lib/storage/utils.js';
  import type { DirectoryChildItem } from '$lib/storage/details-types.js';
  import TimestampDisplay from '$lib/components/storage/shared/TimestampDisplay.svelte';
  import IconFolder from 'virtual:icons/material-symbols/folder';
  import IconDescription from 'virtual:icons/material-symbols/description';
  import IconArrowUpward from 'virtual:icons/material-symbols/arrow-upward';
  import IconArrowDownward from 'virtual:icons/material-symbols/arrow-downward';
  import IconUnfoldMore from 'virtual:icons/material-symbols/unfold-more';

  interface Props {
    items: DirectoryChildItem[];
  }

  let { items }: Props = $props();

  type SortKey = 'name' | 'size' | 'lastModified';
  type SortDir = 'asc' | 'desc';

  let sortKey = $state<SortKey>('size');
  let sortDir = $state<SortDir>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      // Default direction: size → desc, name/date → asc
      sortDir = key === 'size' ? 'desc' : 'asc';
    }
  }

  const sortedItems = $derived.by(() => {
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortKey === 'size') {
        cmp = a.size - b.size;
      } else {
        const da = a.lastModified ? new Date(a.lastModified).getTime() : 0;
        const db = b.lastModified ? new Date(b.lastModified).getTime() : 0;
        cmp = da - db;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });
</script>

<div class="overflow-x-auto">
  <table class="table-xs table">
    <thead>
      <tr>
        <th class="w-6" aria-hidden="true"></th>
        <th
          aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
          <button
            class="flex cursor-pointer items-center gap-1 font-medium"
            onclick={() => toggleSort('name')}
          >
            {m.storage_details_name()}
            {#if sortKey === 'name'}
              {#if sortDir === 'asc'}
                <IconArrowUpward class="size-3 shrink-0" aria-hidden="true" />
              {:else}
                <IconArrowDownward class="size-3 shrink-0" aria-hidden="true" />
              {/if}
            {:else}
              <IconUnfoldMore class="text-base-content/30 size-3 shrink-0" aria-hidden="true" />
            {/if}
          </button>
        </th>
        <th
          class="text-right"
          aria-sort={sortKey === 'size' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
          <button
            class="flex cursor-pointer items-center justify-end gap-1 font-medium"
            onclick={() => toggleSort('size')}
          >
            {m.storage_details_size()}
            {#if sortKey === 'size'}
              {#if sortDir === 'asc'}
                <IconArrowUpward class="size-3 shrink-0" aria-hidden="true" />
              {:else}
                <IconArrowDownward class="size-3 shrink-0" aria-hidden="true" />
              {/if}
            {:else}
              <IconUnfoldMore class="text-base-content/30 size-3 shrink-0" aria-hidden="true" />
            {/if}
          </button>
        </th>
        <th
          aria-sort={sortKey === 'lastModified'
            ? sortDir === 'asc'
              ? 'ascending'
              : 'descending'
            : 'none'}
        >
          <button
            class="flex cursor-pointer items-center gap-1 font-medium"
            onclick={() => toggleSort('lastModified')}
          >
            {m.storage_details_last_modified()}
            {#if sortKey === 'lastModified'}
              {#if sortDir === 'asc'}
                <IconArrowUpward class="size-3 shrink-0" aria-hidden="true" />
              {:else}
                <IconArrowDownward class="size-3 shrink-0" aria-hidden="true" />
              {/if}
            {:else}
              <IconUnfoldMore class="text-base-content/30 size-3 shrink-0" aria-hidden="true" />
            {/if}
          </button>
        </th>
      </tr>
    </thead>
    <tbody>
      {#each sortedItems as item (item.name)}
        <tr class="hover:bg-base-200/50">
          <td class="text-base-content/50 p-1" aria-hidden="true">
            {#if item.isDirectory}
              <IconFolder class="text-warning size-4" />
            {:else}
              <IconDescription class="text-base-content/50 size-4" />
            {/if}
          </td>
          <td class="font-mono text-sm">
            {item.name}
          </td>
          <td class="text-right font-mono text-sm tabular-nums">
            {formatFileSize(item.size)}
          </td>
          <td class="text-sm">
            {#if item.lastModified}
              <TimestampDisplay date={item.lastModified} tooltip="tooltip-left" />
            {:else}
              <span class="text-base-content/40">—</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
