<script lang="ts">
  import { untrack } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    headers: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialRows: any[][];
    totalRows?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchRows?: (offset: number, limit: number) => Promise<any[][]>;
  }

  let { headers, initialRows, totalRows = 0, fetchRows }: Props = $props();

  const CHUNK_SIZE = 250; // magic number: rows to display
  const ROW_HEIGHT = 32; // Exact height of table-xs (h-8)

  let containerHeight = $state(400);
  let scrollTop = $state(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loadedChunks = $state<Record<number, any[][]>>({});
  let loadingChunks = $state<Set<number>>(new Set());

  // Track how deep the user has scrolled to push the "bottom padding" down dynamically
  let highestRequestedChunk = $state(0);

  $effect(() => {
    if (initialRows && initialRows.length > 0) {
      untrack(() => {
        loadedChunks = { 0: initialRows };
        loadingChunks.clear();
        highestRequestedChunk = 0;
        scrollTop = 0;
      });
    }
  });

  // Limit the scroll canvas to the chunks the user has explored PLUS a 1-chunk buffer.
  // This causes the scrollbar to expand automatically as they scroll downwards.
  let virtualTotalRows = $derived(
    Math.min(totalRows, (highestRequestedChunk + 1) * CHUNK_SIZE + 10) // 10 extra empty rows as buffer to trigger loading
  );

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
          highestRequestedChunk = Math.max(highestRequestedChunk, c);

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
</script>

<div class="relative flex h-full flex-col">
  {#if headers.length === 0}
    <p class="text-base-content/50 p-4 text-sm italic">{m.storage_bucket_empty()}</p>
  {:else}
    <!-- eslint-disable-next-line svelte/valid-compile -->
    <div
      class="max-h-[60vh] w-full overflow-auto"
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
          ? m.storage_preview_parquet_rows({ count: loadedRowsCount, total: totalRows })
          : `Showing ${Math.min(totalRows, loadedRowsCount).toLocaleString()} rows of ${totalRows.toLocaleString()}. Scroll to load more.`}
      </p>
    {/if}
  {/if}
</div>
