<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import * as m from '$lib/paraglide/messages.js';
  import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
  import CatalogBrowser from '$lib/components/catalog/CatalogBrowser.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { superForm } from 'sveltekit-superforms';
  import type { PageData } from './$types';
  import type { FormMessage } from './schemas.js';

  let { data }: { data: PageData } = $props();

  const uid = $props.id();
  const PAGE_SIZES = [25, 50, 100];

  /** Translate known error codes, pass through other messages as-is. */
  function translateError(errorMessage: string): string {
    if (errorMessage === 'session_expired') return m.trino_session_expired();
    return errorMessage;
  }

  function getStoredValue(key: string, fallback: string): string {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

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

  // Query result state — updated from form messages.
  let columns = $state<{ name: string; type: string }[]>([]);
  let rows = $state<unknown[][]>([]);
  let queryError = $state<string | null>(null);
  let currentPage = $state(0);
  let hasMore = $state(false);
  let queryId = $state<string | null>(null);
  let totalRows = $state<number | null>(null);
  let connectionOpen = $state(false);

  // Connection fingerprint used when the last query ran — null until first query.
  let queriedConnKey = $state<string | null>(null);

  // Query form
  const {
    form: queryFormData,
    enhance: queryEnhance,
    submitting: querySubmitting,
    errors: queryErrors
  } = superForm(data.queryForm, {
    dataType: 'json',
    invalidateAll: false,
    resetForm: false,
    onSubmit() {
      queryError = null;
      columns = [];
      rows = [];
      queryId = null;
      totalRows = null;
      currentPage = 0;
      queriedConnKey = connKey;
    },
    onUpdated({ form }) {
      if (form.errors.connectionUrl) {
        connectionOpen = true;
        queryError = m.trino_connection_error();
        return;
      }
      const msg = form.message as FormMessage | undefined;
      if (!msg) return;
      if (msg.type === 'result') {
        queryId = msg.queryId;
        columns = msg.columns;
        rows = msg.rows;
        hasMore = msg.hasMore;
        totalRows = msg.totalRows;
      } else {
        queryError = translateError(msg.message);
      }
    }
  });

  // Paginate form
  const {
    form: paginateFormData,
    enhance: paginateEnhance,
    submitting: paginateSubmitting
  } = superForm(data.paginateForm, {
    dataType: 'json',
    invalidateAll: false,
    onUpdated({ form }) {
      const msg = form.message as FormMessage | undefined;
      if (!msg) return;
      if (msg.type === 'result') {
        columns = msg.columns;
        rows = msg.rows;
        hasMore = msg.hasMore;
        totalRows = msg.totalRows;
        queryError = null;
      } else {
        queryError = translateError(msg.message);
        if (msg.message === 'session_expired') queryId = null;
      }
    }
  });

  let hydrated = $state(false);

  onMount(() => {
    $queryFormData.connectionUrl = getStoredValue('trino_url', '');
    $queryFormData.authType = getStoredValue('trino_auth_type', 'none') as 'none' | 'basic';
    $queryFormData.authUsername = getStoredValue('trino_username', '');
    $queryFormData.authPassword = getStoredValue('trino_password', '');
    $queryFormData.impersonation = getStoredValue('trino_impersonation', 'false') === 'true';
    $queryFormData.sql = getStoredValue('trino_sql', 'SELECT 1');
    $queryFormData.defaultCatalog = getStoredValue('trino_default_catalog', '');
    $queryFormData.defaultSchema = getStoredValue('trino_default_schema', '');
    const storedPageSize = parseInt(getStoredValue('trino_page_size', '25'), 10);
    $queryFormData.pageSize = PAGE_SIZES.includes(storedPageSize) ? storedPageSize : 25;
    hydrated = true;
  });

  const running = $derived($querySubmitting || $paginateSubmitting);

  const connKey = $derived.by(() => {
    const { connectionUrl, authType, authUsername, impersonation } = $queryFormData;
    return [connectionUrl, authType, authUsername, impersonation].join('|');
  });

  // Invalidate results when connection settings change after a query.
  $effect(() => {
    const key = connKey;
    if (queriedConnKey && key !== queriedConnKey) {
      columns = [];
      rows = [];
      queryError = null;
      queryId = null;
      totalRows = null;
      currentPage = 0;
      hasMore = false;
      queriedConnKey = null;
    }
  });

  // Persist connection config & SQL.
  $effect(() => {
    const {
      connectionUrl,
      authType,
      authUsername,
      authPassword,
      impersonation,
      sql,
      pageSize,
      defaultCatalog,
      defaultSchema
    } = $queryFormData;

    if (!hydrated) return;

    localStorage.setItem('trino_url', connectionUrl);
    localStorage.setItem('trino_auth_type', authType);
    localStorage.setItem('trino_username', authUsername);
    localStorage.setItem('trino_password', authPassword);
    localStorage.setItem('trino_impersonation', String(impersonation));
    localStorage.setItem('trino_sql', sql);
    localStorage.setItem('trino_page_size', String(pageSize));
    localStorage.setItem('trino_default_catalog', defaultCatalog);
    localStorage.setItem('trino_default_schema', defaultSchema);
    localStorage.setItem('trino_catalog_browser_open', String(catalogBrowserOpen));
  });

  const connectionSummary = $derived.by(() => {
    const host = $queryFormData.connectionUrl
      ? $queryFormData.connectionUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
      : '—';
    const auth = $queryFormData.authType === 'basic' ? m.trino_auth_basic() : m.trino_auth_none();
    return `${host} · ${auth}`;
  });

  const rowStart = $derived(currentPage * $queryFormData.pageSize + 1);
  const rowEnd = $derived(currentPage * $queryFormData.pageSize + rows.length);

  let queryFormEl = $state<HTMLFormElement | undefined>(undefined);
  let paginateFormEl = $state<HTMLFormElement | undefined>(undefined);

  function handleKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      queryFormEl?.requestSubmit();
    }
  }

  function goToPrevPage() {
    const prevPage = currentPage - 1;
    $paginateFormData.queryId = queryId!;
    $paginateFormData.page = prevPage;
    $paginateFormData.pageSize = $queryFormData.pageSize;
    currentPage = prevPage;
    paginateFormEl?.requestSubmit();
  }

  function goToNextPage() {
    const nextPage = currentPage + 1;
    $paginateFormData.queryId = queryId!;
    $paginateFormData.page = nextPage;
    $paginateFormData.pageSize = $queryFormData.pageSize;
    currentPage = nextPage;
    paginateFormEl?.requestSubmit();
  }

  function handlePageSizeChange(event: Event) {
    const size = parseInt((event.target as HTMLSelectElement).value, 10) as 25 | 50 | 100;
    $queryFormData.pageSize = size;
    if (queryId) {
      $paginateFormData.queryId = queryId;
      $paginateFormData.page = 0;
      $paginateFormData.pageSize = size;
      currentPage = 0;
      paginateFormEl?.requestSubmit();
    }
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
        connectionUrl={$queryFormData.connectionUrl}
        authType={$queryFormData.authType}
        authUsername={$queryFormData.authUsername}
        authPassword={$queryFormData.authPassword}
        impersonation={$queryFormData.impersonation}
        bind:defaultCatalog={$queryFormData.defaultCatalog}
        bind:defaultSchema={$queryFormData.defaultSchema}
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
        connectionUrl={$queryFormData.connectionUrl}
        authType={$queryFormData.authType}
        authUsername={$queryFormData.authUsername}
        authPassword={$queryFormData.authPassword}
        impersonation={$queryFormData.impersonation}
        bind:defaultCatalog={$queryFormData.defaultCatalog}
        bind:defaultSchema={$queryFormData.defaultSchema}
        onInsert={(name) => {
          monacoEditor?.insertAtCursor(name);
          mobileCatalogOpen = false;
        }}
      />
    </div>
  </Modal>

  <!-- Main editor + results column -->
  <div class="flex min-w-0 flex-1 flex-col gap-4">
    <form method="POST" action="?/query" use:queryEnhance bind:this={queryFormEl}>
      <!-- Connection config section -->
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
              class:input-error={$queryErrors.connectionUrl}
              placeholder={m.trino_connection_url_placeholder()}
              bind:value={$queryFormData.connectionUrl}
            />
            {#if $queryErrors.connectionUrl}
              <p class="text-error text-xs">{$queryErrors.connectionUrl?.join(' ')}</p>
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
                bind:group={$queryFormData.authType}
              />
              <input
                id="{uid}-auth-basic"
                class="join-item btn btn-sm"
                type="radio"
                name="{uid}-auth"
                aria-label={m.trino_auth_basic()}
                value="basic"
                bind:group={$queryFormData.authType}
              />
            </div>
          </div>

          <!-- Basic auth credentials -->
          {#if $queryFormData.authType === 'basic'}
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
                  bind:value={$queryFormData.authUsername}
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
                  bind:value={$queryFormData.authPassword}
                />
              </div>
            </div>
          {/if}

          <!-- User impersonation -->
          {#if data.user?.username}
            <div class="flex items-center gap-3">
              <input
                id="{uid}-impersonation"
                type="checkbox"
                class="toggle toggle-sm"
                bind:checked={$queryFormData.impersonation}
              />
              <label for="{uid}-impersonation" class="flex flex-col">
                <span class="text-sm">{m.trino_impersonation()}</span>
                <span class="text-base-content/50 text-xs">
                  {m.trino_impersonation_description({ user: data.user.username })}
                </span>
              </label>
            </div>
          {/if}
        </div>
      </div>

      <!-- Editor section -->
      <div class="bg-base-100 border-base-300 mt-4 flex flex-col rounded-xl border">
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
          <button
            type="submit"
            class="btn btn-primary btn-sm"
            disabled={running}
            aria-label={m.trino_run_query()}
          >
            {#if running}
              <span class="loading loading-spinner loading-xs"></span>
              {m.trino_running()}
            {:else}
              {m.trino_run_query()}
              <kbd class="kbd kbd-sm text-base-content/60">Ctrl+↵</kbd>
            {/if}
          </button>
        </div>
        <div class="h-64">
          <MonacoEditor
            bind:this={monacoEditor}
            bind:value={$queryFormData.sql}
            onExecute={() => queryFormEl?.requestSubmit()}
          />
        </div>
      </div>
    </form>

    <!-- Hidden paginate form -->
    <form
      method="POST"
      action="?/paginate"
      use:paginateEnhance
      bind:this={paginateFormEl}
      class="sr-only"
      aria-hidden="true"
    >
      <button type="submit">{m.trino_next_page()}</button>
    </form>

    <!-- Results section -->
    <div class="bg-base-100 border-base-300 flex min-h-0 flex-1 flex-col rounded-xl border">
      <div class="border-base-300 flex items-center border-b px-4 py-2">
        <span class="text-base-content/60 text-sm font-medium">{m.trino_results_label()}</span>
        {#if rows.length > 0 && totalRows !== null}
          <span class="text-base-content/40 ml-2 text-xs">
            {m.trino_rows_range({ start: rowStart, end: rowEnd, total: totalRows })}
          </span>
        {/if}
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        {#if queryError}
          <div class="alert alert-error" role="alert">
            <svg
              class="h-5 w-5 shrink-0"
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4m0 4h.01" />
            </svg>
            <div>
              <p class="font-semibold">{m.trino_query_error()}</p>
              <p class="text-sm opacity-80">{queryError}</p>
            </div>
          </div>
        {:else if columns.length > 0}
          <div class="overflow-x-auto" class:opacity-50={running}>
            <table class="table-sm table-zebra table" aria-label={m.trino_results_label()}>
              <thead>
                <tr>
                  {#each columns as col (col.name)}
                    <th scope="col" class="whitespace-nowrap">{col.name}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each rows as row, rowIdx (rowIdx)}
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
        {:else if !running}
          <p class="text-base-content/40 py-8 text-center text-sm">{m.trino_results_empty()}</p>
        {/if}
      </div>

      {#if columns.length > 0}
        <div class="border-base-300 flex items-center justify-between border-t px-4 py-3">
          <div class="join">
            <button
              class="btn btn-sm join-item"
              onclick={goToPrevPage}
              disabled={currentPage === 0 || running}
              aria-label={m.trino_prev_page()}
            >
              <svg
                class="h-4 w-4"
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><path d="m15 5-7 7 7 7" /></svg
              >
            </button>
            <button
              class="btn btn-sm join-item"
              onclick={goToNextPage}
              disabled={!hasMore || running}
              aria-label={m.trino_next_page()}
            >
              <svg
                class="h-4 w-4"
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"><path d="m9 5 7 7-7 7" /></svg
              >
            </button>
          </div>

          <div class="flex items-center gap-3">
            <label for="{uid}-page-size" class="text-base-content/60 text-sm whitespace-nowrap">
              {m.trino_page_size()}
            </label>
            <select
              id="{uid}-page-size"
              class="select select-sm"
              value={$queryFormData.pageSize}
              onchange={handlePageSizeChange}
              disabled={running}
            >
              {#each PAGE_SIZES as size (size)}
                <option value={size}>{size}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
