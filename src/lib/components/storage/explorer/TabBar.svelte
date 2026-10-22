<script lang="ts">
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconFileCopy from 'virtual:icons/material-symbols/file-copy-outline';
  import IconContentCopy from 'virtual:icons/material-symbols/content-copy';
  import IconDriveFileRenameOutline from 'virtual:icons/material-symbols/drive-file-rename-outline';
  import * as m from '$lib/paraglide/messages.js';
  import type { TabsState } from '$lib/storage/tabs.svelte.js';
  import type { ContextMenuAction } from '$lib/storage/types.js';
  import { getStorageState } from '$lib/storage/context.js';
  import { storageMoveEnabled } from '$lib/client/feature-flags.js';
  import { parseStorageDrop } from '$lib/storage/drag-handlers.js';
  import ContextMenu from './ContextMenu.svelte';
  import GenericTabBar, { type ExternalTabDrag } from '$lib/components/TabBar.svelte';

  interface Props {
    tabsState: TabsState;
  }

  let { tabsState }: Props = $props();

  const storage = getStorageState();

  let tabBar = $state<GenericTabBar | null>(null);

  // ── File-drag hover state (for drop-to-move) ──
  // When the user drags file(s) over a tab, we auto-switch to that tab after
  // TAB_HOVER_MS ms so they can navigate while dragging.
  const TAB_HOVER_MS = 600;
  let fileDragHoverId = $state<string | null>(null);
  let fileDragHoverTimer: ReturnType<typeof setTimeout> | null = null;

  function clearHoverTimer() {
    if (fileDragHoverTimer !== null) {
      clearTimeout(fileDragHoverTimer);
      fileDragHoverTimer = null;
    }
    fileDragHoverId = null;
  }

  const fileDrag: ExternalTabDrag = {
    /** True when the drag carries storage keys (file drag), not a tab-reorder drag. */
    accepts: (e) =>
      storageMoveEnabled && (e.dataTransfer?.types.includes('application/x-storage-keys') ?? false),
    over: (_e, id) => {
      if (fileDragHoverId === id) return;
      clearHoverTimer();
      fileDragHoverId = id;
      fileDragHoverTimer = setTimeout(() => {
        if (id !== tabsState.activeTabId) tabsState.switchTo(id);
        fileDragHoverTimer = null;
      }, TAB_HOVER_MS);
    },
    leave: (_e, id) => {
      if (fileDragHoverId === id) clearHoverTimer();
    },
    drop: (e, id) => {
      clearHoverTimer();
      // Drop files onto tab → move to that tab's bucket and prefix
      const drop = parseStorageDrop(e);
      const tab = tabsState.tabs.find((t) => t.id === id);
      if (drop && tab) {
        storage.performMove(tab.snapshot.prefix, drop.keys, tab.snapshot.bucket, drop.source);
      }
    }
  };

  // ── Context menu ──
  let ctxMenu = $state<{ x: number; y: number; tabId: string } | null>(null);

  function openCtxMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    ctxMenu = { x: e.clientX, y: e.clientY, tabId };
  }

  function closeCtxMenu() {
    ctxMenu = null;
  }

  const tabMenuActions = $derived.by<ContextMenuAction[]>(() => {
    if (!ctxMenu) return [];
    return [
      {
        key: 'rename',
        icon: IconDriveFileRenameOutline,
        label: m.storage_tab_rename(),
        disabled: false,
        hidden: false
      },
      {
        key: 'copy-filename',
        icon: IconFileCopy,
        label: m.storage_action_copy_directory_name(),
        disabled: false,
        hidden: false
      },
      {
        key: 'copy-path',
        icon: IconContentCopy,
        label: m.storage_action_copy_path(),
        disabled: false,
        hidden: false
      },
      {
        key: 'close',
        icon: IconClose,
        label: m.storage_tab_close(),
        disabled: false,
        hidden: false,
        class: 'text-error'
      }
    ];
  });

  function handleTabAction(key: string) {
    if (!ctxMenu) return;
    const tabId = ctxMenu.tabId;
    if (key === 'rename') {
      closeCtxMenu();
      tabBar?.startRename(tabId);
    } else if (key === 'close') {
      tabsState.closeTab(tabId);
    } else if (key === 'copy-filename') {
      const tab = tabsState.tabs.find((t) => t.id === tabId);
      if (tab) storage.copyFilename(tab.snapshot.prefix);
    } else if (key === 'copy-path') {
      const tab = tabsState.tabs.find((t) => t.id === tabId);
      if (tab) storage.copyPath(tab.snapshot.bucket, tab.snapshot.prefix);
    }
  }

  function handleRename(id: string, label: string) {
    // An empty name keeps the current label
    if (label.trim()) tabsState.renameTab(id, label.trim());
  }
</script>

<ContextMenu
  x={ctxMenu?.x ?? 0}
  y={ctxMenu?.y ?? 0}
  open={!!ctxMenu}
  onclose={closeCtxMenu}
  onaction={handleTabAction}
  actions={tabMenuActions}
  title={m.storage_tab_context_menu()}
/>

{#if tabsState.hasTabs}
  <div class="px-2 pt-1.5">
    <GenericTabBar
      bind:this={tabBar}
      items={tabsState.tabs}
      activeId={tabsState.activeTabId}
      ariaLabel={m.storage_tab_list()}
      closeLabel={() => m.storage_tab_close()}
      addLabel={m.storage_tab_new()}
      renameLabel={m.storage_tab_rename()}
      onSelect={(id) => tabsState.switchTo(id)}
      onClose={(id) => tabsState.closeTab(id)}
      onAdd={() => tabsState.addTab()}
      onRename={handleRename}
      onReorder={(from, to) => tabsState.reorderTabs(from, to)}
      onTabContextMenu={openCtxMenu}
      externalDrag={fileDrag}
      dropTargetId={fileDragHoverId}
    />
  </div>
{/if}
