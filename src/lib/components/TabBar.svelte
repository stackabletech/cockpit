<script lang="ts" module>
  interface TabItem {
    id: string;
    label: string;
    closable?: boolean;
  }

  /** Lets a consumer handle drags it owns (e.g. files dropped onto a tab) instead of tab reordering. */
  export interface ExternalTabDrag {
    accepts: (event: DragEvent) => boolean;
    over: (event: DragEvent, id: string) => void;
    leave: (event: DragEvent, id: string) => void;
    drop: (event: DragEvent, id: string) => void;
  }

  /** DOM id of a tab, for consumers that label their tabpanel with aria-labelledby. */
  export function tabElementId(id: string): string {
    return `tab-${id}`;
  }
</script>

<script lang="ts">
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconAdd from 'virtual:icons/material-symbols/add';
  import TooltipTrigger from '$lib/components/TooltipTrigger.svelte';

  let {
    items,
    activeId,
    ariaLabel,
    closeLabel,
    addLabel,
    renameLabel,
    onSelect,
    onClose,
    onReorder,
    onAdd,
    onRename,
    onTabContextMenu,
    externalDrag,
    dropTargetId = null,
    maxItems
  }: {
    items: TabItem[];
    activeId: string | null;
    ariaLabel: string;
    closeLabel: (item: TabItem) => string;
    addLabel: string;
    renameLabel: string;
    onSelect: (id: string) => void;
    onClose?: (id: string) => void;
    onReorder?: (fromIndex: number, toIndex: number) => void;
    onAdd?: () => void;
    onRename?: (id: string, newLabel: string) => void;
    onTabContextMenu?: (event: MouseEvent, id: string) => void;
    externalDrag?: ExternalTabDrag;
    /** Tab highlighted as the target of an external drag. */
    dropTargetId?: string | null;
    maxItems?: number;
  } = $props();

  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let editInput = $state<HTMLInputElement | null>(null);
  let dragFromIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  const showClose = $derived(!!onClose && items.length > 1);
  const showAdd = $derived(!!onAdd && (!maxItems || items.length < maxItems));

  function canClose(item: TabItem): boolean {
    return showClose && item.closable !== false;
  }

  // ── Overflow detection ──
  let scrollEl = $state<HTMLElement | null>(null);
  let isOverflowLeft = $state(false);
  let isOverflowRight = $state(false);

  function checkOverflow() {
    if (!scrollEl) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollEl;
    isOverflowLeft = scrollLeft > 0;
    isOverflowRight = scrollLeft + clientWidth < scrollWidth - 1;
  }

  $effect(() => {
    if (!scrollEl) return;
    // Re-check when the strip resizes (window, layout) or its tabs do (added, closed, renamed)
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(scrollEl);
    for (const child of scrollEl.children) observer.observe(child);
    return () => observer.disconnect();
  });

  function handleWheel(event: WheelEvent) {
    if (scrollEl && scrollEl.scrollWidth > scrollEl.clientWidth) {
      event.preventDefault();
      scrollEl.scrollLeft += event.deltaY;
    }
  }

  // ── Rename ──
  $effect(() => {
    if (editingId && editInput) {
      editInput.focus();
      editInput.select();
    }
  });

  /** Starts inline renaming, e.g. from a consumer's context menu. */
  export function startRename(id: string) {
    const item = items.find((i) => i.id === id);
    if (!onRename || !item) return;
    editingId = id;
    editValue = item.label;
  }

  function stopRename(commit: boolean, refocus: boolean) {
    const id = editingId;
    if (!id) return;
    editingId = null;
    if (commit) onRename?.(id, editValue);
    // Back to the tab that holds the roving tabindex, which is the active one
    if (refocus) requestAnimationFrame(() => focusTab(activeId ?? id));
  }

  function handleEditKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      stopRename(true, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      stopRename(false, true);
    }
  }

  // ── Keyboard ──
  function focusTab(id: string) {
    document.getElementById(tabElementId(id))?.focus();
  }

  function selectAndFocus(item: TabItem | undefined) {
    if (!item) return;
    onSelect(item.id);
    // Synchronously, so fast repeated key presses each start from the newly focused tab
    focusTab(item.id);
  }

  /** Closing from the keyboard moves focus along; closing with the mouse leaves focus alone. */
  function closeTab(item: TabItem, refocus: boolean) {
    if (!canClose(item)) return;
    const index = items.findIndex((i) => i.id === item.id);
    // Matches the tab that closing activates: the next one, or the previous one for the last tab
    const nextId = (items[index + 1] ?? items[index - 1])?.id;
    onClose?.(item.id);
    if (refocus && nextId) requestAnimationFrame(() => focusTab(nextId));
  }

  function handleTabKeydown(event: KeyboardEvent, index: number) {
    const item = items[index];
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectAndFocus(items[index + 1] ?? items[0]);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectAndFocus(items[index - 1] ?? items[items.length - 1]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectAndFocus(items[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectAndFocus(items[items.length - 1]);
    } else if (event.key === 'Delete' && canClose(item)) {
      event.preventDefault();
      closeTab(item, true);
    } else if (event.key === 'F2' && onRename) {
      event.preventDefault();
      startRename(item.id);
    }
  }

  function keyShortcuts(item: TabItem): string | undefined {
    const keys = [canClose(item) && 'Delete', onRename && 'F2'].filter(Boolean);
    return keys.length > 0 ? keys.join(' ') : undefined;
  }

  // ── Mouse ──
  function handleMouseDown(event: MouseEvent) {
    // Suppress the browser's middle-click autoscroll
    if (event.button === 1) event.preventDefault();
  }

  function handleAuxClick(event: MouseEvent, item: TabItem) {
    if (event.button === 1) {
      event.preventDefault();
      closeTab(item, false);
    }
  }

  function handleAdd() {
    onAdd?.();
    // activeId is a prop, so this reads the newly added tab
    requestAnimationFrame(() => activeId && focusTab(activeId));
  }

  // ── Drag & drop ──
  function handleDragStart(event: DragEvent, index: number) {
    if (!onReorder) return;
    dragFromIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  function handleDragOver(event: DragEvent, index: number) {
    if (externalDrag?.accepts(event)) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      externalDrag.over(event, items[index].id);
      return;
    }
    if (dragFromIndex === null) return;
    event.preventDefault();
    dragOverIndex = index;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleDragLeave(event: DragEvent, index: number) {
    if (externalDrag?.accepts(event)) {
      externalDrag.leave(event, items[index].id);
    } else if (dragOverIndex === index) {
      dragOverIndex = null;
    }
  }

  function handleDrop(event: DragEvent, index: number) {
    event.preventDefault();
    if (externalDrag?.accepts(event)) {
      externalDrag.drop(event, items[index].id);
    } else if (dragFromIndex !== null && onReorder && dragFromIndex !== index) {
      onReorder(dragFromIndex, index);
    }
    dragFromIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    dragFromIndex = null;
    dragOverIndex = null;
  }
</script>

<div
  bind:this={scrollEl}
  class="tab-strip flex items-end gap-1 px-0.5 pt-0.5"
  style:--fade-left={isOverflowLeft ? 'var(--fade-size)' : '0px'}
  style:--fade-right={isOverflowRight ? 'var(--fade-size)' : '0px'}
  onwheel={handleWheel}
  onscroll={checkOverflow}
>
  <div class="flex shrink-0 items-end gap-1" role="tablist" aria-label={ariaLabel}>
    {#each items as item, index (item.id)}
      {@const isActive = item.id === activeId}
      {@const isDragOver =
        (dragOverIndex === index && dragFromIndex !== null && dragFromIndex !== index) ||
        dropTargetId === item.id}
      <div
        class="group has-[:focus-visible]:ring-primary flex max-w-56 shrink-0 items-center rounded-t-lg border-x border-t transition-colors has-[:focus-visible]:ring-2
          {isActive
          ? 'border-base-300 bg-base-100 text-base-content'
          : 'bg-base-200/50 text-muted hover:bg-base-200 hover:text-base-content border-transparent'}
          {isDragOver ? 'ring-primary ring-2' : ''}
          {dragFromIndex === index ? 'opacity-50' : ''}"
      >
        {#if editingId === item.id}
          <!-- The input replaces the tab while renaming: nested in the tab it would be
               interactive content inside a button, and its keys would reach the tab's
               shortcuts. The tablist briefly owns a textbox, which axe reports as
               aria-required-children; focus is in the labelled input meanwhile. -->
          <input
            bind:this={editInput}
            bind:value={editValue}
            class="mx-3 my-1.5 w-24 min-w-0 border-b border-current bg-transparent text-sm outline-none"
            aria-label={renameLabel}
            onblur={() => stopRename(true, false)}
            onkeydown={handleEditKeydown}
          />
        {:else}
          <button
            type="button"
            id={tabElementId(item.id)}
            class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-t-lg px-3 py-1.5 text-sm select-none focus-visible:outline-none"
            role="tab"
            aria-selected={isActive}
            aria-keyshortcuts={keyShortcuts(item)}
            tabindex={isActive ? 0 : -1}
            title={item.label}
            draggable={onReorder ? 'true' : 'false'}
            ondragstart={(e) => handleDragStart(e, index)}
            ondragover={(e) => handleDragOver(e, index)}
            ondragleave={(e) => handleDragLeave(e, index)}
            ondrop={(e) => handleDrop(e, index)}
            ondragend={handleDragEnd}
            onclick={() => onSelect(item.id)}
            onkeydown={(e) => handleTabKeydown(e, index)}
            ondblclick={() => startRename(item.id)}
            onmousedown={handleMouseDown}
            onauxclick={(e) => handleAuxClick(e, item)}
            oncontextmenu={onTabContextMenu ? (e) => onTabContextMenu(e, item.id) : undefined}
          >
            <span class="truncate">{item.label}</span>
          </button>
        {/if}

        {#if canClose(item)}
          <!-- A tablist may only contain tabs, so the close button is a mouse-only
               affordance; keyboard and screen-reader users close tabs with Delete. -->
          <TooltipTrigger text={closeLabel(item)} orientation="down">
            <button
              type="button"
              class="btn btn-ghost btn-xs mr-1 h-5 min-h-0 w-5 p-0 opacity-0 group-hover:opacity-100
                {isActive ? 'opacity-60' : ''}"
              tabindex="-1"
              aria-hidden="true"
              aria-label={closeLabel(item)}
              onclick={() => closeTab(item, false)}
            >
              <IconClose class="h-3 w-3" aria-hidden="true" />
            </button>
          </TooltipTrigger>
        {/if}
      </div>
    {/each}
  </div>

  {#if showAdd}
    <TooltipTrigger text={addLabel} orientation="down">
      <button
        type="button"
        class="btn btn-ghost btn-xs mb-0.5 h-7 min-h-0 shrink-0 px-2"
        aria-label={addLabel}
        onclick={handleAdd}
      >
        <IconAdd class="h-4 w-4" aria-hidden="true" />
      </button>
    </TooltipTrigger>
  {/if}
</div>

<style>
  .tab-strip {
    overflow-x: auto;
    scrollbar-width: none; /* Firefox */
    /* Fade out tabs at the scrolled edges; a mask works on any background. Narrow
       strips get narrower fades, and scroll-padding keeps a focused tab clear of them. */
    --fade-size: min(3rem, 15%);
    scroll-padding-inline: var(--fade-size);
    mask-image: linear-gradient(
      to right,
      transparent,
      #000 var(--fade-left),
      #000 calc(100% - var(--fade-right)),
      transparent
    );
  }
  .tab-strip::-webkit-scrollbar {
    display: none; /* Chrome */
  }
</style>
