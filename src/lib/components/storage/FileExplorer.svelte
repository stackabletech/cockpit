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
  import DeleteConfirmModal from './DeleteConfirmModal.svelte';
  import { invalidateAll } from '$app/navigation';

  import { untrack } from 'svelte';
  import { navigating } from '$app/state';
  import { initPageSize, type PageSize } from '$lib/types/pagination.js';
  import { pinLocation } from '$lib/stores/pinned-locations.svelte.js';
  import { recordLocationVisit, recordFileVisit } from '$lib/stores/recent-items.svelte.js';

  interface Props {
    bucket: string;
    objects: StoragePage;
    prefix: string;
    onNavigate: (
      prefix: string,
      continuationToken?: string | null,
      pageSize?: number | null
    ) => void;
  }

  let { bucket, objects, prefix, onNavigate }: Props = $props();

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

  // Record location visit whenever the current bucket/prefix changes.
  // untrack() prevents the store reads inside recordLocationVisit from
  // creating a dependency that would cause this effect to re-run on every write.
  $effect(() => {
    const b = bucket;
    const p = prefix;
    untrack(() => recordLocationVisit(b, p));
  });

  function toggleSelectionMode() {
    selectionMode = !selectionMode;
    if (!selectionMode) selectedKeys = new SvelteSet<string>();
  }

  function toggleSelect(key: string, force = false) {
    if (force || selectionMode) {
      if (force && !selectionMode) selectionMode = true;
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

  const currentPage = $derived(prevTokens.length + 1);

  // ── Loading state ─────────────────────────────────────────────────────────
  let loading = $state(false);
  let deleting = $state(false); // true while the delete API call is in flight

  // Show loading overlay for any navigation (including sidebar/grid links).
  $effect(() => {
    if (navigating) loading = true;
  });

  // Clear loading when new objects arrive from the server
  $effect(() => {
    void objects;
    loading = false;
  });

  function handleNavigate(prefix: string) {
    loading = true;
    prevTokens = [];
    onNavigate(prefix, null, pageSize);
  }

  function handlePageNavigate(token: string | null) {
    // push current page token so we can go back deterministically
    prevTokens = [...prevTokens, objects.continuationToken ?? null];
    loading = true;
    onNavigate(prefix, token, pageSize);
  }

  function goFirst() {
    prevTokens = [];
    loading = true;
    onNavigate(prefix, null, pageSize);
  }

  function goPrev() {
    const copy = [...prevTokens];
    const last = copy.pop() ?? null;
    prevTokens = copy;
    loading = true;
    onNavigate(prefix, last, pageSize);
  }

  // ── Context menu ──────────────────────────────────────────────────────────
  let ctxMenu = $state<{ x: number; y: number } | null>(null);

  let ctxKey = $state<string | null>(null);

  const ctxFileObj = $derived(ctxKey ? (files.find((f) => f.key === ctxKey) ?? null) : null);
  const ctxIsFile = $derived(ctxFileObj !== null);
  const canPin = $derived(ctxKey !== null && !ctxIsFile);

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
  let pendingDeleteKeys = $state<string[]>([]);
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

    if (action === 'delete') {
      pendingDeleteKeys = [...selectedKeys];
      showDeleteModal = true;
      return;
    }

    try {
      if (action === 'pin') {
        pinLocation(bucket, ctxKey ?? prefix);
      } else if (action === 'download' || action === 'upload' || action === 'preview') {
        // Record file visit for the acted-on file(s)
        for (const f of effectiveSelectedFiles) {
          recordFileVisit(bucket, f.key, f.size);
        }
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

  async function confirmDelete() {
    showDeleteModal = false;
    const keys = pendingDeleteKeys;
    pendingDeleteKeys = [];
    deleting = true;
    try {
      const result = await executeAction('delete', { bucket, selectedKeys: keys });
      if (result.failedKeys && result.failedKeys.length > 0) {
        addToast('warning', m.storage_delete_partial_failure({ count: result.failedKeys.length }));
      }
      selectedKeys = new SvelteSet<string>();
      selectionMode = false;
      loading = true;
      await invalidateAll();
    } catch (err: unknown) {
      loading = false;
      let msg = m.storage_delete_error_unknown();
      if (err instanceof ActionError) {
        if (err.code === 'not_connected') msg = m.storage_delete_error_not_connected();
        else if (err.code === 'access_denied') msg = m.storage_delete_error_access_denied();
        else if (err.code === 'server_error') msg = m.storage_delete_error_server_error();
      }
      addToast('error', msg);
    } finally {
      deleting = false;
    }
  }

  function cancelDelete() {
    showDeleteModal = false;
    pendingDeleteKeys = [];
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (showDeleteModal) return;
    if (e.key === 'Delete' && selectedKeys.size > 0) {
      pendingDeleteKeys = [...selectedKeys];
      showDeleteModal = true;
    } else if (e.key === 'Escape') {
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
    onNavigate={handleNavigate}
    onToggleSelectionMode={toggleSelectionMode}
  />

  <div class="relative min-h-0 flex-1 overflow-hidden">
    {#if loading || deleting}
      <div
        class="
          bg-base-100/70 absolute inset-0 z-20 flex items-center justify-center
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
      {selectionMode}
      {allSelected}
      {someSelected}
      onNavigate={handleNavigate}
      onSelectAll={selectAll}
      onToggleSelect={toggleSelect}
      onContextMenu={openContextMenu}
      onAction={handleAction}
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
    {canPin}
    onAction={handleAction}
    onClose={() => {
      ctxMenu = null;
      ctxKey = null;
    }}
  />
{/if}

<!-- Delete confirmation modal -->
<DeleteConfirmModal
  bind:open={showDeleteModal}
  keys={pendingDeleteKeys}
  onConfirm={confirmDelete}
  onCancel={cancelDelete}
/>

<!-- Preview modal -->
<PreviewModal bind:open={showPreviewModal} {bucket} objectKey={previewKey} />
