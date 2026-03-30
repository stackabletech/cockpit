<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { browser } from '$app/environment';
  import * as m from '$lib/paraglide/messages.js';
  import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
  import CatalogBrowser from '$lib/components/catalog/CatalogBrowser.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { superForm } from 'sveltekit-superforms';
  import type { ConnectionMessage } from './validation.js';
  import TabBar from '$lib/components/TabBar.svelte';
  import { tabStore, MAX_SQL_LENGTH } from '$lib/stores/tab-store.svelte.js';
  import { getOrCreateQueryRunner, destroyQueryRunner } from './query-runner.svelte.js';
  import { isTerminal } from '$lib/types/query';
  import {
    splitStatements,
    getStatementAtOffset,
    getStatementsInRange,
    type SqlStatement
  } from '$lib/editor/split-statements.js';
  import type { PageData } from './$types';
  import { ALLOWED_PAGE_SIZES, isPageSize, type PageSize } from './validation';

  let { data }: { data: PageData } = $props();

  const uid = $props.id();

  function getStoredValue(key: string, fallback: string): string {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  // Connection config - local state persisted to localStorage.
  let connectionUrl = $state('');
  let authType = $state<'none' | 'basic'>('none');
  let authUsername = $state('');
  let authPassword = $state('');
  let connectionOpen = $state(false);

  let sql = $state(tabStore.activeTab.sql);
  let pageSize = $state<PageSize>(25);
  let defaultCatalog = $state('');
  let defaultSchema = $state('');
  let currentPages = new SvelteMap<string, number>();
  let collapsedResults = new SvelteMap<string, boolean>();
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

  const viewStates = new SvelteMap<
    string,
    import('monaco-editor').editor.ICodeEditorViewState | null
  >();

  // Non-reactive tracker for tab switching.
  let lastTabId: string | null = null;

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
    if (!data.trinoConfigured) {
      connectionUrl = getStoredValue('trino_url', '');
      authType = getStoredValue('trino_auth_type', 'none') as 'none' | 'basic';
      authUsername = getStoredValue('trino_username', '');
    }
    defaultCatalog = getStoredValue('trino_default_catalog', '');
    defaultSchema = getStoredValue('trino_default_schema', '');
    const storedPageSize = parseInt(getStoredValue('trino_page_size', '25'), 10);
    pageSize = isPageSize(storedPageSize) ? storedPageSize : 25;
    hydrated = true;
    lastTabId = tabStore.activeTabId;

    if (data.trinoConfigured || data.userClientExists) {
      // Server already has a connection (env-based or per-user); load catalogues.
      catalogVersion++;
    } else if (connectionUrl && authType === 'none') {
      // Re-establish server-side connection from localStorage on page reload.
      // Only possible for unauthenticated connections since the password is not persisted.
      const body = new FormData();
      body.set('connectionUrl', connectionUrl);
      body.set('authType', authType);
      body.set('authUsername', '');
      body.set('authPassword', '');
      fetch('?/save', {
        method: 'POST',
        body,
        headers: { 'x-sveltekit-action': 'true' }
      })
        .then(() => {
          catalogVersion++;
        })
        .catch(() => {
          // Server-side connection could not be re-established from localStorage.
          // Clear stale state so the user is prompted to re-enter.
          connectionUrl = '';
          authType = 'none';
          authUsername = '';
        });
    } else if (connectionUrl && authType === 'basic') {
      // Password is not persisted; prompt the user to re-enter credentials.
      connectionOpen = true;
    }

    // Initialise runners from lightweight summaries (rows fetched on demand).
    for (const [tabId, snapshot] of Object.entries(data.activeQueries)) {
      getOrCreateQueryRunner(tabId).initialise(snapshot);
    }
    getOrCreateQueryRunner(tabStore.activeTabId).fetchResults();
  });

  // Connection form (SuperForms).
  const {
    enhance: connectionEnhance,
    errors: connectionErrors,
    message: connectionMessage
  } = superForm(data.connectionForm, {
    onUpdated({ form }) {
      const msg = form.message as ConnectionMessage | undefined;
      if (msg?.type === 'success') {
        catalogVersion++;
      } else if (msg?.type === 'error') {
        connectionOpen = true;
      }
    }
  });

  const isActive = $derived(runner.state !== 'IDLE' && !isTerminal(runner.state));

  // Persist connection config to localStorage (only in per-user mode).
  // Password is intentionally excluded -- credentials should not be stored client-side.
  $effect(() => {
    if (!hydrated || data.trinoConfigured) return;
    localStorage.setItem('trino_url', connectionUrl);
    localStorage.setItem('trino_auth_type', authType);
    localStorage.setItem('trino_username', authUsername);
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
      getOrCreateQueryRunner(currentTabId).fetchResults();
    });
  });

  // Sync Monaco content changes back to the tab store.
  $effect(() => {
    if (!hydrated) return;
    // Read sql reactively to trigger on changes; untrack the store call
    // to avoid re-running when activeTabId changes.
    const value = sql;
    untrack(() => tabStore.updateSql(tabStore.activeTabId, value));
  });

  let prevResultsLen = $state(0);
  $effect(() => {
    const len = runner.results.length;
    if (len !== prevResultsLen && len > 0) {
      setCurrentPage(0);
    }
    prevResultsLen = len;
  });

  const connectionSummary = $derived.by(() => {
    const host = connectionUrl ? connectionUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : '-';
    const auth = authType === 'basic' ? m.trino_auth_basic() : m.trino_auth_none();
    return `${host} \u00b7 ${auth}`;
  });

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

  const charLimitReached = $derived(sql.length >= MAX_SQL_LENGTH);

  const execOptions = $derived({
    catalog: defaultCatalog || undefined,
    schema: defaultSchema || undefined
  });

  function runStatements(statements: SqlStatement[]) {
    if (statements.length === 0) return;
    setCurrentPage(0);
    if (statements.length === 1) {
      runner.execute(statements[0].sql, execOptions);
    } else {
      runner.executeScript(statements, execOptions);
    }
  }

  /** Ctrl+Enter: run the single statement at the cursor. */
  function handleRunAtCursor() {
    const offset = monacoEditor?.getCursorOffset();
    const stmt = offset != null ? getStatementAtOffset(sql, offset) : null;
    if (stmt) runStatements([stmt]);
  }

  /** Run all statements in the editor, ignoring any selection. */
  function handleRunAll() {
    monacoEditor?.clearSelection();
    runStatements(splitStatements(sql));
  }

  /** Run only the statements overlapping the current selection. */
  function handleRunSelected() {
    const selection = monacoEditor?.getSelection();
    monacoEditor?.clearSelection();
    if (!selection) return;
    runStatements(getStatementsInRange(sql, selection.startOffset, selection.endOffset));
  }

  const hasSelection = $derived(monacoEditor?.getSelection() != null);

  type RunMode = 'cursor' | 'all';
  let runMode = $state<RunMode>('cursor');

  function handleRun() {
    // If text is selected, always run selected statements regardless of mode.
    if (monacoEditor?.getSelection()) {
      handleRunSelected();
      return;
    }
    if (runMode === 'cursor') {
      handleRunAtCursor();
    } else {
      handleRunAll();
    }
  }

  function selectRunMode(mode: RunMode) {
    runMode = mode;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  const runButtonLabel = $derived.by(() => {
    if (runMode === 'all') {
      return hasSelection ? m.trino_run_selected() : m.trino_run_all();
    }
    return m.trino_run_at_cursor();
  });

  const runShortcutLabel = $derived(runMode === 'cursor' ? 'Ctrl+↵' : 'Ctrl+Shift+↵');

  function handleKeydown(event: KeyboardEvent) {
    // Monaco handles its own keybindings — skip if the event originated from the editor.
    if (event.target instanceof HTMLElement && event.target.closest('[data-ready]')) return;

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      handleRunAll();
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      handleRunAtCursor();
    }
  }

  function handlePageSizeChange(event: Event) {
    const n = parseInt((event.target as HTMLSelectElement).value, 10);
    if (isPageSize(n)) pageSize = n;
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
    // Clean up server-side query state for this tab.
    fetch(`/trino/query?tabId=${encodeURIComponent(id)}&cleanup=true`, { method: 'DELETE' });
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
    <!-- Connection config form (hidden when Trino is env-configured) -->
    {#if !data.trinoConfigured}
      <form method="POST" action="?/save" use:connectionEnhance class="px-2 pt-1">
        <input type="hidden" name="connectionUrl" value={connectionUrl} />
        <input type="hidden" name="authType" value={authType} />
        <input type="hidden" name="authUsername" value={authUsername} />
        <input type="hidden" name="authPassword" value={authPassword} />

        <div class="bg-base-100 border-base-300 collapse rounded-xl border">
          <input
            type="checkbox"
            class="peer"
            aria-label={m.trino_connection_label()}
            bind:checked={connectionOpen}
          />
          <div
            class="collapse-title text-base-content flex items-center justify-between pr-4 text-sm font-medium"
          >
            <span>{m.trino_connection_label()}</span>
            <span class="text-base-content/50 font-mono text-xs">{connectionSummary}</span>
          </div>
          <div class="collapse-content flex flex-col gap-4">
            <!-- URL -->
            <div class="flex flex-col gap-1">
              <label for="{uid}-conn-url" class="label text-sm">
                {m.trino_connection_url()}
              </label>
              <input
                id="{uid}-conn-url"
                type="url"
                class="input input-sm w-full font-mono"
                class:input-error={$connectionErrors.connectionUrl}
                placeholder={m.trino_connection_url_placeholder()}
                bind:value={connectionUrl}
              />
              {#if $connectionErrors.connectionUrl}
                <p class="text-error text-xs">{$connectionErrors.connectionUrl}</p>
              {/if}
            </div>

            <!-- Auth type toggle -->
            <div class="flex flex-col gap-1">
              <span class="label text-sm">{m.trino_connection_auth()}</span>
              <div class="join" role="group" aria-label={m.trino_connection_auth()}>
                <input
                  id="{uid}-auth-none"
                  class="join-item btn btn-sm"
                  type="radio"
                  name="{uid}-auth"
                  aria-label={m.trino_auth_none()}
                  value="none"
                  bind:group={authType}
                />
                <input
                  id="{uid}-auth-basic"
                  class="join-item btn btn-sm"
                  type="radio"
                  name="{uid}-auth"
                  aria-label={m.trino_auth_basic()}
                  value="basic"
                  bind:group={authType}
                />
              </div>
            </div>

            <!-- Basic auth credentials -->
            {#if authType === 'basic'}
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div class="flex flex-col gap-1">
                  <label for="{uid}-auth-username" class="label text-sm">
                    {m.trino_auth_username()}
                  </label>
                  <input
                    id="{uid}-auth-username"
                    type="text"
                    class="input input-sm font-mono"
                    class:input-error={$connectionErrors.authUsername}
                    autocomplete="username"
                    bind:value={authUsername}
                  />
                  {#if $connectionErrors.authUsername}
                    <p class="text-error text-xs">{$connectionErrors.authUsername}</p>
                  {/if}
                </div>
                <div class="flex flex-col gap-1">
                  <label for="{uid}-auth-password" class="label text-sm">
                    {m.trino_auth_password()}
                  </label>
                  <input
                    id="{uid}-auth-password"
                    type="password"
                    class="input input-sm font-mono"
                    class:input-error={$connectionErrors.authPassword}
                    autocomplete="current-password"
                    bind:value={authPassword}
                  />
                  {#if $connectionErrors.authPassword}
                    <p class="text-error text-xs">{$connectionErrors.authPassword}</p>
                  {/if}
                </div>
              </div>
            {/if}

            <!-- Save button -->
            <div class="flex justify-end">
              <button type="submit" class="btn btn-primary btn-sm">
                {m.trino_save_connection()}
              </button>
            </div>

            {#if $connectionMessage}
              {@const msg = $connectionMessage as ConnectionMessage}
              {#if msg.type === 'success'}
                <p class="text-success text-sm">{m.trino_connection_saved()}</p>
              {:else}
                <p class="text-error text-sm">{msg.message}</p>
              {/if}
            {/if}
          </div>
        </div>
      </form>
    {/if}

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
      role="tabpanel"
      aria-labelledby="tab-{tabStore.activeTabId}"
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
          {#if charLimitReached}
            <span class="text-warning text-xs" role="status"
              >{m.trino_editor_char_limit_reached({ limit: MAX_SQL_LENGTH.toLocaleString() })}</span
            >
          {/if}
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
          {#snippet runOption(label: string, shortcut: string)}
            <span class="flex flex-col items-start text-xs font-semibold">
              <span>{label}</span>
              <kbd class="kbd kbd-xs text-base-content opacity-60">{shortcut}</kbd>
            </span>
          {/snippet}

          <div class="dropdown dropdown-end">
            <div class="join">
              <button
                type="button"
                class="btn btn-primary join-item py-1.5"
                disabled={isActive}
                aria-label={runButtonLabel}
                onclick={handleRun}
              >
                {#if isActive}
                  <span class="loading loading-spinner loading-xs"></span>
                  {m.trino_running()}
                {:else}
                  <span class="grid [&>*]:[grid-area:1/1]">
                    <!-- Invisible sizers: longest option sets width -->
                    <span class="invisible" aria-hidden="true">
                      {@render runOption(m.trino_run_at_cursor(), 'Ctrl+Shift+↵')}
                    </span>
                    <span class="invisible" aria-hidden="true">
                      {@render runOption(
                        hasSelection ? m.trino_run_selected() : m.trino_run_all(),
                        'Ctrl+Shift+↵'
                      )}
                    </span>
                    {@render runOption(runButtonLabel, runShortcutLabel)}
                  </span>
                {/if}
              </button>
              <div
                role="button"
                tabindex="0"
                class="btn btn-primary join-item border-l-primary-content/20 self-stretch border-l px-2"
                class:pointer-events-none={isActive}
                aria-haspopup="true"
                aria-label={m.trino_run_all()}
              >
                <svg class="h-3 w-3" aria-hidden="true" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fill-rule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
            </div>
            <div
              class="dropdown-content bg-primary text-primary-content rounded-box z-10 mt-1 flex w-full flex-col gap-1 p-1.5 shadow-lg"
            >
              <button
                type="button"
                class="rounded-btn hover:bg-primary-content/20 cursor-pointer px-3 py-1.5 text-left {runMode ===
                'cursor'
                  ? 'bg-primary-content/15'
                  : ''}"
                onclick={() => selectRunMode('cursor')}
              >
                {@render runOption(m.trino_run_at_cursor(), 'Ctrl+↵')}
              </button>
              <button
                type="button"
                class="rounded-btn hover:bg-primary-content/20 cursor-pointer px-3 py-1.5 text-left {runMode ===
                'all'
                  ? 'bg-primary-content/15'
                  : ''}"
                onclick={() => selectRunMode('all')}
              >
                {@render runOption(
                  hasSelection ? m.trino_run_selected() : m.trino_run_all(),
                  'Ctrl+Shift+↵'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="h-64 px-4 py-2">
        <MonacoEditor
          bind:this={monacoEditor}
          bind:value={sql}
          onExecute={handleRun}
          onExecuteAll={handleRunAll}
        />
      </div>

      <!-- Status display -->
      {#if runner.state !== 'IDLE'}
        <div
          class="border-base-300 flex flex-wrap items-center gap-3 border-t px-4 py-2"
          aria-live="polite"
          data-query-state={runner.state}
        >
          {#if runner.scriptProgress}
            <span class="text-base-content/60 text-xs font-medium">
              {m.trino_script_progress({
                current: runner.scriptProgress.currentStatementIndex + 1,
                total: runner.scriptProgress.totalStatements
              })}
            </span>
          {/if}
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
          {#if runner.results.length === 1 && runner.results[0].trinoQueryUrl}
            <a
              href={runner.results[0].trinoQueryUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="link link-primary text-xs"
            >
              {m.trino_view_in_trino()}
            </a>
          {/if}
        </div>
      {/if}

      <!-- Results section -->
      <div class="border-base-300 flex items-center border-t px-4 py-2">
        <span class="text-base-content/60 text-sm font-medium">{m.trino_results_label()}</span>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        {#if runner.results.length > 0}
          {#each runner.results as result, idx (idx)}
            {@const stmtPageKey = `${tabStore.activeTabId}-${idx}`}
            {@const stmtPage = currentPages.get(stmtPageKey) ?? 0}
            {@const stmtTotalRows = result.rows.length}
            {@const stmtDisplayedRows = result.rows.slice(
              stmtPage * pageSize,
              (stmtPage + 1) * pageSize
            )}
            {@const stmtHasMore = (stmtPage + 1) * pageSize < stmtTotalRows}
            {@const stmtRowStart = stmtPage * pageSize + 1}
            {@const stmtRowEnd = stmtPage * pageSize + stmtDisplayedRows.length}
            {@const stmtError =
              result.error && !result.error.startsWith('ROW_LIMIT:') ? result.error : null}
            {@const stmtRowLimitError = result.error?.startsWith('ROW_LIMIT:')
              ? m.trino_row_limit_reached({ limit: result.error.split(':')[1] })
              : null}
            {@const showHeader = runner.results.length > 1}
            {@const collapseKey = `${tabStore.activeTabId}-${idx}`}
            {@const isCollapsed = collapsedResults.get(collapseKey) ?? false}
            <div class="border-base-300 border-b last:border-b-0">
              {#if showHeader}
                <button
                  type="button"
                  class="bg-base-200/50 hover:bg-base-200 flex w-full items-center gap-5 px-4 py-2 text-left transition-colors"
                  onclick={() => collapsedResults.set(collapseKey, !isCollapsed)}
                  aria-expanded={!isCollapsed}
                  aria-controls="stmt-result-{tabStore.activeTabId}-{idx}"
                  aria-label={m.trino_statement_collapse({ index: idx + 1 })}
                >
                  <span
                    class="badge badge-sm {result.state === 'FINISHED'
                      ? 'badge-success'
                      : result.state === 'FAILED'
                        ? 'badge-error'
                        : result.state === 'CANCELLED'
                          ? 'badge-neutral'
                          : 'badge-info'}"
                  >
                    {m.trino_statement_header({ index: idx + 1 })}
                  </span>
                  {#if result.trinoQueryUrl}
                    <a
                      href={result.trinoQueryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="link link-primary text-xs"
                      onclick={(e) => e.stopPropagation()}
                    >
                      {m.trino_view_in_trino()}
                    </a>
                  {/if}
                  <code class="text-base-content/60 max-w-md truncate text-xs">
                    {result.sql.length > 80 ? result.sql.slice(0, 80) + '…' : result.sql}
                  </code>
                  {#if stmtTotalRows > 0}
                    <span class="text-base-content/40 ml-auto text-xs">
                      {m.trino_rows_range({
                        start: stmtRowStart,
                        end: stmtRowEnd,
                        total: stmtTotalRows
                      })}
                    </span>
                  {/if}
                </button>
              {/if}
              <div
                id="stmt-result-{tabStore.activeTabId}-{idx}"
                class="{showHeader ? 'px-4 py-2' : 'p-4'} {isCollapsed ? 'hidden' : ''}"
              >
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
                        ? `${m.trino_results_label()} — ${m.trino_statement_header({ index: idx + 1 })}`
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
                        {#each stmtDisplayedRows as row, rowIdx (rowIdx)}
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
                  {#if stmtRowLimitError}
                    <span class="text-warning mt-1 block text-xs">{stmtRowLimitError}</span>
                  {/if}
                  {#if stmtTotalRows > pageSize}
                    <div class="flex items-center justify-between pt-2">
                      <div class="join">
                        <button
                          class="btn btn-xs join-item"
                          onclick={() => currentPages.set(stmtPageKey, Math.max(0, stmtPage - 1))}
                          disabled={stmtPage === 0}
                          aria-label={m.trino_prev_page()}
                        >
                          ‹
                        </button>
                        <button
                          class="btn btn-xs join-item"
                          onclick={() => {
                            if (stmtHasMore) currentPages.set(stmtPageKey, stmtPage + 1);
                          }}
                          disabled={!stmtHasMore}
                          aria-label={m.trino_next_page()}
                        >
                          ›
                        </button>
                      </div>
                      <span class="text-base-content/40 text-xs">
                        {m.trino_rows_range({
                          start: stmtRowStart,
                          end: stmtRowEnd,
                          total: stmtTotalRows
                        })}
                      </span>
                      <div class="flex items-center gap-2">
                        <label
                          for="{uid}-page-size-{idx}"
                          class="text-base-content/60 text-xs whitespace-nowrap"
                        >
                          {m.trino_page_size()}
                        </label>
                        <select
                          id="{uid}-page-size-{idx}"
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
                  {/if}
                {:else if result.state === 'FINISHED' && result.columns.length === 0}
                  <p class="text-base-content/40 py-2 text-sm">{m.trino_results_empty()}</p>
                {/if}
              </div>
            </div>
          {/each}
        {:else if !isActive}
          <p class="text-base-content/40 py-8 text-center text-sm">{m.trino_results_empty()}</p>
        {/if}
      </div>
    </div>
  </div>
</div>
