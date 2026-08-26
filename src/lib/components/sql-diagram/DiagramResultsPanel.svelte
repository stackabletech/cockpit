<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { initPageSize, type PageSize } from '$lib/types/pagination.js';
  import Pagination from '$lib/components/Pagination.svelte';
  import type { DiagramQueryResult } from '$lib/sql-diagram/types.js';

  const STORAGE_KEY = 'sql_diagram_page_size';
  /** Absolute row cap applied server-side (mirrors the SQL editor). */
  const ROW_LIMIT = 10_000;

  interface Props {
    previewSql: string;
    result: DiagramQueryResult | null;
    isRunning: boolean;
  }

  let { previewSql, result, isRunning }: Props = $props();

  let currentPage = $state(0);
  let pageSize = $state<PageSize>(initPageSize(STORAGE_KEY));
  let sqlCollapsed = $state(
    (() => {
      try {
        return localStorage.getItem('sql_diagram_sql_collapsed') === '1';
      } catch {
        return false;
      }
    })()
  );

  function toggleSqlCollapsed() {
    sqlCollapsed = !sqlCollapsed;
    try {
      localStorage.setItem('sql_diagram_sql_collapsed', sqlCollapsed ? '1' : '0');
    } catch {
      // Private browsing – collapse state simply is not persisted
    }
  }

  // Reset to the first page whenever a new result arrives.
  $effect(() => {
    void result;
    currentPage = 0;
  });

  const rowsCount = $derived(result?.rows.length ?? 0);
  const displayedRows = $derived(
    result ? result.rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : []
  );
  const totalPages = $derived(Math.ceil(rowsCount / pageSize));
  const lastPage = $derived(totalPages - 1);
  const rowStart = $derived(rowsCount === 0 ? 0 : currentPage * pageSize + 1);
  const rowEnd = $derived(currentPage * pageSize + displayedRows.length);
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden" data-testid="sql-diagram-panel">
  <!-- Permanent assembled SQL preview (collapsible) -->
  <div class="border-base-200 shrink-0 border-b px-4 py-2">
    <div class="mb-1 flex items-center justify-between">
      <span class="text-base-content/60 text-xs font-semibold tracking-wider uppercase">
        {m.sql_diagram_assembled_sql()}
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        aria-expanded={!sqlCollapsed}
        aria-label={sqlCollapsed ? m.sql_diagram_show_sql() : m.sql_diagram_hide_sql()}
        onclick={toggleSqlCollapsed}
        data-testid="toggle-assembled-sql"
      >
        {sqlCollapsed ? '▸' : '▾'}
      </button>
    </div>
    {#if !sqlCollapsed}
      {#if previewSql}
        <pre
          class="text-base-content/80 max-h-24 overflow-auto font-mono text-[11px] whitespace-pre-wrap"
          data-testid="assembled-sql">{previewSql}</pre>
      {:else}
        <p class="text-base-content/30 text-[11px] italic">{m.sql_diagram_empty_sql()}</p>
      {/if}
    {:else if previewSql}
      <p class="text-base-content/40 truncate font-mono text-[10px] italic" title={previewSql}>
        {previewSql.split('\n')[0]}
      </p>
    {/if}
  </div>

  <!-- Results header -->
  <div class="border-base-200 flex shrink-0 items-center gap-3 border-b px-4 py-2">
    <span class="text-base-content/60 text-sm font-medium">{m.trino_results_label()}</span>
    {#if result}
      {#if result.error}
        <span class="badge badge-error badge-sm">{m.sql_diagram_error_badge()}</span>
      {:else}
        <span class="badge badge-success badge-sm">
          {rowsCount === 1
            ? m.sql_diagram_rows_one({ count: rowsCount })
            : m.sql_diagram_rows_other({ count: rowsCount })}
        </span>
        <span class="text-base-content/40 text-[11px]"
          >{result.durationMs.toFixed(1)}
          {m.sql_diagram_unit_ms()}</span
        >
      {/if}
    {/if}
  </div>

  <!-- Table / error / empty state -->
  <div class="min-h-0 flex-1 overflow-auto">
    {#if isRunning}
      <div class="text-base-content/40 flex h-full items-center justify-center gap-3">
        <span class="loading loading-dots loading-md"></span>
        <span>{m.sql_diagram_executing()}</span>
      </div>
    {:else if !result}
      <div class="text-base-content/30 flex h-full items-center justify-center text-sm">
        {m.sql_diagram_no_results()}
      </div>
    {:else if result.error}
      <div class="flex h-full items-center justify-center p-4">
        <div
          class="border-error/30 bg-error/10 text-error max-w-lg rounded-lg border p-4 text-sm"
          data-testid="diagram-query-error"
        >
          <p class="mb-1 font-semibold">{m.sql_diagram_query_failed()}</p>
          <p class="font-mono text-xs">{result.error}</p>
        </div>
      </div>
    {:else if result.rows.length === 0}
      <div class="text-base-content/30 flex h-full items-center justify-center text-sm">
        {m.sql_diagram_zero_rows()}
      </div>
    {:else}
      {#if result.truncated}
        <p class="text-warning px-4 pt-2 text-xs" role="status">
          {m.trino_row_limit_reached({ limit: ROW_LIMIT })}
        </p>
      {/if}
      <table class="table-sm table w-full text-xs">
        <thead>
          <tr class="bg-base-200 sticky top-0 z-10">
            <th class="text-base-content/30 w-10">#</th>
            {#each result.columns as col (col)}
              <th class="text-base-content/70 font-mono text-[11px] font-semibold">{col}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each displayedRows as row, i (i)}
            <tr class="hover:bg-base-200/50">
              <td class="text-base-content/30">{rowStart + i}</td>
              {#each result.columns as col (col)}
                <td class="max-w-48 truncate font-mono" title={String(row[col] ?? '')}>
                  {#if row[col] == null}
                    <span class="text-base-content/20 italic">NULL</span>
                  {:else}
                    {row[col]}
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <!-- Pagination -->
  {#if result && !result.error && rowsCount > 0}
    <div class="border-base-200 shrink-0 border-t px-4 py-1">
      <Pagination
        bind:pageSize
        storageKey={STORAGE_KEY}
        pageSizeLabel={m.trino_page_size()}
        infoLabel={rowsCount > pageSize
          ? m.trino_rows_range({ start: rowStart, end: rowEnd, total: rowsCount })
          : ''}
        current={currentPage}
        total={totalPages}
        onfirst={() => (currentPage = 0)}
        onprev={() => (currentPage = Math.max(0, currentPage - 1))}
        onnext={() => (currentPage = Math.min(lastPage, currentPage + 1))}
        onlast={() => (currentPage = lastPage)}
        onpagesizechange={() => (currentPage = 0)}
        pageSizeRight={true}
      />
    </div>
  {/if}
</div>
