<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { navigating } from '$app/state';
  import { getStorageState } from '$lib/storage/context.js';
  import { getTabsState } from '$lib/storage/context.js';
  import { collectDroppedFiles } from '$lib/storage/file-collection.js';
  import {
    storageCutCopyEnabled,
    storagePasteEnabled,
    storageRenameEnabled
  } from '$lib/client/feature-flags.js';
  import type { ContextMenuAction } from '$lib/storage/types.js';
  import type { ActionName } from '$lib/storage/types.js';
  import IconVisibility from 'virtual:icons/material-symbols/visibility';
  import IconDownload from 'virtual:icons/material-symbols/download';
  import IconInfo from 'virtual:icons/material-symbols/info';
  import IconPushPinOutline from 'virtual:icons/material-symbols/push-pin-outline';
  import IconPushPin from 'virtual:icons/material-symbols/push-pin';
  import IconDelete from 'virtual:icons/material-symbols/delete';
  import IconContentCopy from 'virtual:icons/material-symbols/content-copy';
  import IconFileCopy from 'virtual:icons/material-symbols/file-copy-outline';
  import IconCut from 'virtual:icons/material-symbols/content-cut';
  import IconCopy from 'virtual:icons/material-symbols/content-copy';
  import IconPaste from 'virtual:icons/material-symbols/content-paste';
  import IconDriveFileRenameOutline from 'virtual:icons/material-symbols/drive-file-rename-outline';
  import IconDescriptionOutline from 'virtual:icons/material-symbols/description-outline';
  import IconFolderOutline from 'virtual:icons/material-symbols/folder-outline';
  import IconUploadFile from 'virtual:icons/material-symbols/upload-file';
  import StorageBreadcrumb from './StorageBreadcrumb.svelte';
  import TabBar from './TabBar.svelte';
  import ObjectTable from './ObjectTable.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import Pagination from '$lib/components/Pagination.svelte';

  const storage = getStorageState();

  const tabsState = getTabsState();

  let explorerEl: HTMLDivElement;
  let fileDragOver = $state(false);
  let collectingFiles = false;
  const canUploadDrop = $derived(
    !!storage.bucket &&
      !storage.archive.isInArchive &&
      !storage.loading &&
      !storage.deleting &&
      !navigating.to &&
      !storage.activeModal
  );

  $effect(() => {
    if (!canUploadDrop) fileDragOver = false;
  });

  // Capture external file drops before the nested targets for moving S3 objects.
  // This also prevents the browser from navigating to a dropped local file.
  $effect(() => {
    const el = explorerEl;
    let dragDepth = 0;

    function isFileDrag(e: DragEvent) {
      return e.dataTransfer?.types.includes('Files');
    }

    function resetDrag() {
      dragDepth = 0;
      fileDragOver = false;
    }

    function handleDragEnter(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepth++;
      fileDragOver = canUploadDrop;
    }

    function handleDragOver(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = canUploadDrop ? 'copy' : 'none';
      fileDragOver = canUploadDrop;
    }

    function handleDragLeave(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.stopPropagation();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) fileDragOver = false;
    }

    async function handleDrop(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      resetDrag();
      if (!canUploadDrop || collectingFiles) return;

      const dt = e.dataTransfer!;
      // Snapshot before asynchronous directory traversal; the transfer is only
      // readable during the drop event in some browsers.
      const fallback = Array.from(dt.files).map((file) => ({ file, relativePath: file.name }));
      const { bucket, prefix, connectionId } = storage;
      collectingFiles = true;
      try {
        const files = await collectDroppedFiles(dt).catch(() => fallback);
        if (
          files.length > 0 &&
          canUploadDrop &&
          storage.bucket === bucket &&
          storage.prefix === prefix &&
          storage.connectionId === connectionId
        ) {
          storage.contextMenu = null;
          storage.openModal('upload', { bucket, prefix, files });
        }
      } finally {
        collectingFiles = false;
      }
    }

    el.addEventListener('dragenter', handleDragEnter, true);
    el.addEventListener('dragover', handleDragOver, true);
    el.addEventListener('dragleave', handleDragLeave, true);
    el.addEventListener('drop', handleDrop, true);
    window.addEventListener('dragend', resetDrag);
    return () => {
      el.removeEventListener('dragenter', handleDragEnter, true);
      el.removeEventListener('dragover', handleDragOver, true);
      el.removeEventListener('dragleave', handleDragLeave, true);
      el.removeEventListener('drop', handleDrop, true);
      window.removeEventListener('dragend', resetDrag);
    };
  });

  beforeNavigate((navigation) => {
    const params = navigation.to?.params;
    const connection = params?.connection;
    const bucket = params?.bucket;
    if (!connection || !bucket) return;

    const prefix = params.prefix ? `${params.prefix}/` : '';
    tabsState.prepareActiveTabForNavigation(connection, bucket, prefix);
  });

  // Wire up source-tab invalidation so that after a move, source tabs refetch.
  storage.setTabsInvalidationHandler((prefix: string) => {
    tabsState.setStalePrefix(prefix);
  });

  // Initialise tabs once storage has bucket data.
  $effect(() => {
    if (storage.bucket) {
      untrack(() => tabsState.ensureInitialTab());
    }
  });

  // Keep the active tab snapshot in sync whenever location or page data
  // changes. Both methods are called inside untrack to prevent a reactive
  // loop: they read from this.tabs internally, and writing this.tabs would
  // otherwise re-trigger the effect.
  $effect(() => {
    void [
      storage.bucket,
      storage.prefix,
      storage.objects,
      storage.selectedKeys,
      storage.selectionMode
    ];
    untrack(() => {
      tabsState.markActiveTabLoaded();
      tabsState.syncActiveTab();
    });
  });

  // Record location visit whenever the current bucket/prefix changes.
  $effect(() => {
    const b = storage.bucket;
    const p = storage.prefix;
    if (b) untrack(() => storage.bookmarks.recordLocationVisit(b, p));
  });

  // ── Context menu actions ─────────────────────────────────────────────────

  const hasCtxKey = $derived(!!storage.contextMenu?.key);
  const canPreview = $derived(
    (storage.selectedFiles.length === 1 && storage.selectedFolders.length === 0) ||
      (storage.contextMenu !== null && storage.ctxIsFile)
  );
  const canDownload = $derived(storage.selectedFiles.length > 0 || storage.ctxIsFile);
  const canShowDetails = $derived(
    storage.contextMenu !== null ||
      (storage.selectedFiles.length === 1 && storage.selectedFolders.length === 0)
  );
  const selectionCount = $derived(storage.selectedKeys.size);

  const contextMenuActions = $derived.by<ContextMenuAction[]>(() => {
    if (!hasCtxKey) {
      return [
        {
          key: 'create-file' as ActionName,
          icon: IconDescriptionOutline,
          label: m.storage_create_file(),
          disabled: false,
          hidden: storage.archive.isInArchive
        },
        {
          key: 'create-folder' as ActionName,
          icon: IconFolderOutline,
          label: m.storage_create_folder(),
          disabled: false,
          hidden: storage.archive.isInArchive
        },
        {
          key: 'paste' as ActionName,
          icon: IconPaste,
          label: m.storage_action_paste(),
          disabled: storage.clipboard === null || storage.archive.isInArchive,
          hidden: !storagePasteEnabled || storage.archive.isInArchive
        }
      ];
    }

    const items: ContextMenuAction[] = [
      {
        key: 'preview' as ActionName,
        icon: IconVisibility,
        label: m.storage_action_preview(),
        disabled: !canPreview,
        hidden: false
      },
      {
        key: 'download' as ActionName,
        icon: IconDownload,
        label: m.storage_action_download(),
        disabled: !canDownload,
        hidden: false
      },
      {
        key: 'details' as ActionName,
        icon: IconInfo,
        label: m.storage_action_details(),
        disabled: !canShowDetails,
        hidden: false
      },
      {
        key: 'cut' as ActionName,
        icon: IconCut,
        label: m.storage_action_cut(),
        disabled: selectionCount === 0 || storage.archive.isInArchive,
        hidden: !storageCutCopyEnabled || storage.archive.isInArchive
      },
      {
        key: 'copy' as ActionName,
        icon: IconCopy,
        label: m.storage_action_copy(),
        disabled: selectionCount === 0 || storage.archive.isInArchive,
        hidden: !storageCutCopyEnabled || storage.archive.isInArchive
      },
      {
        key: 'paste' as ActionName,
        icon: IconPaste,
        label: m.storage_action_paste(),
        disabled: storage.clipboard === null || storage.archive.isInArchive,
        hidden: !storagePasteEnabled || storage.archive.isInArchive
      },
      {
        key: 'rename' as ActionName,
        icon: IconDriveFileRenameOutline,
        label: m.storage_action_rename(),
        disabled: selectionCount !== 1 || storage.archive.isInArchive,
        hidden: !storageRenameEnabled || storage.archive.isInArchive
      },
      {
        key: 'copy-filename' as ActionName,
        icon: IconFileCopy,
        label:
          hasCtxKey && !storage.ctxIsFile
            ? m.storage_action_copy_directory_name()
            : m.storage_action_copy_filename(),
        disabled: !hasCtxKey,
        hidden: false
      },
      {
        key: 'copy-path' as ActionName,
        icon: IconContentCopy,
        label: m.storage_action_copy_path(),
        disabled: !hasCtxKey,
        hidden: false
      },
      {
        key: 'pin' as ActionName,
        icon: IconPushPinOutline,
        label: m.storage_action_pin(),
        disabled: !storage.canPin || storage.archive.isInArchive,
        hidden: !storage.canPin || storage.ctxIsPinned || storage.archive.isInArchive
      },
      {
        key: 'unpin' as ActionName,
        icon: IconPushPin,
        label: m.storage_action_unpin(),
        disabled: !storage.ctxIsPinned || storage.archive.isInArchive,
        hidden: !storage.ctxIsPinned || storage.archive.isInArchive
      }
    ];

    if (!storage.archive.isInArchive && hasCtxKey) {
      items.push({
        key: 'delete' as ActionName,
        icon: IconDelete,
        label: m.storage_action_delete(),
        disabled: selectionCount === 0,
        class: 'text-error'
      });
    }

    return items;
  });

  function handleContextMenuAction(key: string) {
    storage.executeAction(key as ActionName);
    storage.contextMenu = null;
  }

  // Clicking anywhere inside the object-list container that is not a table row
  // clears the current selection (left-click) or opens the empty-space context
  // menu (right-click). Keyboard users already have Escape via the svelte:window
  // handler below, so no key handler is needed here.
  let objectListEl: HTMLDivElement;
  $effect(() => {
    function handleClick(e: MouseEvent) {
      if (objectListEl.contains(e.target as Node) && !(e.target as HTMLElement).closest('tr')) {
        storage.clearSelection();
      }
    }
    function handleContextMenu(e: MouseEvent) {
      if (objectListEl.contains(e.target as Node) && !(e.target as HTMLElement).closest('tr')) {
        storage.openEmptyContextMenu(e);
      }
    }
    document.addEventListener('click', handleClick);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  });
</script>

<svelte:window onkeydown={storage.handleKeydown} />

<div
  bind:this={explorerEl}
  data-testid="storage-file-browser"
  class="bg-base-100 relative flex flex-1 flex-col overflow-hidden"
>
  {#if fileDragOver}
    <div
      data-testid="storage-upload-drop-overlay"
      class="border-primary bg-base-100/90 pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6"
      role="status"
    >
      <IconUploadFile class="text-primary size-12" aria-hidden="true" />
      <p class="text-base-content text-center text-sm">{m.storage_upload_browser_drop_prompt()}</p>
    </div>
  {/if}
  <TabBar {tabsState} />

  <StorageBreadcrumb />

  <div bind:this={objectListEl} class="relative min-h-0 flex-1 overflow-hidden">
    {#if storage.loading || storage.deleting || storage.archive.archiveLoading || navigating.to}
      <div
        data-testid="storage-object-list-loading"
        class="bg-base-100/70 absolute inset-0 z-20 flex items-center justify-center"
        aria-live="polite"
        aria-label={m.storage_loading()}
      >
        <span class="loading loading-md loading-spinner text-primary" aria-hidden="true"></span>
      </div>
    {/if}
    <ObjectTable />
  </div>

  <!-- Fixed pagination bar at bottom -->
  <div class="border-base-200/40 bg-base-100 sticky bottom-0 z-10 border-t px-4 py-3">
    <Pagination
      bind:pageSize={storage.pageSize}
      storageKey="storage_page_size"
      pageSizeLabel={m.storage_page_size()}
      infoLabel="{m.storage_page()} {storage.currentPage}"
      current={storage.prevTokens.length}
      hasNext={storage.objects.hasNextPage}
      onfirst={storage.navigateFirst}
      onprev={storage.navigatePrev}
      onnext={storage.navigateNext}
      onpagesizechange={storage.onPageSizeChange}
    />
  </div>
</div>

<!-- Context menu -->
<ContextMenu
  x={storage.contextMenu?.x ?? 0}
  y={storage.contextMenu?.y ?? 0}
  open={!!storage.contextMenu}
  onclose={() => storage.closeContextMenu()}
  onaction={handleContextMenuAction}
  actions={contextMenuActions}
  title={m.storage_context_menu_actions()}
/>
