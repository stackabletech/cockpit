<script lang="ts">
  import Papa from 'papaparse';
  import { untrack, onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  const MAX_ROWS = 250;

  interface Props {
    text?: string;
    headers?: string[];
    initialRows?: unknown[][];
    totalRows?: number;
    fetchRows?: (offset: number, limit: number) => Promise<unknown[][]>;
    showingRowsCount?: number;
    hidden?: boolean;
  }

  let {
    text = '',
    headers = [],
    initialRows = [],
    totalRows = 0,
    fetchRows,
    showingRowsCount = $bindable(0),
    hidden = false
  }: Props = $props();

  const isLegacyMode = $derived(text !== '' && headers.length === 0);
  const isSimpleMode = $derived(!isLegacyMode && !fetchRows && headers.length > 0);

  // ── Legacy mode: text-based CSV rendered via PapaParse ──

  const {
    headers: textHeaders,
    rows: textRows,
    truncated: textTruncated
  } = $derived.by(() => {
    if (!isLegacyMode) return { headers: [] as string[], rows: [] as string[][], truncated: false };
    const result = Papa.parse(text, {
      preview: MAX_ROWS + 1,
      header: false,
      skipEmptyLines: true
    });
    if (result.data.length === 0) return { headers: [], rows: [], truncated: false };
    const [hdrs, ...data] = result.data as string[][];
    const truncatedCheck = Papa.parse(text, { skipEmptyLines: true }).data.length > MAX_ROWS + 1;
    return { headers: hdrs, rows: data, truncated: truncatedCheck };
  });

  // ── Virtual scroll mode: chunked data loading ──

  const CHUNK_SIZE = 250;
  const ROW_HEIGHT = 32;

  let containerHeight = $state(400);
  let scrollTop = $state(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loadedChunks = $state<Record<number, any[][]>>({});
  let loadingChunks = $state<Set<number>>(new Set());

  let columnWidths = $state<number[]>([]);
  let containerWidth = $state(800);
  let scrollLeft = $state(0);

  function textWidth(text: string): number {
    if (typeof document === 'undefined') return text.length * 7;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return text.length * 7;
    ctx.font =
      '600 12px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    return ctx.measureText(text).width;
  }

  function populateChunk0() {
    if (initialRows && initialRows.length > 0) {
      loadedChunks = { 0: initialRows };
      loadingChunks.clear();
      scrollTop = 0;
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

  const LINE_NUM_WIDTH = 40;
  const COL_BUFFER = 3;

  function sumColWidths(from: number, to: number): number {
    if (columnWidths.length === 0) {
      const clampedFrom = Math.max(0, Math.min(from, headers.length));
      const clampedTo = Math.max(clampedFrom, Math.min(to, headers.length));
      return (clampedTo - clampedFrom) * 120;
    }
    let s = 0;
    for (let i = from; i < to && i < columnWidths.length; i++) {
      s += columnWidths[i] || 80;
    }
    return s;
  }

  function findDataColIndex(scrollPos: number): number {
    if (scrollPos <= LINE_NUM_WIDTH) return 0;
    if (columnWidths.length === 0) {
      return Math.max(0, Math.floor((scrollPos - LINE_NUM_WIDTH) / 120));
    }
    let offset = LINE_NUM_WIDTH;
    for (let i = 0; i < columnWidths.length; i++) {
      const w = columnWidths[i] || 80;
      if (scrollPos < offset + w) return i;
      offset += w;
    }
    return columnWidths.length;
  }

  let totalTableWidth = $derived(
    isLegacyMode || isSimpleMode ? 0 : LINE_NUM_WIDTH + sumColWidths(0, headers.length)
  );

  let colStartIndex = $derived.by(() => {
    if (isLegacyMode || isSimpleMode) return 0;
    const idx = findDataColIndex(scrollLeft);
    return Math.max(0, Math.min(idx - COL_BUFFER, headers.length - 1));
  });

  let colEndIndex = $derived.by(() => {
    if (isLegacyMode || isSimpleMode) return headers.length;
    const idx = findDataColIndex(scrollLeft + containerWidth);
    return Math.min(headers.length, idx + 1 + COL_BUFFER);
  });

  let leftPadWidth = $derived(isLegacyMode || isSimpleMode ? 0 : sumColWidths(0, colStartIndex));

  let rightPadWidth = $derived(
    isLegacyMode || isSimpleMode ? 0 : sumColWidths(colEndIndex, headers.length)
  );

  let totalCellCount = $derived(
    isLegacyMode || isSimpleMode
      ? headers.length + 1
      : 1 + (colEndIndex - colStartIndex) + (leftPadWidth > 0 ? 1 : 0) + (rightPadWidth > 0 ? 1 : 0)
  );

  onMount(() => {
    if (!isLegacyMode && !isSimpleMode) populateChunk0();
  });

  $effect(() => {
    if (isLegacyMode || isSimpleMode) return;
    if (initialRows && initialRows.length > 0 && !hidden) {
      untrack(() => {
        populateChunk0();
      });
    }
  });

  let highestLoadedChunk = $derived.by(() => {
    if (isLegacyMode || isSimpleMode) return 0;
    const keys = Object.keys(loadedChunks).map(Number);
    if (keys.length === 0) return 0;
    return Math.max(...keys);
  });
  let virtualTotalRows = $derived(
    isLegacyMode || isSimpleMode
      ? 0
      : Math.min(totalRows, (highestLoadedChunk + 1) * CHUNK_SIZE + 10)
  );

  let startIndex = $derived(
    isLegacyMode || isSimpleMode ? 0 : Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5)
  );
  let endIndex = $derived(
    isLegacyMode || isSimpleMode
      ? 0
      : Math.min(virtualTotalRows, Math.floor((scrollTop + containerHeight) / ROW_HEIGHT) + 15)
  );

  let visibleRows = $derived.by(() => {
    if (isLegacyMode || isSimpleMode) return [];
    const rowsToRender: { index: number; data: unknown[] | null }[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      const chunkIdx = Math.floor(i / CHUNK_SIZE);
      const chunkOffset = i % CHUNK_SIZE;
      const chunk = loadedChunks[chunkIdx];
      if (chunk && chunk[chunkOffset] !== undefined) {
        rowsToRender.push({ index: i, data: chunk[chunkOffset] });
      } else {
        rowsToRender.push({ index: i, data: null });
      }
    }
    return rowsToRender;
  });

  $effect(() => {
    if (isLegacyMode || isSimpleMode || !fetchRows || hidden) return;

    const startChunk = Math.floor(startIndex / CHUNK_SIZE);
    const endChunk = Math.floor(endIndex / CHUNK_SIZE);

    untrack(() => {
      for (let c = startChunk; c <= endChunk; c++) {
        if (!loadedChunks[c] && !loadingChunks.has(c)) {
          loadingChunks.add(c);
          const placeholder = Array.from({ length: CHUNK_SIZE }, () =>
            new Array(headers.length).fill(undefined)
          );
          loadedChunks[c] = placeholder;
          fetchRows(c * CHUNK_SIZE, CHUNK_SIZE)
            .then((data) => {
              loadingChunks.delete(c);
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

  const loadedRowsCount = $derived(
    isLegacyMode || isSimpleMode ? 0 : Object.keys(loadedChunks).length * CHUNK_SIZE
  );
  const isTruncated = $derived(
    isLegacyMode
      ? textTruncated
      : isSimpleMode
        ? totalRows > initialRows.length
        : totalRows > loadedRowsCount
  );
  const formattedLoadedRowsCount = $derived(loadedRowsCount.toLocaleString(getLocale()));
  const formattedTotalRows = $derived(totalRows.toLocaleString(getLocale()));

  $effect(() => {
    if (!isLegacyMode && !isSimpleMode) {
      showingRowsCount = loadedRowsCount;
    }
  });

  const uid = $props.id();
</script>

{#if isLegacyMode}
  <div>
    {#if textHeaders.length === 0}
      <p class="text-base-content/50 p-4 text-sm italic">{m.storage_bucket_empty()}</p>
    {:else}
      <table class="table-xs table min-w-max" aria-label="CSV preview">
        <thead>
          <tr class="bg-base-200 text-base-content/60 sticky top-0 z-10 text-xs">
            <th class="text-base-content/30 w-10 text-right font-normal" id="{uid}-line-hdr"></th>
            {#each textHeaders as header, i (i)}
              <th class="font-semibold whitespace-nowrap">{header}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each textRows as row, i (i)}
            <tr class="hover:bg-base-200 transition-colors">
              <td class="text-base-content/30 w-10 pr-1 text-right text-xs select-none"
                >{(i + 1).toLocaleString()}</td
              >
              <!--eslint-disable-next-line @typescript-eslint/no-unused-vars-->
              {#each textHeaders as _h, j (j)}
                <td class="text-base-content/80 max-w-xs truncate text-xs">{row[j] ?? ''}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if textTruncated}
        <p class="text-base-content/50 px-4 py-2 text-xs italic">
          {m.storage_preview_csv_rows({ count: textRows.length })}
        </p>
      {/if}
    {/if}
  </div>
{:else if isSimpleMode}
  <div class="relative flex h-full flex-col">
    {#if headers.length === 0}
      <p class="text-base-content/50 p-4 text-sm italic">{m.storage_bucket_empty()}</p>
    {:else}
      <div class="min-h-0 w-full flex-1 overflow-auto">
        <table class="table-xs table min-w-max" aria-label="CSV preview">
          <thead class="bg-base-200 text-base-content/60 sticky top-0 z-10 text-xs shadow-sm">
            <tr>
              <th class="text-base-content/30 w-10 text-right font-normal"></th>
              {#each headers as header (header)}
                <th class="truncate font-semibold whitespace-nowrap">{header}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each initialRows as row, i (i)}
              <tr class="hover:bg-base-200 h-8 transition-colors">
                <td class="text-base-content/30 w-10 pr-1 text-right text-xs select-none"
                  >{(i + 1).toLocaleString(getLocale())}</td
                >
                <!--eslint-disable-next-line @typescript-eslint/no-unused-vars-->
                {#each headers as _h, j (j)}
                  <td class="text-base-content/80 max-w-xs truncate text-xs"
                    >{row[j] !== null && row[j] !== undefined ? String(row[j]) : ''}</td
                  >
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if isTruncated}
        <p class="text-base-content/50 px-4 py-2 text-xs italic">
          {m.storage_preview_infinite_scroll_disabled
            ? m.storage_preview_infinite_scroll_disabled()
            : `This is the end of the preview. Download the full file or ask the administrator to enable infinite scrolling to load more rows in this preview.`}
        </p>
      {/if}
    {/if}
  </div>
{:else}
  <div class="relative flex h-full flex-col">
    {#if headers.length === 0}
      <p class="text-base-content/50 p-4 text-sm italic">{m.storage_bucket_empty()}</p>
    {:else}
      <div
        class="min-h-0 w-full flex-1 overflow-auto"
        bind:clientHeight={containerHeight}
        bind:clientWidth={containerWidth}
        onscroll={(e) => {
          scrollTop = e.currentTarget.scrollTop;
          scrollLeft = e.currentTarget.scrollLeft;
        }}
      >
        <table
          class="table-xs table table-fixed"
          style={totalTableWidth > 0 ? `width: ${totalTableWidth}px` : ''}
          aria-label="CSV preview"
        >
          <thead class="bg-base-200 text-base-content/60 sticky top-0 z-10 text-xs shadow-sm">
            <tr>
              <th class="text-base-content/30 w-10 text-right font-normal"></th>
              {#if leftPadWidth > 0}
                <th style="width: {leftPadWidth}px" class="border-0 p-0"></th>
              {/if}
              {#each headers.slice(colStartIndex, colEndIndex) as header, j (colStartIndex + j)}
                <th
                  class="truncate font-semibold"
                  style={columnWidths.length > 0 && columnWidths[colStartIndex + j] !== undefined
                    ? `width: ${columnWidths[colStartIndex + j]}px`
                    : 'width: 120px'}>{header}</th
                >
              {/each}
              {#if rightPadWidth > 0}
                <th style="width: {rightPadWidth}px" class="border-0 p-0"></th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#if startIndex > 0}
              <tr style="height: {startIndex * ROW_HEIGHT}px;">
                <td colspan={totalCellCount} class="border-0 p-0"></td>
              </tr>
            {/if}
            {#each visibleRows as row (row.index)}
              <tr class="hover:bg-base-200 h-8 transition-colors">
                <td class="text-base-content/30 w-10 pr-1 text-right text-xs select-none"
                  >{(row.index + 1).toLocaleString(getLocale())}</td
                >
                {#if leftPadWidth > 0}
                  <td style="width: {leftPadWidth}px" class="border-0 p-0"></td>
                {/if}
                {#if row.data !== null && row.data !== undefined}
                  <!--eslint-disable-next-line @typescript-eslint/no-unused-vars-->
                  {#each headers.slice(colStartIndex, colEndIndex) as _h, j (colStartIndex + j)}
                    {#if row.data[colStartIndex + j] !== undefined}
                      <td
                        class="text-base-content/80 truncate text-xs"
                        style={columnWidths.length > 0 &&
                        columnWidths[colStartIndex + j] !== undefined
                          ? `width: ${columnWidths[colStartIndex + j]}px`
                          : 'width: 120px'}
                      >
                        {row.data[colStartIndex + j] !== null
                          ? String(row.data[colStartIndex + j])
                          : ''}
                      </td>
                    {:else}
                      <td class="p-1">
                        <div class="bg-base-300/40 h-4 w-full animate-pulse rounded"></div>
                      </td>
                    {/if}
                  {/each}
                {:else}
                  <!--eslint-disable-next-line @typescript-eslint/no-unused-vars-->
                  {#each headers.slice(colStartIndex, colEndIndex) as _h, j (colStartIndex + j)}
                    <td class="p-1">
                      <div class="bg-base-300/40 h-4 w-full animate-pulse rounded"></div>
                    </td>
                  {/each}
                {/if}
                {#if rightPadWidth > 0}
                  <td style="width: {rightPadWidth}px" class="border-0 p-0"></td>
                {/if}
              </tr>
            {/each}
            {#if endIndex < virtualTotalRows}
              <tr style="height: {(virtualTotalRows - endIndex) * ROW_HEIGHT}px;">
                <td colspan={totalCellCount} class="border-0 p-0"></td>
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
{/if}
