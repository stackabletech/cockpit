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
  const totalPages = $derived(Math.ceil(totalRows / pageSize));
  const lastPage = $derived(totalPages - 1);
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

  const CSV_HEADERS_KEY = 'trino_csv_include_headers';
  let includeHeaders = $state(browser ? localStorage.getItem(CSV_HEADERS_KEY) === 'true' : false);

  function escapeCsvField(value: string): string {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  function downloadCsv() {
    const lines: string[] = [];
    if (includeHeaders) {
      lines.push(result.columns.map((c) => escapeCsvField(c.name)).join(','));
    }
    for (const row of result.rows) {
      lines.push(
        row
          .map((cell) => {
            switch (typeof cell) {
              case 'object':
                return cell === null ? '' : escapeCsvField(JSON.stringify(cell));
              default:
                return escapeCsvField(String(cell));
            }
          })
          .join(',')
      );
    }
    // UTF-8 BOM so Excel correctly detects encoding for non-ASCII content
    const blob = new Blob(['\uFEFF', lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'query-result.csv'
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function handleIncludeHeadersChange(event: Event) {
    includeHeaders = (event.target as HTMLInputElement).checked;
    if (browser) {
      localStorage.setItem(CSV_HEADERS_KEY, String(includeHeaders));
    }
  }
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
    {#if result.trinoQueryUrl || result.columns.length > 0}
      <div class="flex items-center gap-2 pb-1">
        {#if result.trinoQueryUrl}
          <a
            href={result.trinoQueryUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-xs btn-ghost"
          >
            {m.trino_view_in_trino()}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-3.5 w-3.5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"
              />
              <path
                d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"
              />
            </svg>
          </a>
        {/if}
        {#if result.columns.length > 0}
          {#if result.trinoQueryUrl}
            <div class="divider divider-horizontal mx-0"></div>
          {/if}
          <button class="btn btn-xs btn-ghost" onclick={downloadCsv}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                clip-rule="evenodd"
              />
            </svg>
            {m.trino_export_csv()}
          </button>
          <label class="flex cursor-pointer items-center gap-1 text-xs whitespace-nowrap">
            <input
              type="checkbox"
              class="checkbox checkbox-xs checkbox-primary h-3.5 w-3.5"
              checked={includeHeaders}
              onchange={handleIncludeHeadersChange}
            />
            <span class="text-base-content/60">{m.trino_export_csv_column_names()}</span>
          </label>
        {/if}
      </div>
    {/if}
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
                      {typeof cell === 'object' ? JSON.stringify(cell) : String(cell)}
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
        <div class="flex items-center gap-4">
          {#if totalPages > 1}
            <nav class="join" aria-label={m.trino_results_label()}>
              <button
                class="btn btn-xs join-item"
                disabled={currentPage === 0}
                onclick={() => (currentPage = 0)}
                aria-label={m.trino_first_page()}
              >
                &#171;
              </button>
              <button
                class="btn btn-xs join-item"
                disabled={currentPage === 0}
                onclick={() => (currentPage = Math.max(0, currentPage - 1))}
                aria-label={m.trino_prev_page()}
              >
                &#8249;
              </button>
              <button
                class="btn btn-xs join-item"
                disabled={currentPage === lastPage}
                onclick={() => (currentPage = Math.min(lastPage, currentPage + 1))}
                aria-label={m.trino_next_page()}
              >
                &#8250;
              </button>
              <button
                class="btn btn-xs join-item"
                disabled={currentPage === lastPage}
                onclick={() => (currentPage = lastPage)}
                aria-label={m.trino_last_page()}
              >
                &#187;
              </button>
            </nav>
          {/if}
          <span class="text-base-content/60 text-xs">
            {m.trino_rows_range({
              start: rowStart,
              end: rowEnd,
              total: totalRows
            })}
          </span>
        </div>
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
