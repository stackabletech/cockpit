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

  import { storageMoveEnabled } from '$lib/client/feature-flags.js';

  function navigateUp() {
    if (storage.isInArchive) {
      storage.navigateUpFromArchive();
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

  function handleTableDragOver(e: DragEvent) {
    if (!storageMoveEnabled || storage.isInArchive) return;
    if (!e.dataTransfer?.types.includes('application/x-storage-keys')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    tableDragOver = true;
  }

  function handleTableDragLeave(e: DragEvent) {
    // Only clear if we're leaving the table container entirely
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
    tableDragOver = false;
  }

  function handleTableDrop(e: DragEvent) {
    tableDragOver = false;
    if (!storageMoveEnabled || storage.isInArchive) return;
    e.preventDefault();
    const raw = e.dataTransfer?.getData('application/x-storage-keys');
    if (!raw) return;
    try {
      const keys: string[] = JSON.parse(raw);
      void storage.performMove(storage.prefix, keys);
    } catch {
      // invalid JSON - ignore
    }
  }

  function handleParentDragOver(e: DragEvent) {
    if (!storageMoveEnabled || storage.isInArchive || !storage.prefix) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    parentDragOver = true;
  }

  function handleParentDragLeave() {
    parentDragOver = false;
  }

  function handleParentDrop(e: DragEvent) {
    parentDragOver = false;
    if (!storageMoveEnabled || storage.isInArchive || !storage.prefix) return;
    e.preventDefault();
    const raw = e.dataTransfer?.getData('application/x-storage-keys');
    if (!raw) return;
    try {
      const keys: string[] = JSON.parse(raw);
      void storage.performMove(parentPrefix(), keys);
    } catch {
      // invalid JSON - ignore
    }
  }

  function handleEmptyDragOver(e: DragEvent) {
    if (!storageMoveEnabled || storage.isInArchive) return;
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
    if (!storageMoveEnabled || storage.isInArchive) return;
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer?.getData('application/x-storage-keys');
    if (!raw) return;
    try {
      const keys: string[] = JSON.parse(raw);
      void storage.performMove(storage.prefix, keys);
    } catch {
      // invalid JSON - ignore
    }
  }
</script>

<div
  class="preview-scroll h-full overflow-x-auto overflow-y-auto {tableDragOver
    ? 'outline-primary/40 outline -outline-offset-2 outline-dashed'
    : ''}"
  ondragover={handleTableDragOver}
  ondragleave={handleTableDragLeave}
  ondrop={handleTableDrop}
>
  <table class="table-sm table">
    <thead class="bg-base-100 sticky top-0 z-10">
      <!-- Selection action toolbar -->
      <SelectionToolbar />

      <!-- Column headers -->
      <tr
        class="
          bg-base-200 text-base-content/50 text-xs tracking-wide uppercase
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
          class="hover cursor-pointer {parentDragOver
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

      {#if storage.archiveTooLarge}
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
        {#if storage.folders.length === 0 && storage.files.length === 0}
          <tr
            class={emptyDragOver
              ? 'bg-primary/20 outline-primary/50 outline -outline-offset-2'
              : ''}
            ondragover={handleEmptyDragOver}
            ondragleave={handleEmptyDragLeave}
            ondrop={handleEmptyDrop}
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
