<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import StorageBreadcrumb from './StorageBreadcrumb.svelte';
  import ObjectTable from './ObjectTable.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import PreviewModal from './PreviewModal.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import type { StoragePage } from '$lib/storage/types.js';
  import { SvelteSet } from 'svelte/reactivity';
  import { executeAction } from './actions/index.js';
  import { ActionError } from './actions/types.js';
  import { getActionErrorMessage } from './actions/errors.js';
  import { addToast } from '$lib/stores/toast.svelte.js';

  import { initPageSize, type PageSize } from '$lib/types/pagination.js';

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

  let pageSize = $state<PageSize>(initPageSize(STORAGE_KEY));

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

  const ctxFileObj = $derived(ctxKey ? (files.find((f) => f.key === ctxKey) ?? null) : null);
  const ctxIsFile = $derived(ctxFileObj !== null);

  function openContextMenu(e: MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();

    if (!selectedKeys.has(key)) {
      selectedKeys = selectedKeys.size === 0 ? new SvelteSet<string>([key]) : selectedKeys.add(key);
    }

    ctxKey = key;
    ctxMenu = { x: e.clientX, y: e.clientY };
  }

  // ── Modal state ───────────────────────────────────────────────────────────
  let showDeleteModal = $state(false);
  let showPreviewModal = $state(false);
  let previewKey = $state<string | null>(null);

  // ── Action dispatch ───────────────────────────────────────────────────────

  async function handleAction(action: string) {
    const ctxFile = ctxKey && files.find((f) => f.key === ctxKey) ? ctxKey : null;
    const key = ctxFile ?? selectedFiles[0]?.key;

    // Effective selection for context actions:
    const effectiveSelectedFiles = ctxFile
      ? [files.find((f) => f.key === ctxFile)!]
      : selectedFiles;

    const effectiveSelectedKeys = ctxFile ? [ctxFile] : [...selectedKeys];

    const ctx = {
      bucket,
      key,
      selectedKeys: effectiveSelectedKeys,
      selectedFiles: effectiveSelectedFiles
    };

    try {
      if (action === 'download' || action === 'upload' || action === 'preview') {
        const res = await executeAction(action, ctx);
        if (res?.previewKey) {
          previewKey = res.previewKey;
          showPreviewModal = true;
        } else if (res?.unimplemented) {
          addToast('warning', `${action} — not implemented`);
        }
      } else {
        addToast('warning', `${action} — not implemented`);
      }
    } catch (err: unknown) {
      addToast(
        'error',
        err instanceof ActionError ? getActionErrorMessage(err) : m.storage_download_error_unknown()
      );
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (showDeleteModal) return;
    if (e.key === 'Delete' && selectedKeys.size > 0) showDeleteModal = true;
    else if (e.key === 'F2' && selectedKeys.size === 1) handleAction('rename');
    else if (e.key === 'Escape') {
      if (ctxMenu) {
        selectedKeys.delete(ctxKey!);
        ctxMenu = null;
        ctxKey = null;
      }
      selectionMode = false;
      selectedKeys = new SvelteSet<string>();
    }
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
  <div class="border-base-200/40 bg-base-100 sticky bottom-0 z-10 border-t px-4 py-3">
    <Pagination
      bind:pageSize
      storageKey="storage_page_size"
      pageSizeLabel={m.storage_page_size()}
      infoLabel="{m.storage_page()} {currentPage}"
      current={prevTokens.length}
      hasNext={objects.hasNextPage}
      onfirst={goFirst}
      onprev={goPrev}
      onnext={() => handlePageNavigate(objects.nextContinuationToken ?? null)}
      onpagesizechange={() => {
        prevTokens = [];
        goFirst();
      }}
    />
  </div>
</div>

<!-- Context menu -->
{#if ctxMenu}
  <ContextMenu
    x={ctxMenu.x}
    y={ctxMenu.y}
    selectionCount={selectedKeys.size}
    canPreview={(selectedFiles.length === 1 && selectedFolders.length === 0) ||
      (ctxKey !== null && files.some((f) => f.key === ctxKey))}
    canDownload={selectedFiles.length > 0 || ctxIsFile}
    onaction={handleAction}
    onclose={() => {
      ctxMenu = null;
      ctxKey = null;
    }}
  />
{/if}

<!-- Preview modal -->
<PreviewModal bind:open={showPreviewModal} {bucket} objectKey={previewKey} />
