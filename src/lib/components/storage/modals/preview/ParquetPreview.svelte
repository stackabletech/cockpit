<script lang="ts">
  import { untrack } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  interface Props {
    headers: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialRows: any[][];
    totalRows?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchRows?: (offset: number, limit: number) => Promise<any[][]>;
    showingRowsCount?: number;
  }

  let {
    headers,
    initialRows,
    totalRows = 0,
    fetchRows,
    showingRowsCount = $bindable(0)
  }: Props = $props();

  const CHUNK_SIZE = 250; // magic number: rows to display
  const ROW_HEIGHT = 32; // Exact height of table-xs (h-8)

  let containerHeight = $state(400);
  let scrollTop = $state(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loadedChunks = $state<Record<number, any[][]>>({});
  let loadingChunks = $state<Set<number>>(new Set());

  $effect(() => {
    if (initialRows && initialRows.length > 0) {
      untrack(() => {
        loadedChunks = { 0: initialRows };
        loadingChunks.clear();
        scrollTop = 0;
      });
    }
  });

  // Limit the scroll canvas to the highest loaded chunk PLUS a 10-row buffer.
  // The canvas only extends once chunks finish loading, not during fetch.
  let highestLoadedChunk = $derived.by(() => {
    const keys = Object.keys(loadedChunks).map(Number);
    if (keys.length === 0) return 0;
    return Math.max(...keys);
  });
  let virtualTotalRows = $derived(Math.min(totalRows, (highestLoadedChunk + 1) * CHUNK_SIZE + 10));

  let startIndex = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5));
  let endIndex = $derived(
    Math.min(virtualTotalRows, Math.floor((scrollTop + containerHeight) / ROW_HEIGHT) + 15)
  );

  let paddingTop = $derived(startIndex * ROW_HEIGHT);
  let paddingBottom = $derived(Math.max(0, (virtualTotalRows - endIndex) * ROW_HEIGHT));

  // purely computes visual logic, no side-effects here
  let visibleRows = $derived.by(() => {
    const rowsToRender = [];
    for (let i = startIndex; i < endIndex; i++) {
      const chunkIdx = Math.floor(i / CHUNK_SIZE);
      const chunkOffset = i % CHUNK_SIZE;
      const chunk = loadedChunks[chunkIdx];

      if (chunk && chunk[chunkOffset] !== undefined) {
        rowsToRender.push({ index: i, data: chunk[chunkOffset] });
      } else {
        rowsToRender.push({ index: i, data: null }); // Render Skeleton
      }
    }
    return rowsToRender;
  });

  // Monitor scroll boundaries to safely trigger background chunk fetching
  $effect(() => {
    if (!fetchRows) return;

    // Track state to trigger effect dependencies
    const currentStart = startIndex;
    const currentEnd = endIndex;

    const startChunk = Math.floor(currentStart / CHUNK_SIZE);
    const endChunk = Math.floor(currentEnd / CHUNK_SIZE);

    // Run updates without creating reactivity feedback loops
    untrack(() => {
      for (let c = startChunk; c <= endChunk; c++) {
        if (!loadedChunks[c] && !loadingChunks.has(c)) {
          loadingChunks.add(c);

          fetchRows(c * CHUNK_SIZE, CHUNK_SIZE)
            .then((data) => {
              loadedChunks[c] = data; // Triggers Svelte 5 Proxy Reactivity
            })
            .catch(() => {
              loadingChunks.delete(c);
            });
        }
      }
    });
  });

  const loadedRowsCount = $derived(Object.keys(loadedChunks).length * CHUNK_SIZE);
  const isTruncated = $derived(totalRows > loadedRowsCount);
  const formattedLoadedRowsCount = $derived(loadedRowsCount.toLocaleString(getLocale()));
  const formattedTotalRows = $derived(totalRows.toLocaleString(getLocale()));

  $effect(() => {
    showingRowsCount = loadedRowsCount;
  });
</script>

<div class="relative flex h-full flex-col">
  {#if headers.length === 0}
    <p class="text-base-content/50 p-4 text-sm italic">{m.storage_bucket_empty()}</p>
  {:else}
    <!-- eslint-disable-next-line svelte/valid-compile -->
    <div
      class="min-h-0 w-full flex-1 overflow-auto"
      bind:clientHeight={containerHeight}
      onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
    >
      <table class="table-xs table w-full min-w-max" aria-label="Parquet preview">
        <thead class="bg-base-200 text-base-content/60 sticky top-0 z-10 text-xs shadow-sm">
          <tr>
            {#each headers as header (header)}
              <th class="font-semibold whitespace-nowrap">{header}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          <!-- Top Spacer -->
          {#if paddingTop > 0}
            <tr style="height: {paddingTop}px;">
              <td colspan={headers.length} class="border-0 p-0"></td>
            </tr>
          {/if}

          <!-- Visible Rows & Skeletons -->
          {#each visibleRows as row (row.index)}
            <tr class="hover:bg-base-200 h-8 transition-colors">
              {#if row.data}
                <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
                {#each headers as _h, j (j)}
                  <td class="text-base-content/80 max-w-xs truncate text-xs">
                    {row.data[j] !== null && row.data[j] !== undefined ? String(row.data[j]) : ''}
                  </td>
                {/each}
              {:else}
                <!-- Skeleton State -->
                <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
                {#each headers as _h, j (j)}
                  <td class="p-1">
                    <div class="bg-base-300/40 h-4 w-full animate-pulse rounded"></div>
                  </td>
                {/each}
              {/if}
            </tr>
          {/each}

          <!-- Bottom Spacer -->
          {#if paddingBottom > 0}
            <tr style="height: {paddingBottom}px;">
              <td colspan={headers.length} class="border-0 p-0"></td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>

    {#if isTruncated}
      <p class="text-base-content/50 px-4 py-2 text-xs italic">
        {m.storage_preview_parquet_rows
          ? m.storage_preview_parquet_rows({
              count: formattedLoadedRowsCount,
              total: formattedTotalRows
            })
          : `Showing ${formattedLoadedRowsCount} of ${formattedTotalRows} rows. Scroll to load more.`}
      </p>
    {/if}
  {/if}
</div>
