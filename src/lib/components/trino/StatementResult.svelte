<script lang="ts">
  import { browser } from '$app/environment';
  import * as m from '$lib/paraglide/messages.js';
  import type { QuerySnapshot } from '$lib/types/query';
  import { ALLOWED_PAGE_SIZES, isPageSize, type PageSize } from '$lib/types/pagination.js';

  const STORAGE_KEY = 'trino_page_size';

  let {
    result,
    index,
    totalStatements
  }: {
    result: QuerySnapshot;
    index: number;
    totalStatements: number;
  } = $props();

  const uid = $props.id();

  let collapsed = $state(false);
  let currentPage = $state(0);
  let pageSize = $state<PageSize>(initPageSize());

  function initPageSize(): PageSize {
    if (!browser) return 25;
    const stored = parseInt(localStorage.getItem(STORAGE_KEY) ?? '', 10);
    return isPageSize(stored) ? stored : 25;
  }

  function handlePageSizeChange(event: Event) {
    const n = parseInt((event.target as HTMLSelectElement).value, 10);
    if (isPageSize(n)) {
      pageSize = n;
      currentPage = 0;
      if (browser && totalStatements === 1) {
        localStorage.setItem(STORAGE_KEY, String(n));
      }
    }
  }

  const totalRows = $derived(result.rows.length);
  const displayedRows = $derived(
    result.rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  );
  const hasMore = $derived((currentPage + 1) * pageSize < totalRows);
  const rowStart = $derived(currentPage * pageSize + 1);
  const rowEnd = $derived(currentPage * pageSize + displayedRows.length);
  const stmtError = $derived(
    result.error && !result.error.startsWith('ROW_LIMIT:') ? result.error : null
  );
  const rowLimitWarning = $derived(
    result.error?.startsWith('ROW_LIMIT:')
      ? m.trino_row_limit_reached({ limit: result.error.split(':')[1] })
      : null
  );
  const showHeader = $derived(totalStatements > 1);
</script>

<div class="border-base-300 border-b last:border-b-0">
  {#if showHeader}
    <div
      class="bg-base-200/50 hover:bg-base-200 flex w-full cursor-pointer items-center gap-5 px-4 py-2 text-left transition-colors"
      onclick={() => (collapsed = !collapsed)}
      onkeydown={(e) => e.key === 'Enter' && (collapsed = !collapsed)}
      role="button"
      tabindex="0"
      aria-expanded={!collapsed}
      aria-controls="{uid}-panel"
      aria-label={m.trino_statement_collapse({ index: index + 1 })}
    >
      <span
        class="badge badge-sm pointer-events-none {result.state === 'FINISHED'
          ? 'badge-success'
          : result.state === 'FAILED'
            ? 'badge-error'
            : result.state === 'CANCELLED'
              ? 'badge-neutral'
              : 'badge-info'}"
      >
        {m.trino_statement_header({ index: index + 1 })}
      </span>
      {#if result.trinoQueryUrl}
        <a
          href={result.trinoQueryUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="link link-primary z-10 text-xs"
          onclick={(e) => e.stopPropagation()}
        >
          {m.trino_view_in_trino()}
        </a>
      {/if}
      <code class="text-base-content/60 pointer-events-none max-w-md truncate text-xs">
        {result.sql.length > 80 ? result.sql.slice(0, 80) + '\u2026' : result.sql}
      </code>
      {#if totalRows > 0}
        <span class="text-base-content/40 pointer-events-none ml-auto text-xs">
          {m.trino_rows_range({
            start: rowStart,
            end: rowEnd,
            total: totalRows
          })}
        </span>
      {/if}
      <span
        class="text-base-content/40 pointer-events-none transition-transform {collapsed
          ? ''
          : 'rotate-180'}"
        aria-hidden="true"
      >
        <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clip-rule="evenodd"
          />
        </svg>
      </span>
    </div>
  {/if}
  <div id="{uid}-panel" class="{showHeader ? 'px-4 py-2' : 'p-4'} {collapsed ? 'hidden' : ''}">
    {#if stmtError}
      <div class="flex flex-col gap-2" role="alert">
        <p class="text-error text-sm font-semibold">{m.trino_query_error()}</p>
        <pre
          class="bg-base-200 text-base-content overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">{stmtError}</pre>
      </div>
    {:else if result.state === 'FINISHED' && result.columns.length > 0}
      <div class="overflow-x-auto">
        <table
          class="table-sm table-zebra table"
          aria-label={showHeader
            ? `${m.trino_results_label()} \u2014 ${m.trino_statement_header({ index: index + 1 })}`
            : m.trino_results_label()}
        >
          <thead>
            <tr>
              {#each result.columns as col (col.name)}
                <th scope="col" class="whitespace-nowrap">{col.name}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each displayedRows as row, rowIdx (rowIdx)}
              <tr>
                {#each row as cell, cellIdx (cellIdx)}
                  <td class="font-mono text-xs whitespace-nowrap">
                    {#if cell === null}
                      <span class="text-base-content/50 italic">null</span>
                    {:else}
                      {String(cell)}
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if rowLimitWarning}
        <span class="text-warning mt-1 block text-xs">{rowLimitWarning}</span>
      {/if}
      <div class="flex items-center justify-between pt-2">
        {#if totalRows > pageSize}
          <div class="join">
            <button
              class="btn btn-xs join-item"
              onclick={() => (currentPage = Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              aria-label={m.trino_prev_page()}
            >
              &#8249;
            </button>
            <button
              class="btn btn-xs join-item"
              onclick={() => {
                if (hasMore) currentPage += 1;
              }}
              disabled={!hasMore}
              aria-label={m.trino_next_page()}
            >
              &#8250;
            </button>
          </div>
        {:else}
          <div></div>
        {/if}
        <span class="text-base-content/40 text-xs">
          {m.trino_rows_range({
            start: rowStart,
            end: rowEnd,
            total: totalRows
          })}
        </span>
        <div class="flex items-center gap-2">
          <label for="{uid}-page-size" class="text-base-content/60 text-xs whitespace-nowrap">
            {m.trino_page_size()}
          </label>
          <select
            id="{uid}-page-size"
            class="select select-xs"
            value={pageSize}
            onchange={handlePageSizeChange}
          >
            {#each ALLOWED_PAGE_SIZES as size (size)}
              <option value={size}>{size}</option>
            {/each}
          </select>
        </div>
      </div>
    {:else if result.state === 'FINISHED' && result.columns.length === 0}
      <p class="text-base-content/40 py-2 text-sm">{m.trino_results_empty()}</p>
    {/if}
  </div>
</div>
