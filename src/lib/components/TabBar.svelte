<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  interface TabItem {
    id: string;
    label: string;
    closable?: boolean;
  }

  let {
    items,
    activeId = $bindable(),
    onSelect,
    onClose,
    onReorder,
    onAdd,
    onRename,
    maxItems
  }: {
    items: TabItem[];
    activeId: string;
    onSelect: (id: string) => void;
    onClose?: (id: string) => void;
    onReorder?: (fromIndex: number, toIndex: number) => void;
    onAdd?: () => void;
    onRename?: (id: string, newLabel: string) => void;
    maxItems?: number;
  } = $props();

  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let editInput = $state<HTMLInputElement | null>(null);
  let dragFromIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  const showClose = $derived(items.length > 1);
  const showAdd = $derived(!maxItems || items.length < maxItems);

  function startRename(id: string, currentLabel: string) {
    if (!onRename) return;
    editingId = id;
    editValue = currentLabel;
    // Focus the input after it renders.
    requestAnimationFrame(() => editInput?.select());
  }

  function commitRename() {
    if (editingId && onRename) {
      onRename(editingId, editValue);
    }
    editingId = null;
  }

  function cancelRename() {
    editingId = null;
  }

  function handleEditKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  }

  function handleTabKeydown(event: KeyboardEvent, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = items[index + 1] ?? items[0];
      onSelect(next.id);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const prev = items[index - 1] ?? items[items.length - 1];
      onSelect(prev.id);
    } else if (event.key === 'Delete' && onClose && showClose) {
      event.preventDefault();
      const item = items[index];
      if (item.closable !== false) onClose(item.id);
    }
  }

  function handleDragStart(event: DragEvent, index: number) {
    if (!onReorder) return;
    dragFromIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  function handleDragOver(event: DragEvent, index: number) {
    if (dragFromIndex === null) return;
    event.preventDefault();
    dragOverIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function handleDrop(event: DragEvent, index: number) {
    event.preventDefault();
    if (dragFromIndex !== null && onReorder && dragFromIndex !== index) {
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

<div class="flex items-end gap-1 overflow-x-auto" role="tablist">
  {#each items as item, index (item.id)}
    {@const isActive = item.id === activeId}
    {@const isDragOver =
      dragOverIndex === index && dragFromIndex !== null && dragFromIndex !== index}
    <div
      class="group flex max-w-48 items-center gap-1 rounded-t-lg border-x border-t px-3 py-1.5 text-sm transition-colors select-none
        {isActive
        ? 'border-base-300 bg-base-100 text-base-content'
        : 'bg-base-200/50 text-base-content/60 hover:bg-base-200 hover:text-base-content/80 border-transparent'}
        {isDragOver ? 'ring-primary ring-2' : ''}"
      role="tab"
      aria-selected={isActive}
      tabindex={isActive ? 0 : -1}
      draggable={onReorder ? 'true' : 'false'}
      ondragstart={(e) => handleDragStart(e, index)}
      ondragover={(e) => handleDragOver(e, index)}
      ondrop={(e) => handleDrop(e, index)}
      ondragend={handleDragEnd}
      onclick={() => onSelect(item.id)}
      onkeydown={(e) => handleTabKeydown(e, index)}
      ondblclick={() => startRename(item.id, item.label)}
    >
      {#if editingId === item.id}
        <input
          bind:this={editInput}
          bind:value={editValue}
          class="input input-xs w-24 min-w-0"
          aria-label={m.trino_tab_rename()}
          onblur={commitRename}
          onkeydown={handleEditKeydown}
        />
      {:else}
        <span class="truncate">{item.label}</span>
      {/if}

      {#if showClose && item.closable !== false}
        <button
          type="button"
          class="btn btn-ghost btn-xs ml-1 h-5 min-h-0 w-5 p-0 opacity-0 group-hover:opacity-100
            {isActive ? 'opacity-60' : ''}"
          aria-label={m.trino_tab_close({ name: item.label })}
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            onClose?.(item.id);
          }}
        >
          <svg
            class="h-3 w-3"
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
          >
        </button>
      {/if}
    </div>
  {/each}

  {#if onAdd && showAdd}
    <button
      type="button"
      class="btn btn-ghost btn-xs mb-0.5 h-7 min-h-0 px-2"
      aria-label={m.trino_tab_new()}
      onclick={onAdd}
    >
      <svg
        class="h-4 w-4"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg
      >
    </button>
  {/if}
</div>
