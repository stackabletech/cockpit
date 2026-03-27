<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import * as m from '$lib/paraglide/messages.js';
  import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
  import CatalogBrowser from '$lib/components/catalog/CatalogBrowser.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { superForm } from 'sveltekit-superforms';
  import type { PageData } from './$types';
  import type { ConnectionMessage } from './validation.js';
  import { queryRunner } from './query-runner.svelte.js';
  import { ALLOWED_PAGE_SIZES } from './validation';
  import { isTerminal } from '$lib/types/query';

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

  let sql = $state('SELECT 1');
  let pageSize = $state<25 | 50 | 100>(25);
  let defaultCatalog = $state('');
  let defaultSchema = $state('');
  let currentPage = $state(0);
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

  onMount(() => {
    if (!data.trinoConfigured) {
      connectionUrl = getStoredValue('trino_url', '');
      authType = getStoredValue('trino_auth_type', 'none') as 'none' | 'basic';
      authUsername = getStoredValue('trino_username', '');
      // Remove any previously stored password (no longer persisted for security).
      localStorage.removeItem('trino_password');
    }
    sql = getStoredValue('trino_sql', 'SELECT 1');
    defaultCatalog = getStoredValue('trino_default_catalog', '');
    defaultSchema = getStoredValue('trino_default_schema', '');
    const storedPageSize = parseInt(getStoredValue('trino_page_size', '25'), 10);
    pageSize = ALLOWED_PAGE_SIZES.includes(storedPageSize as 25 | 50 | 100)
      ? (storedPageSize as 25 | 50 | 100)
      : 25;
    hydrated = true;

    if (data.trinoConfigured) {
      // Server already provisioned the connection; bump version so catalog browser loads.
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

    // Resume active query from server-side state (survives page reloads).
    queryRunner.initialise(data.activeQuery);
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

  const isActive = $derived(queryRunner.state !== 'IDLE' && !isTerminal(queryRunner.state));

  // Persist connection config to localStorage (only in per-user mode).
  // Password is intentionally excluded -- credentials should not be stored client-side.
  $effect(() => {
    if (!hydrated || data.trinoConfigured) return;
    localStorage.setItem('trino_url', connectionUrl);
    localStorage.setItem('trino_auth_type', authType);
    localStorage.setItem('trino_username', authUsername);
  });

  // Persist SQL and other settings.
  $effect(() => {
    if (!hydrated) return;
    localStorage.setItem('trino_sql', sql);
    localStorage.setItem('trino_page_size', String(pageSize));
    localStorage.setItem('trino_default_catalog', defaultCatalog);
    localStorage.setItem('trino_default_schema', defaultSchema);
    localStorage.setItem('trino_catalog_browser_open', String(catalogBrowserOpen));
  });

  // Reset pagination when rows change.
  let prevRowCount = $state(0);
  $effect(() => {
    const count = queryRunner.rows.length;
    if (count !== prevRowCount && count > 0 && prevRowCount === 0) {
      currentPage = 0;
    }
    prevRowCount = count;
  });

  const connectionSummary = $derived.by(() => {
    const host = connectionUrl ? connectionUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : '-';
    const auth = authType === 'basic' ? m.trino_auth_basic() : m.trino_auth_none();
    return `${host} \u00b7 ${auth}`;
  });

  const totalRows = $derived(queryRunner.rows.length);
  const displayedRows = $derived(
    queryRunner.rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
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
    return stateMap[queryRunner.state]?.() ?? null;
  });

  const stateBadgeClass = $derived.by(() => {
    switch (queryRunner.state) {
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
    if (queryRunner.error?.startsWith('ROW_LIMIT:')) {
      const limit = queryRunner.error.split(':')[1];
      return m.trino_row_limit_reached({ limit });
    }
    return null;
  });

  const queryError = $derived.by(() => {
    if (!queryRunner.error) return null;
    if (queryRunner.error.startsWith('ROW_LIMIT:')) return null;
    return queryRunner.error;
  });

  function handleExecute() {
    currentPage = 0;
    queryRunner.execute(sql, {
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
    currentPage = Math.max(0, currentPage - 1);
  }

  function goToNextPage() {
    if (hasMore) currentPage += 1;
  }

  function handlePageSizeChange(event: Event) {
    pageSize = parseInt((event.target as HTMLSelectElement).value, 10) as 25 | 50 | 100;
    currentPage = 0;
  }

  function toggleCatalogBrowser() {
    if (browser && !window.matchMedia('(min-width: 1024px)').matches) {
      mobileCatalogOpen = !mobileCatalogOpen;
    } else {
      catalogBrowserOpen = !catalogBrowserOpen;
    }
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
  <div class="flex min-w-0 flex-1 flex-col gap-4">
    <!-- Connection config form (hidden when Trino is env-configured) -->
    {#if !data.trinoConfigured}
      <form method="POST" action="?/save" use:connectionEnhance>
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
                    autocomplete="username"
                    bind:value={authUsername}
                  />
                </div>
                <div class="flex flex-col gap-1">
                  <label for="{uid}-auth-password" class="label text-sm">
                    {m.trino_auth_password()}
                  </label>
                  <input
                    id="{uid}-auth-password"
                    type="password"
                    class="input input-sm font-mono"
                    autocomplete="current-password"
                    bind:value={authPassword}
                  />
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

    <!-- Editor section -->
    <div class="bg-base-100 border-base-300 flex flex-col rounded-xl border">
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
              onclick={() => queryRunner.cancel()}
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
      <div class="h-64">
        <MonacoEditor bind:this={monacoEditor} bind:value={sql} onExecute={handleExecute} />
      </div>
    </div>

    <!-- Status display -->
    {#if queryRunner.state !== 'IDLE'}
      <div
        class="flex flex-wrap items-center gap-3 px-1"
        aria-live="polite"
        data-query-state={queryRunner.state}
      >
        {#if stateLabel}
          <span class="badge {stateBadgeClass}">{stateLabel}</span>
        {/if}
        {#if queryRunner.state === 'RUNNING'}
          <span class="text-base-content/60 text-xs tabular-nums"
            >{Math.round(queryRunner.progress.progressPercentage)}%</span
          >
          <progress
            class="progress progress-primary shrink-0"
            style="width: 8rem"
            value={queryRunner.progress.progressPercentage}
            max="100"
          ></progress>
        {/if}
        {#if queryRunner.progress.processedRows > 0 || queryRunner.progress.elapsedTimeMillis > 0}
          <span class="text-base-content/60 text-xs">
            {m.trino_progress_info({
              rows: queryRunner.progress.processedRows.toLocaleString(),
              elapsed: (queryRunner.progress.elapsedTimeMillis / 1000).toFixed(1)
            })}
          </span>
        {/if}
        {#if queryRunner.trinoQueryUrl}
          <a
            href={queryRunner.trinoQueryUrl}
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
    <div class="bg-base-100 border-base-300 flex min-h-0 flex-1 flex-col rounded-xl border">
      <div class="border-base-300 flex items-center border-b px-4 py-2">
        <span class="text-base-content/60 text-sm font-medium">{m.trino_results_label()}</span>
        {#if queryRunner.state === 'FINISHED' && displayedRows.length > 0 && totalRows > 0}
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
        {:else if queryRunner.state === 'FINISHED' && queryRunner.columns.length > 0}
          <div class="overflow-x-auto">
            <table class="table-sm table-zebra table" aria-label={m.trino_results_label()}>
              <thead>
                <tr>
                  {#each queryRunner.columns as col (col.name)}
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

      {#if queryRunner.state === 'FINISHED' && queryRunner.columns.length > 0}
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
