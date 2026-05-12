<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import Icon from '@iconify/svelte';
  import SelectionToolbar from './SelectionToolbar.svelte';
  import FolderRow from './FolderRow.svelte';
  import FileRow from './FileRow.svelte';
  import type { StorageObject } from '$lib/storage/types.js';

  interface Props {
    prefix: string;
    folders: StorageObject[];
    files: StorageObject[];
    selectedKeys: Set<string>;
    ctxKey: string | null;
    showCheckboxes: boolean;
    allSelected: boolean;
    someSelected: boolean;
    onNavigate: (prefix: string, continuationToken?: string | null, pageSize?: number) => void;
    onSelectAll: (checked: boolean) => void;
    onToggleSelect: (key: string, force?: boolean) => void;
    onContextMenu: (e: MouseEvent, key: string) => void;
    onAction: (action: string) => void;
  }

  let {
    prefix,
    folders,
    files,
    selectedKeys,
    ctxKey,
    showCheckboxes,
    allSelected,
    someSelected,
    onNavigate,
    onSelectAll,
    onToggleSelect,
    onContextMenu,
    onAction
  }: Props = $props();

  const selectedCount = $derived(selectedKeys.size);
  const canPreview = $derived(
    files.filter((f) => selectedKeys.has(f.key)).length === 1 &&
      folders.filter((f) => selectedKeys.has(f.key)).length === 0
  );
  const selectedFileCount = $derived(files.filter((f) => selectedKeys.has(f.key)).length);
  const canRename = $derived(
    (selectedFileCount === 1 && folders.filter((f) => selectedKeys.has(f.key)).length === 0) ||
      (folders.filter((f) => selectedKeys.has(f.key)).length === 1 && selectedFileCount === 0)
  );
  const canDownload = $derived(
    selectedFileCount === 1 && folders.filter((f) => selectedKeys.has(f.key)).length === 0
  );

  let selectAllEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (selectAllEl) selectAllEl.indeterminate = someSelected;
  });

  function navigateUp() {
    if (!prefix) return;
    const withoutTrailing = prefix.slice(0, -1);
    const lastSlash = withoutTrailing.lastIndexOf('/');
    onNavigate(lastSlash === -1 ? '' : withoutTrailing.slice(0, lastSlash + 1));
  }
</script>

<div class="overflow-x-auto">
  <table class="table-sm table">
    <thead>
      <!-- Column headers -->
      <tr
        class="
          bg-base-200/60 text-base-content/50 text-xs tracking-wide uppercase
        "
      >
        <th class="w-8 pr-0">
          <input
            type="checkbox"
            class="
              checkbox checkbox-xs
              {!showCheckboxes ? `pointer-events-none invisible` : ''}"
            bind:this={selectAllEl}
            checked={allSelected}
            onchange={(e) => onSelectAll(e.currentTarget.checked)}
            onclick={(e) => e.stopPropagation()}
            disabled={!showCheckboxes}
            aria-label="Select all"
          />
        </th>
        <th class="w-7/12 font-semibold">{m.storage_header_name()}</th>
        <th class="w-2/12 text-right font-semibold">{m.storage_header_size()}</th>
        <th class="w-3/12 font-semibold">{m.storage_header_last_modified()}</th>
        <th class="w-10"></th>
      </tr>

      <!-- Selection action toolbar -->
      <SelectionToolbar {selectedCount} {canPreview} {canRename} {canDownload} {onAction} />
    </thead>

    <tbody>
      <!-- Parent directory row -->
      {#if prefix}
        <tr class="hover cursor-pointer" onclick={navigateUp}>
          <td class="pr-0"></td>
          <td colspan={3}>
            <div class="text-base-content/50 flex items-center gap-2">
              <Icon icon="material-symbols:arrow-back" class="size-4 shrink-0" aria-hidden="true" />
              <span class="tracking-widest italic" aria-label={m.storage_parent_dir()}>...</span>
            </div>
          </td>
          <td></td>
        </tr>
      {/if}

      <!-- Folders -->
      {#each folders as folder (folder.key)}
        <FolderRow
          {folder}
          selected={selectedKeys.has(folder.key)}
          isCtx={ctxKey === folder.key}
          {showCheckboxes}
          {onNavigate}
          {onToggleSelect}
          {onContextMenu}
        />
      {/each}

      <!-- Files -->
      {#each files as file (file.key)}
        <FileRow
          {file}
          selected={selectedKeys.has(file.key)}
          isCtx={ctxKey === file.key}
          {showCheckboxes}
          {onToggleSelect}
          {onContextMenu}
          {onAction}
        />
      {/each}

      <!-- Empty folder -->
      {#if folders.length === 0 && files.length === 0}
        <tr>
          <td colspan={5} class="text-base-content/40 py-16 text-center">
            <Icon
              icon="material-symbols:folder-open"
              class="mx-auto mb-3 size-10 opacity-30"
              aria-hidden="true"
            />
            {m.storage_bucket_empty()}
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>
