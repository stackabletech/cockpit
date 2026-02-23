<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';

  const uid = $props.id();

  const PAGE_SIZES = [25, 50, 100];

  function ls(key: string, fallback: string): string {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  let connectionUrl = $state(ls('trino_url', ''));
  let authType = $state<'none' | 'basic'>(ls('trino_auth_type', 'none') as 'none' | 'basic');
  let authUsername = $state(ls('trino_username', ''));
  let authPassword = $state(ls('trino_password', ''));

  let sql = $state(ls('trino_sql', 'SELECT 1'));
  let running = $state(false);
  let columns = $state<{ name: string; type: string }[]>([]);
  let rows = $state<unknown[][]>([]);
  let error = $state<string | null>(null);
  let page = $state(0);
  let pageSize = $state(25);
  let hasMore = $state(false);
  let queryId = $state<string | null>(null);
  let totalRows = $state<number | null>(null);

  let connectionSummary = $derived(() => {
    const host = connectionUrl ? connectionUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : '—';
    const auth = authType === 'basic' ? m.trino_auth_basic() : m.trino_auth_none();
    return `${host} · ${auth}`;
  });

  // Persist connection config and invalidate query cache on change.
  $effect(() => {
    localStorage.setItem('trino_url', connectionUrl);
    localStorage.setItem('trino_auth_type', authType);
    localStorage.setItem('trino_username', authUsername);
    localStorage.setItem('trino_password', authPassword);
    queryId = null;
  });

  // Persist SQL query.
  $effect(() => {
    localStorage.setItem('trino_sql', sql);
  });

  let rowStart = $derived(page * pageSize + 1);
  let rowEnd = $derived(page * pageSize + rows.length);

  function buildConnection() {
    return {
      url: connectionUrl,
      auth:
        authType === 'basic'
          ? { type: 'basic' as const, username: authUsername, password: authPassword }
          : { type: 'none' as const }
    };
  }

  async function fetchResults(isNewQuery: boolean) {
    if (running) return;
    running = true;
    error = null;
    hasMore = false;

    if (isNewQuery) {
      columns = [];
      rows = [];
      queryId = null;
      totalRows = null;
    }

    try {
      const body =
        queryId && !isNewQuery
          ? { queryId, page, pageSize }
          : { sql, page, pageSize, connection: buildConnection() };

      const res = await fetch('/api/trino/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (data.error === 'session_expired') {
        error = m.trino_session_expired();
        queryId = null;
      } else if (data.error) {
        error = data.error;
      } else {
        queryId = data.queryId ?? null;
        columns = data.columns ?? [];
        rows = data.rows ?? [];
        hasMore = data.hasMore ?? false;
        totalRows = data.totalRows ?? null;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      running = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      page = 0;
      fetchResults(true);
    }
  }

  function handleRunClick() {
    page = 0;
    fetchResults(true);
  }

  function goToPrevPage() {
    page -= 1;
    fetchResults(false);
  }

  function goToNextPage() {
    page += 1;
    fetchResults(false);
  }

  function handlePageSizeChange(event: Event) {
    pageSize = parseInt((event.target as HTMLSelectElement).value, 10);
    page = 0;
    fetchResults(false);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-full flex-col gap-4">
  <!-- Connection config section -->
  <div class="bg-base-100 border-base-300 collapse rounded-xl border">
    <input type="checkbox" class="peer" aria-label={m.trino_connection_label()} />
    <div
      class="collapse-title text-base-content flex items-center justify-between pr-4 text-sm font-medium"
    >
      <span>{m.trino_connection_label()}</span>
      <span class="text-base-content/50 font-mono text-xs">{connectionSummary()}</span>
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
          placeholder={m.trino_connection_url_placeholder()}
          bind:value={connectionUrl}
        />
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
    </div>
  </div>

  <!-- Editor section -->
  <div class="bg-base-100 border-base-300 flex flex-col rounded-xl border">
    <div class="border-base-300 flex items-center justify-between border-b px-4 py-2">
      <span class="text-base-content/60 text-sm font-medium">{m.trino_editor_label()}</span>
      <button
        class="btn btn-primary btn-sm"
        onclick={handleRunClick}
        disabled={running}
        aria-label={m.trino_run_query()}
      >
        {#if running}
          <span class="loading loading-spinner loading-xs"></span>
          {m.trino_running()}
        {:else}
          {m.trino_run_query()}
          <kbd class="kbd kbd-sm opacity-60">Ctrl+↵</kbd>
        {/if}
      </button>
    </div>
    <div class="h-64">
      <MonacoEditor bind:value={sql} language="sql" onExecute={handleRunClick} />
    </div>
  </div>

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
      {#if error}
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
            <p class="text-sm opacity-80">{error}</p>
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
            disabled={page === 0 || running}
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
