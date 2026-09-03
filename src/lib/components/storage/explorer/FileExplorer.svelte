<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { navigating } from '$app/state';
  import { getStorageState } from '$lib/storage/context.js';
  import { getTabsState } from '$lib/storage/context.js';
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
  import StorageBreadcrumb from './StorageBreadcrumb.svelte';
  import TabBar from './TabBar.svelte';
  import ObjectTable from './ObjectTable.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import Pagination from '$lib/components/Pagination.svelte';

  const storage = getStorageState();

  const tabsState = getTabsState();

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
    void [storage.bucket, storage.prefix, storage.objects];
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
  const canDownload = $derived(
    storage.selectedFiles.length > 0 || storage.selectedFolders.length > 0 || storage.ctxIsFile
  );
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

<div class="bg-base-100 flex flex-1 flex-col overflow-hidden">
  <TabBar {tabsState} />

  <StorageBreadcrumb />

  <div bind:this={objectListEl} class="relative min-h-0 flex-1 overflow-hidden">
    {#if storage.loading || storage.deleting || storage.archive.archiveLoading || navigating.to}
      <div
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
