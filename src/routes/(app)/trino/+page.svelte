<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
  import { superForm } from 'sveltekit-superforms';
  import type { PageData } from './$types';
  import type { ConnectionMessage } from './schemas.js';
  import { queryRunner } from './query-runner.svelte.js';

  let { data }: { data: PageData } = $props();

  const uid = $props.id();
  const PAGE_SIZES = [25, 50, 100] as const;

  function ls(key: string, fallback: string): string {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  // Connection config — local state persisted to localStorage.
  let connectionUrl = $state(ls('trino_url', ''));
  let authType = $state<'none' | 'basic'>(ls('trino_auth_type', 'none') as 'none' | 'basic');
  let authUsername = $state(ls('trino_username', ''));
  let authPassword = $state(ls('trino_password', ''));
  let sql = $state(ls('trino_sql', 'SELECT 1'));
  let pageSize = $state<25 | 50 | 100>(25);
  let connectionOpen = $state(false);
  let currentPage = $state(0);

  // Connection form (SuperForms).
  const {
    enhance: connectionEnhance,
    errors: connectionErrors,
    message: connectionMessage
  } = superForm(data.connectionForm, {
    onUpdated({ form }) {
      const msg = form.message as ConnectionMessage | undefined;
      if (msg?.type === 'error') {
        connectionOpen = true;
      }
    }
  });

  const isActive = $derived.by(() => {
    const s = queryRunner.state;
    return (
      s === 'SUBMITTING' ||
      s === 'QUEUED' ||
      s === 'PLANNING' ||
      s === 'RUNNING' ||
      s === 'FINISHING'
    );
  });

  // Persist connection config to localStorage.
  $effect(() => {
    localStorage.setItem('trino_url', connectionUrl);
    localStorage.setItem('trino_auth_type', authType);
    localStorage.setItem('trino_username', authUsername);
    localStorage.setItem('trino_password', authPassword);
  });

  // Persist SQL.
  $effect(() => {
    localStorage.setItem('trino_sql', sql);
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
    const host = connectionUrl ? connectionUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : '—';
    const auth = authType === 'basic' ? m.trino_auth_basic() : m.trino_auth_none();
    return `${host} · ${auth}`;
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
    queryRunner.execute(sql);
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
</script>

<div class="flex h-full flex-col gap-4">
  <!-- Connection config form -->
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
            onkeydown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
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

  <!-- Editor section (standalone, not a form) -->
  <div class="bg-base-100 border-base-300 flex flex-col rounded-xl border">
    <div class="border-base-300 flex items-center justify-between border-b px-4 py-2">
      <span class="text-base-content/60 text-sm font-medium">{m.trino_editor_label()}</span>
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
      <MonacoEditor bind:value={sql} onExecute={handleExecute} />
    </div>
  </div>

  <!-- Status display -->
  {#if queryRunner.state !== 'IDLE'}
    <div class="flex flex-wrap items-center gap-3 px-1" aria-live="polite">
      {#if stateLabel}
        <span class="badge {stateBadgeClass}">{stateLabel}</span>
      {/if}
      {#if queryRunner.state === 'RUNNING' && queryRunner.progress.progressPercentage > 0}
        <progress
          class="progress progress-primary w-32"
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
      {#if rowLimitError}
        <span class="text-warning text-xs">{rowLimitError}</span>
      {/if}
    </div>
  {/if}

  <!-- Results section -->
  <div class="bg-base-100 border-base-300 flex min-h-0 flex-1 flex-col rounded-xl border">
    <div class="border-base-300 flex items-center border-b px-4 py-2">
      <span class="text-base-content/60 text-sm font-medium">{m.trino_results_label()}</span>
      {#if displayedRows.length > 0 && totalRows > 0}
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
      {:else if queryRunner.columns.length > 0}
        <div class="overflow-x-auto" class:opacity-50={isActive}>
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
      {:else if !isActive && queryRunner.state === 'IDLE'}
        <p class="text-base-content/40 py-8 text-center text-sm">{m.trino_results_empty()}</p>
      {/if}
    </div>

    {#if queryRunner.columns.length > 0}
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
            {#each PAGE_SIZES as size (size)}
              <option value={size}>{size}</option>
            {/each}
          </select>
        </div>
      </div>
    {/if}
  </div>
</div>
