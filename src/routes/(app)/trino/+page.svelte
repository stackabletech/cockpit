<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { browser } from '$app/environment';
  import * as m from '$lib/paraglide/messages.js';
  import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
  import CatalogBrowser from '$lib/components/catalog/CatalogBrowser.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import { tabStore, MAX_SQL_LENGTH } from '$lib/stores/tab-store.svelte.js';
  import { getOrCreateQueryRunner, destroyQueryRunner } from './query-runner.svelte.js';
  import type { PageData } from './$types';
  import { ALLOWED_PAGE_SIZES } from './validation';

  let { data }: { data: PageData } = $props();

  const uid = $props.id();

  function getStoredValue(key: string, fallback: string): string {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  let sql = $state(tabStore.activeTab.sql);
  let pageSize = $state<25 | 50 | 100>(25);
  let defaultCatalog = $state('');
  let defaultSchema = $state('');
  let currentPages = new SvelteMap<string, number>();
  let hydrated = $state(false);

  // Signal to trigger catalog browser load (1 = load on mount).
  let catalogVersion = $state(0);

  // Catalog browser state. On mobile, always start closed; on desktop, restore from localStorage.
  function getInitialCatalogOpen(): boolean {
    if (!browser) return false;
    try {
      const isMobile = !window.matchMedia('(min-width: 1024px)').matches;
      if (isMobile) return false;
      return (localStorage.getItem('trino_catalog_browser_open') ?? 'true') === 'true';
    } catch {
      return false;
    }
  }
  let catalogBrowserOpen = $state(getInitialCatalogOpen());
  let monacoEditor = $state<MonacoEditor | undefined>(undefined);
  let mobileCatalogOpen = $state(false);

  // Per-tab Monaco view states, keyed by tab ID.
  const viewStates = new SvelteMap<
    string,
    import('monaco-editor').editor.ICodeEditorViewState | null
  >();

  // Non-reactive tracker for tab switching.
  let lastTabId: string | null = null;

  // Get current page for active tab.
  const currentPage = $derived(currentPages.get(tabStore.activeTabId) ?? 0);

  function setCurrentPage(page: number) {
    currentPages.set(tabStore.activeTabId, page);
  }

  // Get the query runner for the active tab.
  const runner = $derived(getOrCreateQueryRunner(tabStore.activeTabId));

  // Tab bar items derived from tab store.
  const tabItems = $derived(
    tabStore.tabs.map((t) => ({
      id: t.id,
      label: tabStore.getTabLabel(t)
    }))
  );

  onMount(() => {
    defaultCatalog = getStoredValue('trino_default_catalog', '');
    defaultSchema = getStoredValue('trino_default_schema', '');
    const storedPageSize = parseInt(getStoredValue('trino_page_size', '25'), 10);
    pageSize = ALLOWED_PAGE_SIZES.includes(storedPageSize as 25 | 50 | 100)
      ? (storedPageSize as 25 | 50 | 100)
      : 25;
    hydrated = true;
    lastTabId = tabStore.activeTabId;

    if (data.trinoConfigured) {
      catalogVersion++;
    }

    // Resume active queries from server-side state (survives page reloads).
    for (const [tabId, snapshot] of Object.entries(data.activeQueries)) {
      getOrCreateQueryRunner(tabId).initialise(snapshot);
    }
  });

  const isActive = $derived.by(() => {
    const s = runner.state;
    return (
      s === 'SUBMITTING' ||
      s === 'QUEUED' ||
      s === 'PLANNING' ||
      s === 'RUNNING' ||
      s === 'FINISHING'
    );
  });

  // Persist settings.
  $effect(() => {
    if (!hydrated) return;
    localStorage.setItem('trino_page_size', String(pageSize));
    localStorage.setItem('trino_default_catalog', defaultCatalog);
    localStorage.setItem('trino_default_schema', defaultSchema);
    localStorage.setItem('trino_catalog_browser_open', String(catalogBrowserOpen));
  });

  // Handle tab switches: save/restore Monaco view state.
  $effect(() => {
    const currentTabId = tabStore.activeTabId;
    // Only read activeTabId reactively; use untrack for the rest.
    untrack(() => {
      if (lastTabId && lastTabId !== currentTabId && monacoEditor) {
        viewStates.set(lastTabId, monacoEditor.getViewState());
      }

      if (monacoEditor && currentTabId) {
        const tab = tabStore.activeTab;
        monacoEditor.setValue(tab.sql);
        sql = tab.sql;
        const savedState = viewStates.get(currentTabId) ?? null;
        monacoEditor.restoreViewState(savedState);
      }

      lastTabId = currentTabId;
    });
  });

  // Sync Monaco content changes back to the tab store, clamping to max length.
  $effect(() => {
    if (hydrated) {
      // Read sql reactively.
      const currentSql = sql;
      untrack(() => {
        if (currentSql.length > MAX_SQL_LENGTH) {
          sql = currentSql.slice(0, MAX_SQL_LENGTH);
          monacoEditor?.setValue(sql);
        }
        tabStore.updateSql(tabStore.activeTabId, sql);
      });
    }
  });

  // Reset pagination when rows change for the active runner.
  let prevRowCount = $state(0);
  $effect(() => {
    const count = runner.rows.length;
    if (count !== prevRowCount && count > 0 && prevRowCount === 0) {
      setCurrentPage(0);
    }
    prevRowCount = count;
  });

  const totalRows = $derived(runner.rows.length);
  const displayedRows = $derived(
    runner.rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  );
  const hasMore = $derived((currentPage + 1) * pageSize < totalRows);
  const rowStart = $derived(currentPage * pageSize + 1);
  const rowEnd = $derived(currentPage * pageSize + displayedRows.length);

  const stateLabel = $derived.by(() => {
    const stateMap: Record<string, () => string> = {
      SUBMITTING: m.trino_state_submitting,
      QUEUED: m.trino_state_queued,
      PLANNING: m.trino_state_planning,
      RUNNING: m.trino_state_running,
      FINISHING: m.trino_state_finishing,
      FINISHED: m.trino_state_finished,
      FAILED: m.trino_state_failed,
      CANCELLED: m.trino_state_cancelled
    };
    return stateMap[runner.state]?.() ?? null;
  });

  const stateBadgeClass = $derived.by(() => {
    switch (runner.state) {
      case 'QUEUED':
      case 'PLANNING':
        return 'badge-warning';
      case 'RUNNING':
      case 'FINISHING':
      case 'SUBMITTING':
        return 'badge-info';
      case 'FINISHED':
        return 'badge-success';
      case 'FAILED':
        return 'badge-error';
      case 'CANCELLED':
        return 'badge-neutral';
      default:
        return '';
    }
  });

  const rowLimitError = $derived.by(() => {
    if (runner.error?.startsWith('ROW_LIMIT:')) {
      const limit = runner.error.split(':')[1];
      return m.trino_row_limit_reached({ limit });
    }
    return null;
  });

  const queryError = $derived.by(() => {
    if (!runner.error) return null;
    if (runner.error.startsWith('ROW_LIMIT:')) return null;
    return runner.error;
  });

  function handleExecute() {
    setCurrentPage(0);
    runner.execute(sql, {
      catalog: defaultCatalog || undefined,
      schema: defaultSchema || undefined
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      handleExecute();
    }
  }

  function goToPrevPage() {
    setCurrentPage(Math.max(0, currentPage - 1));
  }

  function goToNextPage() {
    if (hasMore) setCurrentPage(currentPage + 1);
  }

  function handlePageSizeChange(event: Event) {
    pageSize = parseInt((event.target as HTMLSelectElement).value, 10) as 25 | 50 | 100;
    setCurrentPage(0);
  }

  function toggleCatalogBrowser() {
    if (browser && !window.matchMedia('(min-width: 1024px)').matches) {
      mobileCatalogOpen = !mobileCatalogOpen;
    } else {
      catalogBrowserOpen = !catalogBrowserOpen;
    }
  }

  function handleTabSelect(id: string) {
    tabStore.switchTab(id);
  }

  function handleTabClose(id: string) {
    destroyQueryRunner(id);
    viewStates.delete(id);
    currentPages.delete(id);
    tabStore.closeTab(id);
  }

  function handleTabAdd() {
    tabStore.createTab();
  }

  function handleTabRename(id: string, newLabel: string) {
    tabStore.renameTab(id, newLabel);
  }

  function handleTabReorder(from: number, to: number) {
    tabStore.reorderTabs(from, to);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet closeIcon()}
  <svg
    class="h-4 w-4"
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
  >
{/snippet}

<div class="flex h-full gap-4">
  <!-- Catalog browser panel (desktop) — always in DOM, collapses via width transition -->
  <aside
    class="bg-base-100 border-base-300 hidden shrink-0 flex-col overflow-hidden rounded-xl border transition-[width] duration-200 ease-out lg:flex {catalogBrowserOpen
      ? 'w-72'
      : 'invisible w-0 border-0'}"
  >
    <div class="border-base-300 flex w-72 items-center justify-between border-b px-3 py-2">
      <span class="text-base-content/60 text-sm font-medium">{m.trino_catalog_browser()}</span>
    </div>
    <div class="w-72">
      <CatalogBrowser
        connectionVersion={catalogVersion}
        bind:defaultCatalog
        bind:defaultSchema
        onInsert={(name) => monacoEditor?.insertAtCursor(name)}
      />
    </div>
  </aside>

  <!-- Mobile catalog browser overlay -->
  <Modal
    bind:open={mobileCatalogOpen}
    class="bg-base-100 fixed inset-0 z-40 h-full max-h-full w-full max-w-full p-0 lg:hidden"
  >
    <div class="flex h-full flex-col">
      <div class="border-base-300 flex items-center justify-between border-b px-3 py-2">
        <span class="text-base-content/60 text-sm font-medium">{m.trino_catalog_browser()}</span>
        <button
          class="btn btn-ghost btn-xs"
          onclick={() => (mobileCatalogOpen = false)}
          aria-label={m.trino_catalog_browser_toggle()}
        >
          {@render closeIcon()}
        </button>
      </div>
      <CatalogBrowser
        connectionVersion={catalogVersion}
        bind:defaultCatalog
        bind:defaultSchema
        onInsert={(name) => {
          monacoEditor?.insertAtCursor(name);
          mobileCatalogOpen = false;
        }}
      />
    </div>
  </Modal>

  <!-- Main editor + results column -->
  <div class="flex min-w-0 flex-1 flex-col">
    <!-- Tab bar -->
    <div class="px-2 pt-1">
      <TabBar
        items={tabItems}
        activeId={tabStore.activeTabId}
        onSelect={handleTabSelect}
        onClose={handleTabClose}
        onAdd={handleTabAdd}
        onRename={handleTabRename}
        onReorder={handleTabReorder}
        maxItems={tabStore.maxTabs}
      />
    </div>

    <!-- Persistence warning -->
    {#if tabStore.persistError}
      <div class="px-2" role="alert">
        <div class="alert alert-warning text-sm">
          {m.trino_tabs_persist_error()}
        </div>
      </div>
    {/if}

    <!-- Content card (editor + status + results) -->
    <div
      class="bg-base-100 border-base-300 flex min-h-0 flex-1 flex-col rounded-t-none rounded-b-xl border"
    >
      <div class="border-base-300 flex items-center justify-between border-b px-4 py-2">
        <div class="flex items-center gap-2">
          <div class="tooltip tooltip-right" data-tip={m.trino_catalog_browser_toggle()}>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onclick={toggleCatalogBrowser}
              aria-label={m.trino_catalog_browser_toggle()}
            >
              {#if catalogBrowserOpen}
                <svg
                  class="hidden h-4 w-4 lg:block"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path
                    d="m14 9-3 3 3 3"
                  /></svg
                >
                <svg
                  class="h-4 w-4 lg:hidden"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg
                >
              {:else}
                <svg
                  class="h-4 w-4"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path
                    d="m12 9 3 3-3 3"
                  /></svg
                >
              {/if}
            </button>
          </div>
          <span class="text-base-content/60 text-sm font-medium">{m.trino_editor_label()}</span>
        </div>
        <div class="flex gap-2">
          {#if isActive}
            <button
              type="button"
              class="btn btn-error btn-sm"
              onclick={() => runner.cancel()}
              aria-label={m.trino_cancel_query()}
            >
              {m.trino_cancel_query()}
            </button>
          {/if}
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={isActive}
            aria-label={m.trino_run_query()}
            onclick={handleExecute}
          >
            {#if isActive}
              <span class="loading loading-spinner loading-xs"></span>
              {m.trino_running()}
            {:else}
              {m.trino_run_query()}
              <kbd class="kbd kbd-sm text-base-content opacity-60">Ctrl+↵</kbd>
            {/if}
          </button>
        </div>
      </div>
      <div class="h-64 px-4 py-2">
        <MonacoEditor bind:this={monacoEditor} bind:value={sql} onExecute={handleExecute} />
      </div>

      <!-- Status display -->
      {#if runner.state !== 'IDLE'}
        <div
          class="border-base-300 flex flex-wrap items-center gap-3 border-t px-4 py-2"
          aria-live="polite"
          data-query-state={runner.state}
        >
          {#if stateLabel}
            <span class="badge {stateBadgeClass}">{stateLabel}</span>
          {/if}
          {#if runner.state === 'RUNNING'}
            <span class="text-base-content/60 text-xs tabular-nums"
              >{Math.round(runner.progress.progressPercentage)}%</span
            >
            <progress
              class="progress progress-primary shrink-0"
              style="width: 8rem"
              value={runner.progress.progressPercentage}
              max="100"
            ></progress>
          {/if}
          {#if runner.progress.processedRows > 0 || runner.progress.elapsedTimeMillis > 0}
            <span class="text-base-content/60 text-xs">
              {m.trino_progress_info({
                rows: runner.progress.processedRows.toLocaleString(),
                elapsed: (runner.progress.elapsedTimeMillis / 1000).toFixed(1)
              })}
            </span>
          {/if}
          {#if runner.trinoQueryUrl}
            <a
              href={runner.trinoQueryUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="link link-primary text-xs"
            >
              {m.trino_view_in_trino()}
            </a>
          {/if}
          {#if rowLimitError}
            <span class="text-warning text-xs">{rowLimitError}</span>
          {/if}
        </div>
      {/if}

      <!-- Results section -->
      <div class="border-base-300 flex items-center border-t px-4 py-2">
        <span class="text-base-content/60 text-sm font-medium">{m.trino_results_label()}</span>
        {#if runner.state === 'FINISHED' && displayedRows.length > 0 && totalRows > 0}
          <span class="text-base-content/40 ml-2 text-xs">
            {m.trino_rows_range({ start: rowStart, end: rowEnd, total: totalRows })}
          </span>
        {/if}
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        {#if queryError}
          <div class="flex flex-col gap-2" role="alert">
            <p class="text-error text-sm font-semibold">{m.trino_query_error()}</p>
            <pre
              class="bg-base-200 text-base-content overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">{queryError}</pre>
          </div>
        {:else if runner.state === 'FINISHED' && runner.columns.length > 0}
          <div class="overflow-x-auto">
            <table class="table-sm table-zebra table" aria-label={m.trino_results_label()}>
              <thead>
                <tr>
                  {#each runner.columns as col (col.name)}
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
        {:else if !isActive && !queryError}
          <p class="text-base-content/40 py-8 text-center text-sm">{m.trino_results_empty()}</p>
        {/if}
      </div>

      {#if runner.state === 'FINISHED' && runner.columns.length > 0}
        <div class="border-base-300 flex items-center justify-between border-t px-4 py-3">
          <div class="join">
            <button
              class="btn btn-sm join-item"
              onclick={goToPrevPage}
              disabled={currentPage === 0}
              aria-label={m.trino_prev_page()}
            >
              ‹
            </button>
            <button
              class="btn btn-sm join-item"
              onclick={goToNextPage}
              disabled={!hasMore}
              aria-label={m.trino_next_page()}
            >
              ›
            </button>
          </div>

          <div class="flex items-center gap-3">
            <label for="{uid}-page-size" class="text-base-content/60 text-sm whitespace-nowrap">
              {m.trino_page_size()}
            </label>
            <select
              id="{uid}-page-size"
              class="select select-sm"
              value={pageSize}
              onchange={handlePageSizeChange}
            >
              {#each ALLOWED_PAGE_SIZES as size (size)}
                <option value={size}>{size}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
