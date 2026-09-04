<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import IconArrowBack from 'virtual:icons/material-symbols/arrow-back';
  import IconFolderOpen from 'virtual:icons/material-symbols/folder-open';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import SelectionToolbar from './SelectionToolbar.svelte';
  import FolderRow from './FolderRow.svelte';
  import FileRow from './FileRow.svelte';
  import { getStorageState } from '$lib/storage/context.js';

  const storage = getStorageState();

  let selectAllEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (selectAllEl) selectAllEl.indeterminate = storage.someSelected;
  });

  import { parseStorageDropKeys, canStorageDrop } from '$lib/storage/drag-handlers.js';

  function navigateUp() {
    if (storage.archive.isInArchive) {
      storage.archive.navigateUpFromArchive();
      return;
    }
    if (!storage.prefix) return;
    const withoutTrailing = storage.prefix.slice(0, -1);
    const lastSlash = withoutTrailing.lastIndexOf('/');
    storage.navigate(lastSlash === -1 ? '' : withoutTrailing.slice(0, lastSlash + 1));
  }

  function parentPrefix(): string {
    if (!storage.prefix) return '';
    const withoutTrailing = storage.prefix.slice(0, -1);
    const lastSlash = withoutTrailing.lastIndexOf('/');
    return lastSlash === -1 ? '' : withoutTrailing.slice(0, lastSlash + 1);
  }

  let tableDragOver = $state(false);
  let parentDragOver = $state(false);
  let emptyDragOver = $state(false);

  let scrollContainer = $state<HTMLElement | null>(null);
  let autoScrollAnimFrame = $state<number | null>(null);

  const EDGE_THICKNESS = 40;
  const BASE_SCROLL_SPEED = 3;
  const MAX_SCROLL_SPEED = 8;

  let headerEl = $state<HTMLElement | null>(null);

  function stopAutoScroll() {
    if (autoScrollAnimFrame !== null) {
      cancelAnimationFrame(autoScrollAnimFrame);
      autoScrollAnimFrame = null;
    }
  }

  function contentEdgeY(clientY: number): number | null {
    const container = scrollContainer;
    if (!container) return null;
    const bodyTop = headerEl
      ? headerEl.getBoundingClientRect().bottom
      : container.getBoundingClientRect().top;
    return clientY - bodyTop;
  }

  function handleTableDragOver(e: DragEvent) {
    if (!canStorageDrop(storage)) return;
    if (!e.dataTransfer?.types.includes('application/x-storage-keys')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    tableDragOver = true;

    const container = scrollContainer;
    if (!container) return;
    const edgeY = contentEdgeY(e.clientY);
    if (edgeY === null) return;
    const el = container as HTMLElement;
    if (edgeY < EDGE_THICKNESS && el.scrollTop > 0) {
      const factor = 1 - edgeY / EDGE_THICKNESS;
      const speed = BASE_SCROLL_SPEED + (MAX_SCROLL_SPEED - BASE_SCROLL_SPEED) * factor;
      stopAutoScroll();
      function tick() {
        const newTop = el.scrollTop - speed;
        if (newTop <= 0) {
          el.scrollTop = 0;
          stopAutoScroll();
          return;
        }
        el.scrollTop = newTop;
        autoScrollAnimFrame = requestAnimationFrame(tick);
      }
      autoScrollAnimFrame = requestAnimationFrame(tick);
    } else {
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y > rect.height - EDGE_THICKNESS && el.scrollTop < el.scrollHeight - el.clientHeight) {
        const factor = (y - (rect.height - EDGE_THICKNESS)) / EDGE_THICKNESS;
        const speed = BASE_SCROLL_SPEED + (MAX_SCROLL_SPEED - BASE_SCROLL_SPEED) * factor;
        stopAutoScroll();
        function tick() {
          const newTop = el.scrollTop + speed;
          const maxScroll = el.scrollHeight - el.clientHeight;
          if (newTop >= maxScroll) {
            el.scrollTop = maxScroll;
            stopAutoScroll();
            return;
          }
          el.scrollTop = newTop;
          autoScrollAnimFrame = requestAnimationFrame(tick);
        }
        autoScrollAnimFrame = requestAnimationFrame(tick);
      } else {
        stopAutoScroll();
      }
    }
  }

  function handleTableDragLeave(e: DragEvent) {
    // Only clear if we're leaving the table container entirely
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
    stopAutoScroll();
    tableDragOver = false;
  }

  function handleTableDrop(e: DragEvent) {
    stopAutoScroll();
    tableDragOver = false;
    if (!canStorageDrop(storage)) return;
    e.preventDefault();
    const keys = parseStorageDropKeys(e);
    if (!keys) return;
    void storage.performMove(storage.prefix, keys);
  }

  function handleParentDragOver(e: DragEvent) {
    if (!canStorageDrop(storage) || !storage.prefix) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    parentDragOver = true;
  }

  function handleParentDragLeave() {
    parentDragOver = false;
  }

  function handleParentDrop(e: DragEvent) {
    parentDragOver = false;
    if (!canStorageDrop(storage) || !storage.prefix) return;
    e.preventDefault();
    const keys = parseStorageDropKeys(e);
    if (!keys) return;
    void storage.performMove(parentPrefix(), keys);
  }

  function handleEmptyDragOver(e: DragEvent) {
    if (!canStorageDrop(storage)) return;
    if (!e.dataTransfer?.types.includes('application/x-storage-keys')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    emptyDragOver = true;
  }

  function handleEmptyDragLeave() {
    emptyDragOver = false;
  }

  function handleEmptyDrop(e: DragEvent) {
    emptyDragOver = false;
    if (!canStorageDrop(storage)) return;
    e.preventDefault();
    e.stopPropagation();
    const keys = parseStorageDropKeys(e);
    if (!keys) return;
    void storage.performMove(storage.prefix, keys);
  }
</script>

<div
  bind:this={scrollContainer}
  role="region"
  class="h-full overflow-x-auto overflow-y-auto {tableDragOver
    ? 'outline-primary/40 outline -outline-offset-2 outline-dashed'
    : ''}"
  ondragover={handleTableDragOver}
  ondragleave={handleTableDragLeave}
  ondrop={handleTableDrop}
>
  <table class="table-sm table">
    <thead bind:this={headerEl} class="bg-base-100 sticky top-0 z-10">
      <!-- Selection action toolbar -->
      <SelectionToolbar />

      <!-- Column headers -->
      <tr
        class="
          bg-base-200 text-base-content/50 z-10 text-xs tracking-wide uppercase
        "
      >
        <th class="w-8 pr-0">
          <input
            type="checkbox"
            class="
              checkbox checkbox-xs
              {!storage.showCheckboxes ? `pointer-events-none invisible` : ''}"
            bind:this={selectAllEl}
            checked={storage.allSelected}
            onchange={(e) => storage.selectAll(e.currentTarget.checked)}
            onclick={(e) => e.stopPropagation()}
            disabled={!storage.showCheckboxes}
            aria-label="Select all"
          />
        </th>
        <th class="w-7/12 font-semibold">{m.storage_header_name()}</th>
        <th class="w-2/12 text-right font-semibold">{m.storage_header_size()}</th>
        <th class="w-3/12 font-semibold">{m.storage_header_last_modified()}</th>
        <th class="w-10"></th>
      </tr>
    </thead>

    <tbody>
      <!-- Parent directory row -->
      {#if storage.prefix}
        <tr
          class="cursor-pointer {parentDragOver
            ? 'bg-primary/20 outline-primary/50 outline -outline-offset-2'
            : ''}"
          onclick={navigateUp}
          ondragover={handleParentDragOver}
          ondragleave={handleParentDragLeave}
          ondrop={handleParentDrop}
        >
          <td class="pr-0"></td>
          <td colspan={3}>
            <div class="text-base-content/50 flex items-center gap-2">
              <IconArrowBack class="size-4 shrink-0" aria-hidden="true" />
              <span class="tracking-widest italic" aria-label={m.storage_parent_dir()}>...</span>
            </div>
          </td>
          <td></td>
        </tr>
      {/if}

      {#if storage.loading && storage.folders.length === 0 && storage.files.length === 0}
        {#each [75, 60, 85, 45, 90] as width, i (i)}
          <tr>
            <td class="pr-0"><div class="skeleton h-4 w-4 animate-pulse rounded"></div></td>
            <td><div class="skeleton h-4 animate-pulse rounded" style="width: {width}%"></div></td>
            <td><div class="skeleton ml-auto h-4 w-16 animate-pulse rounded"></div></td>
            <td><div class="skeleton h-4 w-24 animate-pulse rounded"></div></td>
            <td></td>
          </tr>
        {/each}
      {/if}

      {#if storage.archive.archiveTooLarge}
        <!-- Archive too large fallback -->
        <tr>
          <td colspan={5} class="py-16 text-center">
            <IconWarning class="text-warning mx-auto mb-3 size-10" aria-hidden="true" />
            <p class="text-base-content font-semibold">{m.storage_archive_too_large()}</p>
          </td>
        </tr>
      {:else}
        <!-- Folders -->
        {#each storage.folders as folder (folder.key)}
          <FolderRow {folder} />
        {/each}

        <!-- Files -->
        {#each storage.files as file (file.key)}
          <FileRow {file} />
        {/each}

        <!-- Empty folder -->
        {#if !storage.loading && storage.folders.length === 0 && storage.files.length === 0}
          <tr
            class={emptyDragOver
              ? 'bg-primary/20 outline-primary/50 outline -outline-offset-2'
              : ''}
            ondragover={handleEmptyDragOver}
            ondragleave={handleEmptyDragLeave}
            ondrop={handleEmptyDrop}
            oncontextmenu={(e) => storage.openEmptyContextMenu(e)}
          >
            <td colspan={5} class="text-base-content/40 py-16 text-center">
              <IconFolderOpen class="mx-auto mb-3 size-10 opacity-30" aria-hidden="true" />
              {m.storage_bucket_empty()}
            </td>
          </tr>
        {/if}
      {/if}
    </tbody>
  </table>
</div>
