<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import StorageBreadcrumb from './StorageBreadcrumb.svelte';
  import ObjectTable from './ObjectTable.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import type { StoragePage } from '$lib/storage/types.js';
  import { SvelteSet } from 'svelte/reactivity';

  import Icon from '@iconify/svelte';
  import { browser } from '$app/environment';
  import { ALLOWED_PAGE_SIZES, isPageSize, type PageSize } from '$lib/types/pagination.js';

  interface Props {
    bucket: string;
    objects: StoragePage;
    prefix: string;
    onnavigate: (
      prefix: string,
      continuationToken?: string | null,
      pageSize?: number | null
    ) => void;
  }

  let { bucket, objects, prefix, onnavigate }: Props = $props();

  // ── Derived folder/file lists ─────────────────────────────────────────────
  const folders = $derived(objects.objects.filter((o) => o.isDirectory));
  const files = $derived(objects.objects.filter((o) => !o.isDirectory));

  // ── Selection state ───────────────────────────────────────────────────────
  let selectedKeys = $state<Set<string>>(new Set<string>());
  let selectionMode = $state(false);

  // Stack of previous continuation tokens for deterministic "Prev" navigation.
  let prevTokens = $state<(string | null)[]>([]);

  const STORAGE_KEY = 'storage_page_size';

  function initPageSize(): PageSize {
    if (!browser) return 25;
    const stored = parseInt(localStorage.getItem(STORAGE_KEY) ?? '', 10);
    return isPageSize(stored) ? stored : 25;
  }

  let pageSize = $state<PageSize>(initPageSize());

  function handlePageSizeChange(event: Event) {
    const n = parseInt((event.target as HTMLSelectElement).value, 10);
    if (isPageSize(n)) {
      pageSize = n;
      prevTokens = [];
      if (browser) localStorage.setItem(STORAGE_KEY, String(n));
      goFirst();
    }
  }

  // Clear selection on navigation
  $effect(() => {
    void prefix;
    selectedKeys = new SvelteSet<string>();
  });

  function toggleSelectionMode() {
    selectionMode = !selectionMode;
    if (!selectionMode) selectedKeys = new SvelteSet<string>();
  }

  function toggleSelect(key: string, force = false) {
    if (force || selectionMode) {
      const next = new SvelteSet<string>(selectedKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      selectedKeys = next;
    } else {
      selectedKeys = new SvelteSet<string>([key]);
    }
  }

  function selectAll(checked: boolean) {
    if (checked) {
      selectedKeys = new SvelteSet<string>([
        ...folders.map((f) => f.key),
        ...files.map((f) => f.key)
      ]);
    } else {
      selectedKeys = new SvelteSet<string>();
    }
  }

  const totalItemCount = $derived(folders.length + files.length);
  const allSelected = $derived(totalItemCount > 0 && selectedKeys.size >= totalItemCount);
  const someSelected = $derived(selectedKeys.size > 0 && selectedKeys.size < totalItemCount);
  const showCheckboxes = $derived(selectionMode || selectedKeys.size > 0);

  const selectedFiles = $derived(files.filter((f) => selectedKeys.has(f.key)));
  const selectedFolders = $derived(folders.filter((f) => selectedKeys.has(f.key)));
  // TODO: This resolves once a modal for confirming deletion is implemented.
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  const deleteCount = $derived(selectedFiles.length + selectedFolders.length);

  const canGoPrev = $derived(prevTokens.length > 0);
  const canGoFirst = $derived(prevTokens.length > 0 || objects.continuationToken);
  const canGoNext = $derived(objects.hasNextPage);
  const currentPage = $derived(prevTokens.length + 1);

  // ── Loading state ─────────────────────────────────────────────────────────
  let loading = $state(false);

  // Clear loading when new objects arrive from the server
  $effect(() => {
    void objects;
    loading = false;
  });

  function handleNavigate(prefix: string) {
    loading = true;
    prevTokens = [];
    onnavigate(prefix, null, pageSize);
  }

  function handlePageNavigate(token: string | null) {
    // push current page token so we can go back deterministically
    prevTokens = [...prevTokens, objects.continuationToken ?? null];
    loading = true;
    onnavigate(prefix, token, pageSize);
  }

  function goFirst() {
    prevTokens = [];
    loading = true;
    onnavigate(prefix, null, pageSize);
  }

  function goPrev() {
    const copy = [...prevTokens];
    const last = copy.pop() ?? null;
    prevTokens = copy;
    loading = true;
    onnavigate(prefix, last, pageSize);
  }

  // ── Context menu ──────────────────────────────────────────────────────────
  let ctxMenu = $state<{ x: number; y: number } | null>(null);

  let ctxKey = $state<string | null>(null);

  function openContextMenu(e: MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    ctxKey = key;
    ctxMenu = { x: e.clientX, y: e.clientY };
  }

  // ── Modal state ───────────────────────────────────────────────────────────
  let showDeleteModal = $state(false);

  // ── Action dispatch ───────────────────────────────────────────────────────
  function handleAction(action: string) {
    switch (action) {
      case 'preview':
        alert(m.storage_action_preview() + ' — not implemented');
        break;
      case 'rename':
        alert(m.storage_action_rename() + ' — not implemented');
        break;
      case 'download':
        alert(m.storage_action_download() + ' — not implemented');
        break;
      case 'move':
        alert(m.storage_action_move() + ' — not implemented');
        break;
      case 'delete':
        alert(m.storage_action_delete() + ' — not implemented');
        break;
      default:
        alert(`${action} — not implemented`);
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (showDeleteModal) return;
    if (e.key === 'Delete' && selectedKeys.size > 0) showDeleteModal = true;
    else if (e.key === 'F2' && selectedKeys.size === 1) handleAction('rename');
    else if (e.key === 'Escape') selectedKeys = new SvelteSet<string>();
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="bg-base-100 flex flex-1 flex-col overflow-hidden"
  onclick={(e) => {
    if (!(e.target as HTMLElement).closest('tr')) selectedKeys = new SvelteSet<string>();
  }}
>
  <StorageBreadcrumb
    {bucket}
    {prefix}
    folderCount={folders.length}
    fileCount={files.length}
    {selectionMode}
    onnavigate={handleNavigate}
    onToggleSelectionMode={toggleSelectionMode}
  />

  <div class="relative flex-1 overflow-y-auto">
    {#if loading}
      <div
        class="
          bg-base-100/70 absolute inset-0 z-10 flex items-center justify-center
        "
        aria-live="polite"
        aria-label={m.storage_loading()}
      >
        <span class="loading loading-md loading-spinner text-primary" aria-hidden="true"></span>
      </div>
    {/if}
    <ObjectTable
      {prefix}
      {folders}
      {files}
      {selectedKeys}
      {ctxKey}
      {showCheckboxes}
      {allSelected}
      {someSelected}
      onnavigate={handleNavigate}
      onSelectAll={selectAll}
      onToggleSelect={toggleSelect}
      onContextMenu={openContextMenu}
      onaction={handleAction}
    />
  </div>

  <!-- Fixed pagination bar at bottom -->
  <div
    class="border-base-200/40 bg-base-100 sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t px-4 py-3"
  >
    <label for="storage-page-size" class="text-base-content/60 mr-2 text-xs"
      >{m.storage_page_size()}</label
    >
    <select
      id="storage-page-size"
      class="select select-xs mr-4 w-14 px-1"
      value={pageSize}
      onchange={handlePageSizeChange}
    >
      {#each ALLOWED_PAGE_SIZES as size (size)}
        <option value={size}>{size}</option>
      {/each}
    </select>
    <span class="text-base-content/60 mr-2 text-xs">{`${m.storage_page()} ${currentPage}`}</span>
    <button
      class="btn btn-ghost btn-sm"
      onclick={goFirst}
      disabled={!canGoFirst}
      aria-label={m.storage_first_page()}
      title={m.storage_first_page()}
    >
      <Icon
        icon="material-symbols:first-page"
        class={'size-4 ' + (canGoFirst ? '' : 'opacity-40')}
        aria-hidden="true"
      />
    </button>

    <button
      class="btn btn-ghost btn-sm"
      onclick={goPrev}
      disabled={!canGoPrev}
      aria-label={m.storage_previous_page()}
      title={m.storage_previous_page()}
    >
      <Icon
        icon="material-symbols:chevron-left"
        class={'size-4 ' + (canGoPrev ? '' : 'opacity-40')}
        aria-hidden="true"
      />
    </button>

    <button
      class="btn btn-primary btn-sm"
      onclick={() => handlePageNavigate(objects.nextContinuationToken ?? null)}
      disabled={!canGoNext}
      aria-label={m.storage_next_page()}
      title={m.storage_next_page()}
    >
      <Icon
        icon="material-symbols:chevron-right"
        class={'size-4 ' + (canGoNext ? '' : 'opacity-40')}
        aria-hidden="true"
      />
    </button>
  </div>
</div>

<!-- Context menu -->
{#if ctxMenu}
  <ContextMenu
    x={ctxMenu.x}
    y={ctxMenu.y}
    selectionCount={selectedKeys.size}
    canPreview={selectedFiles.length === 1 && selectedFolders.length === 0}
    canDownload={selectedFiles.length > 0}
    onaction={handleAction}
    onclose={() => {
      ctxMenu = null;
      ctxKey = null;
    }}
  />
{/if}
