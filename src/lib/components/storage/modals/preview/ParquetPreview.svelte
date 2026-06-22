<script lang="ts">
  import { untrack, onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  interface Props {
    headers: string[];
    initialRows: unknown[][];
    totalRows?: number;

    fetchRows?: (
      offset: number,
      limit: number,
      onColumn?: (name: string, values: unknown[]) => void
    ) => Promise<unknown[][]>;
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

  // Calculate column widths once on load to prevent width shifts during scrolling
  let columnWidths = $state<number[]>([]);

  // Measure actual rendered text width using canvas for cross-browser consistency
  function textWidth(text: string): number {
    if (typeof document === 'undefined') return text.length * 7;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return text.length * 7;
    ctx.font =
      '600 12px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    return ctx.measureText(text).width;
  }

  // Sync initial data from parent into the virtual-scroll chunk system.
  // When initialRows changes (e.g. streaming NDJSON data arrived), replace chunk 0.
  function populateChunk0() {
    if (initialRows && initialRows.length > 0) {
      loadedChunks = { 0: initialRows };
      loadingChunks.clear();
      scrollTop = 0;
      // Scan initial data to determine max content width per column
      const CELL_PADDING = 16;
      const widths = headers.map((h) => textWidth(h));
      for (const row of initialRows) {
        if (!row) continue;
        for (let i = 0; i < headers.length; i++) {
          const val = row[i];
          const str = val !== null && val !== undefined ? String(val) : '';
          const w = textWidth(str);
          if (w > widths[i]) widths[i] = w;
        }
      }
      columnWidths = widths.map((w) => Math.max(w + CELL_PADDING, 80));
    }
  }

  onMount(populateChunk0);

  $effect(() => {
    if (initialRows && initialRows.length > 0) {
      untrack(() => {
        populateChunk0();
      });
    }
  });

  // Limit the scroll canvas to the highest loaded chunk PLUS a 10-row buffer.
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

    const currentStart = startIndex;
    const currentEnd = endIndex;

    const startChunk = Math.floor(currentStart / CHUNK_SIZE);
    const endChunk = Math.floor(currentEnd / CHUNK_SIZE);

    untrack(() => {
      for (let c = startChunk; c <= endChunk; c++) {
        if (!loadedChunks[c] && !loadingChunks.has(c)) {
          loadingChunks.add(c);

          // Initialize chunk with empty placeholder rows (undefined = not loaded yet)
          const placeholder = Array.from({ length: CHUNK_SIZE }, () =>
            new Array(headers.length).fill(undefined)
          );
          loadedChunks[c] = placeholder;

           
          fetchRows(
            c * CHUNK_SIZE,
            CHUNK_SIZE,
            (() => {
              // Track per-column position within this chunk because hyparquet
              // may split column data across multiple messages.
              const colPos: Record<string, number> = {};
              return (name: string, values: unknown[]) => {
                const colIdx = headers.indexOf(name);
                if (colIdx < 0) return;
                const chunk = loadedChunks[c];
                if (!chunk) return;
                let pos = colPos[name] ?? 0;
                for (let i = 0; i < values.length && pos < chunk.length; i++) {
                  if (chunk[pos]) chunk[pos][colIdx] = values[i];
                  pos++;
                }
                colPos[name] = pos;
                // Create new reference so Svelte detects the update immediately
                loadedChunks = { ...loadedChunks };
              };
            })()
          )
            .then((data) => {
              loadingChunks.delete(c);
              // Replace placeholder with fully populated data
              loadedChunks = { ...loadedChunks, [c]: data };
            })
            .catch(() => {
              loadingChunks.delete(c);
              const next = { ...loadedChunks };
              delete next[c];
              loadedChunks = next;
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
      <table class="table-xs table table-fixed" aria-label="Parquet preview">
        <thead class="bg-base-200 text-base-content/60 sticky top-0 z-10 text-xs shadow-sm">
          <tr>
            <th class="text-base-content/30 w-10 text-right font-normal"></th>
            {#each headers as header, j (header)}
              <th
                class="truncate font-semibold"
                style={columnWidths.length > 0 ? `width: ${columnWidths[j]}px` : ''}>{header}</th
              >
            {/each}
          </tr>
        </thead>
        <tbody>
          <!-- Top Spacer -->
          {#if paddingTop > 0}
            <tr style="height: {paddingTop}px;">
              <td colspan={headers.length + 1} class="border-0 p-0"></td>
            </tr>
          {/if}

          <!-- Visible Rows & Skeletons -->
          {#each visibleRows as row (row.index)}
            <tr class="hover:bg-base-200 h-8 transition-colors">
              <td class="text-base-content/30 w-10 pr-1 text-right text-xs select-none"
                >{(row.index + 1).toLocaleString(getLocale())}</td
              >
              {#if row.data !== null && row.data !== undefined}
                <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
                {#each headers as _h, j (j)}
                  {#if row.data[j] !== undefined}
                    <td class="text-base-content/80 truncate text-xs">
                      {row.data[j] !== null ? String(row.data[j]) : ''}
                    </td>
                  {:else}
                    <td class="p-1">
                      <div class="bg-base-300/40 h-4 w-full animate-pulse rounded"></div>
                    </td>
                  {/if}
                {/each}
              {:else}
                <!-- Skeleton State (full row not yet initialized) -->
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
              <td colspan={headers.length + 1} class="border-0 p-0"></td>
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
