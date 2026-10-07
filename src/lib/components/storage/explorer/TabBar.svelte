<script lang="ts">
  import IconAdd from 'virtual:icons/material-symbols/add';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconFileCopy from 'virtual:icons/material-symbols/file-copy-outline';
  import IconContentCopy from 'virtual:icons/material-symbols/content-copy';
  import IconDriveFileRenameOutline from 'virtual:icons/material-symbols/drive-file-rename-outline';
  import * as m from '$lib/paraglide/messages.js';
  import type { TabsState } from '$lib/storage/tabs.svelte.js';
  import type { ContextMenuAction } from '$lib/storage/types.js';
  import { getStorageState } from '$lib/storage/context.js';
  import { storageMoveEnabled } from '$lib/client/feature-flags.js';
  import ContextMenu from './ContextMenu.svelte';
  import TooltipTrigger from '$lib/components/TooltipTrigger.svelte';

  interface Props {
    tabsState: TabsState;
  }

  let { tabsState }: Props = $props();

  const storage = getStorageState();

  let renameInput = $state<HTMLInputElement | null>(null);
  let tabButtons = $state<HTMLButtonElement[]>([]);

  $effect(() => {
    if (renamingId && renameInput) {
      renameInput.focus();
      renameInput.select();
    }
  });

  // ── Overflow detection ──
  let containerEl = $state<HTMLElement | null>(null);
  let isOverflowRight = $state(false);
  let isOverflowLeft = $state(false);

  function checkOverflow() {
    if (containerEl) {
      const { scrollLeft, scrollWidth, clientWidth } = containerEl;
      isOverflowLeft = scrollLeft > 0;
      isOverflowRight = scrollLeft + clientWidth < scrollWidth - 1;
    }
  }

  $effect(() => {
    // Re-check overflow whenever tabs change
    checkOverflow();
  });

  // ── Drag state ──
  let dragIdx = $state<number | null>(null);
  let dragOverIdx = $state<number | null>(null);

  // ── File-drag hover state (for drop-to-move) ──
  // When the user drags file(s) over a tab, we auto-switch to that tab after
  // TAB_HOVER_MS ms so they can navigate while dragging.
  const TAB_HOVER_MS = 600;
  let fileDragHoverIdx = $state<number | null>(null);
  let fileDragHoverTimer: ReturnType<typeof setTimeout> | null = null;

  function clearHoverTimer() {
    if (fileDragHoverTimer !== null) {
      clearTimeout(fileDragHoverTimer);
      fileDragHoverTimer = null;
    }
    fileDragHoverIdx = null;
  }

  /** Returns true when the drag event is carrying storage keys (file drag),
   *  not a tab-reorder drag (which uses text/plain). */
  function isFileDrag(e: DragEvent): boolean {
    return (
      storageMoveEnabled && (e.dataTransfer?.types.includes('application/x-storage-keys') ?? false)
    );
  }

  // ── Context menu ──
  let ctxMenu = $state<{ x: number; y: number; tabId: string } | null>(null);

  // ── Rename state ──
  let renamingId = $state<string | null>(null);
  let renameValue = $state('');

  function handleMiddleClick(e: MouseEvent, tabId: string) {
    if (e.button === 1) {
      e.preventDefault();
      tabsState.closeTab(tabId);
    }
  }

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
    if (key === 'rename') {
      startRename(ctxMenu.tabId);
    } else if (key === 'close') {
      tabsState.closeTab(ctxMenu.tabId);
    } else if (key === 'copy-filename') {
      const tab = tabsState.tabs.find((t) => t.id === ctxMenu!.tabId);
      if (tab) storage.copyFilename(tab.snapshot.prefix);
    } else if (key === 'copy-path') {
      const tab = tabsState.tabs.find((t) => t.id === ctxMenu!.tabId);
      if (tab) storage.copyPath(tab.snapshot.bucket, tab.snapshot.prefix);
    }
  }

  function startRename(tabId: string) {
    const tab = tabsState.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    renamingId = tabId;
    renameValue = tab.label;
    closeCtxMenu();
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      tabsState.renameTab(renamingId, renameValue.trim());
    }
    renamingId = null;
    renameValue = '';
  }

  function cancelRename() {
    renamingId = null;
    renameValue = '';
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  function handleWheel(e: WheelEvent) {
    const container = e.currentTarget as HTMLElement;
    if (container.scrollWidth > container.clientWidth) {
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    }
  }

  function focusTab(index: number) {
    const tab = tabsState.tabs[index];
    if (!tab) return;
    tabsState.switchTo(tab.id);
    requestAnimationFrame(() => tabButtons[index]?.focus());
  }

  function handleTabKeydown(e: KeyboardEvent, index: number) {
    const lastIndex = tabsState.tabs.length - 1;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTab(index === lastIndex ? 0 : index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTab(index === 0 ? lastIndex : index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTab(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTab(lastIndex);
    } else if (e.key === 'Delete' && tabsState.tabs.length > 1) {
      e.preventDefault();
      const nextIndex = index === lastIndex ? index - 1 : index + 1;
      tabsState.closeTab(tabsState.tabs[index].id);
      requestAnimationFrame(() => tabButtons[nextIndex]?.focus());
    }
  }

  // ── Drag handlers ──
  function handleDragStart(e: DragEvent, idx: number) {
    dragIdx = idx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    }
  }

  function handleDragOver(e: DragEvent, idx: number) {
    if (isFileDrag(e)) {
      // File drag: allow drop, start hover-switch timer
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (fileDragHoverIdx !== idx) {
        clearHoverTimer();
        fileDragHoverIdx = idx;
        fileDragHoverTimer = setTimeout(() => {
          const tab = tabsState.tabs[idx];
          if (tab && tab.id !== tabsState.activeTabId) {
            tabsState.switchTo(tab.id);
          }
          fileDragHoverTimer = null;
        }, TAB_HOVER_MS);
      }
    } else {
      // Tab reorder drag
      e.preventDefault();
      dragOverIdx = idx;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    }
  }

  function handleDragLeave(e: DragEvent, idx: number) {
    if (isFileDrag(e)) {
      if (fileDragHoverIdx === idx) {
        clearHoverTimer();
      }
    } else {
      if (dragOverIdx === idx) dragOverIdx = null;
    }
  }

  function handleDrop(e: DragEvent, toIdx: number) {
    e.preventDefault();
    clearHoverTimer();

    if (isFileDrag(e)) {
      // Drop files onto tab → move to that tab's prefix
      const raw = e.dataTransfer?.getData('application/x-storage-keys');
      if (raw) {
        try {
          const keys: string[] = JSON.parse(raw);
          const tab = tabsState.tabs[toIdx];
          if (tab) {
            const destPrefix = tab.snapshot.prefix;
            storage.performMove(destPrefix, keys);
          }
        } catch {
          // invalid JSON - ignore
        }
      }
    } else {
      // Tab reorder
      if (dragIdx !== null && dragIdx !== toIdx) {
        tabsState.reorderTabs(dragIdx, toIdx);
      }
    }

    dragIdx = null;
    dragOverIdx = null;
  }

  function handleDragEnd() {
    dragIdx = null;
    dragOverIdx = null;
    clearHoverTimer();
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
  <div class="bg-base-200/60 relative flex items-end pt-1.5 pl-2">
    <!-- Tab list container — hidden scrollbar, overlapping tabs -->
    <div
      bind:this={containerEl}
      class="tab-strip flex min-w-0 flex-1 items-end"
      role="tablist"
      aria-label={m.storage_tab_list()}
      onwheel={handleWheel}
      onscroll={checkOverflow}
    >
      {#each tabsState.tabs as tab, idx (tab.id)}
        {@const isActive = tab.id === tabsState.activeTabId}
        {#if renamingId === tab.id}
          <div
            class="bg-base-100 border-base-300 relative z-30 mr-2 flex shrink-0 items-center rounded-t-lg border border-b-0 px-3 py-1.5 shadow-sm"
          >
            <!-- svelte-ignore a11y_autofocus -->
            <input
              type="text"
              autofocus
              class="border-base-300 focus:border-primary h-4 w-24 rounded border bg-transparent px-1 py-0 text-xs focus:outline-none"
              bind:value={renameValue}
              bind:this={renameInput}
              onblur={commitRename}
              onkeydown={handleRenameKeydown}
              aria-label={m.storage_tab_rename()}
            />
          </div>
        {:else}
          <button
            role="tab"
            aria-selected={isActive}
            tabindex={isActive ? 0 : -1}
            bind:this={tabButtons[idx]}
            class="group relative flex max-w-44 shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-4 py-1.5 text-xs
              transition-all select-none
              {tabsState.tabs.length > 1 ? 'mr-2' : ''}
              {tabsState.tabs.length > 1 ? 'pr-6' : ''}
              {isActive
              ? 'bg-base-100 border-base-300 text-base-content z-20 font-medium shadow-sm'
              : 'text-base-content/60 hover:text-base-content/80 hover:bg-base-100/50 z-10 border-transparent'}
              {dragIdx === idx ? 'opacity-50' : ''}
              {(dragOverIdx === idx && dragIdx !== idx) || fileDragHoverIdx === idx
              ? '!border-primary'
              : ''}
              {fileDragHoverIdx === idx ? 'bg-primary/10' : ''}"
            draggable="true"
            onclick={() => tabsState.switchTo(tab.id)}
            onkeydown={(e) => handleTabKeydown(e, idx)}
            ondblclick={() => startRename(tab.id)}
            onmousedown={(e) => handleMiddleClick(e, tab.id)}
            onauxclick={(e) => handleMiddleClick(e, tab.id)}
            oncontextmenu={(e) => openCtxMenu(e, tab.id)}
            ondragstart={(e) => handleDragStart(e, idx)}
            ondragover={(e) => handleDragOver(e, idx)}
            ondragleave={(e) => handleDragLeave(e, idx)}
            ondrop={(e) => handleDrop(e, idx)}
            ondragend={handleDragEnd}
            title={tab.label}
          >
            <span class="truncate">{tab.label}</span>
          </button>
          {#if tabsState.tabs.length > 1}
            <TooltipTrigger text={m.storage_tab_close()} orientation="down">
              <button
                type="button"
                class="text-base-content/40 hover:text-error relative z-30 -ml-7 shrink-0 translate-y-0.5 self-center rounded-full p-0.5 transition-colors"
                aria-label={m.storage_tab_close()}
                onclick={() => tabsState.closeTab(tab.id)}
              >
                <IconClose class="size-3" aria-hidden="true" />
              </button>
            </TooltipTrigger>
          {/if}
        {/if}
      {/each}

      <!-- Plus button — sits inline next to the last tab -->
      <TooltipTrigger text={m.storage_tab_new()} orientation="down">
        <button
          class="btn btn-ghost btn-xs z-20 ml-1 shrink-0"
          aria-label={m.storage_tab_new()}
          onclick={() => tabsState.addTab()}
        >
          <IconAdd class="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
    </div>

    <!-- Fade-out gradient indicating more tabs to the left -->
    {#if isOverflowLeft}
      <div
        class="from-base-200/60 pointer-events-none absolute top-0 bottom-0 left-0 z-30 w-12 bg-gradient-to-r to-transparent"
        aria-hidden="true"
      ></div>
    {/if}

    <!-- Fade-out gradient indicating more tabs to the right -->
    {#if isOverflowRight}
      <div
        class="from-base-200/60 pointer-events-none absolute top-0 right-0 bottom-0 z-30 w-12 bg-gradient-to-l to-transparent"
        aria-hidden="true"
      ></div>
    {/if}
  </div>
{/if}

<style>
  .tab-strip {
    overflow-x: auto;
    scrollbar-width: none; /* Firefox */
  }
  .tab-strip::-webkit-scrollbar {
    display: none; /* Chrome/Safari */
  }
</style>
