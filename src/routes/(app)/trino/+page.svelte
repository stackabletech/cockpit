<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
  import { superForm } from 'sveltekit-superforms';
  import type { PageData } from './$types';
  import type { FormMessage } from './schemas.js';

  let { data }: { data: PageData } = $props();
  const queryFormData = $derived(data.queryForm);
  const paginateFormData_ = $derived(data.paginateForm);

  const uid = $props.id();
  const PAGE_SIZES = [25, 50, 100];

  function ls(key: string, fallback: string): string {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  // Connection config and SQL — local state persisted to localStorage.
  let connectionUrl = $state(ls('trino_url', ''));
  let authType = $state<'none' | 'basic'>(ls('trino_auth_type', 'none') as 'none' | 'basic');
  let authUsername = $state(ls('trino_username', ''));
  let authPassword = $state(ls('trino_password', ''));
  let sql = $state(ls('trino_sql', 'SELECT 1'));
  let pageSize = $state<25 | 50 | 100>(25);

  // Query result state — updated from form messages.
  let columns = $state<{ name: string; type: string }[]>([]);
  let rows = $state<unknown[][]>([]);
  let queryError = $state<string | null>(null);
  let currentPage = $state(0);
  let hasMore = $state(false);
  let queryId = $state<string | null>(null);
  let totalRows = $state<number | null>(null);
  let connectionOpen = $state(false);

  // Query form — submits connection config + SQL as hidden inputs (FormData).
  const {
    enhance: queryEnhance,
    submitting: querySubmitting,
    errors: queryErrors
  } = superForm(queryFormData, {
    onSubmit() {
      queryError = null;
      columns = [];
      rows = [];
      queryId = null;
      totalRows = null;
      currentPage = 0;
      connectionOpen = false;
    },
    onUpdated({ form }) {
      // Validation errors for connection fields — open the section so the user can see them.
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
        queryError = msg.message === 'session_expired' ? m.trino_session_expired() : msg.message;
      }
    }
  });

  // Paginate form — submits as JSON so store values are used directly.
  const {
    form: paginateFormData,
    enhance: paginateEnhance,
    submitting: paginateSubmitting
  } = superForm(paginateFormData_, {
    dataType: 'json',
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
        queryError = msg.message === 'session_expired' ? m.trino_session_expired() : msg.message;
        if (msg.message === 'session_expired') queryId = null;
      }
    }
  });

  const running = $derived($querySubmitting || $paginateSubmitting);

  // Persist connection config; invalidate queryId on change.
  $effect(() => {
    localStorage.setItem('trino_url', connectionUrl);
    localStorage.setItem('trino_auth_type', authType);
    localStorage.setItem('trino_username', authUsername);
    localStorage.setItem('trino_password', authPassword);
    queryId = null;
  });

  // Persist SQL.
  $effect(() => {
    localStorage.setItem('trino_sql', sql);
  });

  const connectionSummary = $derived.by(() => {
    const host = connectionUrl ? connectionUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : '—';
    const auth = authType === 'basic' ? m.trino_auth_basic() : m.trino_auth_none();
    return `${host} · ${auth}`;
  });

  const rowStart = $derived(currentPage * pageSize + 1);
  const rowEnd = $derived(currentPage * pageSize + rows.length);

  let queryFormEl = $state<HTMLFormElement | undefined>(undefined);
  let paginateFormEl = $state<HTMLFormElement | undefined>(undefined);

  function goToPrevPage() {
    const prevPage = currentPage - 1;
    $paginateFormData.queryId = queryId!;
    $paginateFormData.page = prevPage;
    $paginateFormData.pageSize = pageSize;
    currentPage = prevPage;
    paginateFormEl?.requestSubmit();
  }

  function goToNextPage() {
    const nextPage = currentPage + 1;
    $paginateFormData.queryId = queryId!;
    $paginateFormData.page = nextPage;
    $paginateFormData.pageSize = pageSize;
    currentPage = nextPage;
    paginateFormEl?.requestSubmit();
  }

  function handlePageSizeChange(event: Event) {
    pageSize = parseInt((event.target as HTMLSelectElement).value, 10) as 25 | 50 | 100;
    if (queryId) {
      $paginateFormData.queryId = queryId;
      $paginateFormData.page = 0;
      $paginateFormData.pageSize = pageSize;
      currentPage = 0;
      paginateFormEl?.requestSubmit();
    }
  }
</script>

<div class="flex h-full flex-col gap-4">
  <!-- Query form: wraps connection config + editor -->
  <form method="POST" action="?/query" use:queryEnhance bind:this={queryFormEl}>
    <!-- Hidden inputs carry localStorage state to the server action -->
    <input type="hidden" name="sql" value={sql} />
    <input type="hidden" name="pageSize" value={pageSize} />
    <input type="hidden" name="connectionUrl" value={connectionUrl} />
    <input type="hidden" name="authType" value={authType} />
    <input type="hidden" name="authUsername" value={authUsername} />
    <input type="hidden" name="authPassword" value={authPassword} />

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
            bind:value={connectionUrl}
            onkeydown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
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
                onkeydown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
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
                onkeydown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
              />
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Editor section -->
    <div class="bg-base-100 border-base-300 mt-4 flex flex-col rounded-xl border">
      <div class="border-base-300 flex items-center justify-between border-b px-4 py-2">
        <span class="text-base-content/60 text-sm font-medium">{m.trino_editor_label()}</span>
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
            <kbd class="kbd kbd-sm text-base-content opacity-60">Ctrl+↵</kbd>
          {/if}
        </button>
      </div>
      <div class="h-64">
        <MonacoEditor
          bind:value={sql}
          language="sql"
          onExecute={() => queryFormEl?.requestSubmit()}
        />
      </div>
    </div>
  </form>

  <!-- Hidden paginate form — buttons in the results section submit this via requestSubmit(). -->
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
            ‹
          </button>
          <button
            class="btn btn-sm join-item"
            onclick={goToNextPage}
            disabled={!hasMore || running}
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
