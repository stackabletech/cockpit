<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import Icon from '@iconify/svelte';
  import SelectionToolbar from './SelectionToolbar.svelte';
  import { fileIconKind, iconColors, formatDate, keyToName } from '$lib/storage/utils.js';
  import type { StorageObject } from '$lib/storage/types.js';
  import { flip } from 'svelte/animate';
  import prettyBytes from 'pretty-bytes';

  interface Props {
    prefix: string;
    folders: StorageObject[];
    files: StorageObject[];
    selectedKeys: Set<string>;
    ctxKey: string | null;
    showCheckboxes: boolean;
    allSelected: boolean;
    someSelected: boolean;
    onnavigate: (prefix: string) => void;
    onSelectAll: (checked: boolean) => void;
    onToggleSelect: (key: string, force?: boolean) => void;
    onContextMenu: (e: MouseEvent, key: string) => void;
    onaction: (action: string) => void;
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
    onnavigate,
    onSelectAll,
    onToggleSelect,
    onContextMenu,
    onaction
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
  const canDownload = $derived(selectedFileCount > 0);

  let selectAllEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (selectAllEl) selectAllEl.indeterminate = someSelected;
  });

  function navigateUp() {
    if (!prefix) return;
    const withoutTrailing = prefix.slice(0, -1);
    const lastSlash = withoutTrailing.lastIndexOf('/');
    onnavigate(lastSlash === -1 ? '' : withoutTrailing.slice(0, lastSlash + 1));
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
      <SelectionToolbar {selectedCount} {canPreview} {canRename} {canDownload} {onaction} />
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
        <tr
          animate:flip={{ duration: 200 }}
          class="
            group cursor-pointer select-none
            {ctxKey === folder.key
            ? 'bg-base-300 outline-base-content/30 outline -outline-offset-2'
            : selectedKeys.has(folder.key)
              ? `
                bg-primary/10
                hover:bg-primary/15
              `
              : 'hover'}"
          onclick={(e) => {
            if (showCheckboxes || e.ctrlKey || e.metaKey) {
              onToggleSelect(folder.key, true);
            } else {
              onnavigate(folder.key);
            }
          }}
          ondblclick={(e) => {
            if (e.ctrlKey || e.metaKey) {
              onnavigate(folder.key);
            }
          }}
          oncontextmenu={(e) => onContextMenu(e, folder.key)}
        >
          <td class="pr-0">
            <input
              type="checkbox"
              class="
                checkbox checkbox-xs
                {!showCheckboxes ? `pointer-events-none invisible` : ''}"
              checked={selectedKeys.has(folder.key)}
              onchange={() => onToggleSelect(folder.key, true)}
              onclick={(e) => e.stopPropagation()}
              disabled={!showCheckboxes}
              aria-label="Select {keyToName(folder.key)}"
            />
          </td>
          <td>
            <div class="flex items-center gap-2.5">
              <Icon
                icon="material-symbols:folder"
                class="text-warning size-5 shrink-0"
                aria-hidden="true"
              />
              <span class="font-medium">{keyToName(folder.key)}/</span>
            </div>
          </td>
          <td class="text-base-content/30 text-right">—</td>
          <td class="text-base-content/30">—</td>
          <td class="w-10 py-0 pr-2 text-right">
            <button
              class="
                btn btn-ghost btn-xs opacity-0
                group-hover:opacity-100
              "
              title="Actions"
              aria-label="Actions for {keyToName(folder.key)}"
              onclick={(e) => onContextMenu(e, folder.key)}
            >
              <Icon icon="material-symbols:more-horiz" class="size-4" aria-hidden="true" />
            </button>
          </td>
        </tr>
      {/each}

      <!-- Files -->
      {#each files as file (file.key)}
        {@const kind = fileIconKind(file.contentType)}
        {@const color = iconColors[kind]}
        <tr
          animate:flip={{ duration: 200 }}
          class="
            group cursor-pointer select-none
            {ctxKey === file.key
            ? 'bg-base-300 outline-base-content/30 outline -outline-offset-2'
            : selectedKeys.has(file.key)
              ? `
                bg-primary/10
                hover:bg-primary/15
              `
              : 'hover'}"
          onclick={(e) => onToggleSelect(file.key, e.ctrlKey || e.metaKey)}
          ondblclick={() => onaction('preview')}
          oncontextmenu={(e) => onContextMenu(e, file.key)}
        >
          <td class="pr-0">
            <input
              type="checkbox"
              class="
                checkbox checkbox-xs
                {!showCheckboxes ? `pointer-events-none invisible` : ''}"
              checked={selectedKeys.has(file.key)}
              onchange={() => onToggleSelect(file.key, true)}
              onclick={(e) => e.stopPropagation()}
              disabled={!showCheckboxes}
              aria-label="Select {keyToName(file.key)}"
            />
          </td>
          <td>
            <div class="flex items-center gap-2.5">
              {#if kind === 'image'}
                <Icon
                  icon="material-symbols:image"
                  class="
                    size-5 shrink-0
                    {color}"
                  aria-hidden="true"
                />
              {:else if kind === 'code'}
                <Icon
                  icon="material-symbols:code"
                  class="
                    size-5 shrink-0
                    {color}"
                  aria-hidden="true"
                />
              {:else if kind === 'archive'}
                <Icon
                  icon="material-symbols:archive"
                  class="
                    size-5 shrink-0
                    {color}"
                  aria-hidden="true"
                />
              {:else if kind === 'pdf'}
                <Icon
                  icon="material-symbols:picture-as-pdf"
                  class="
                    size-5 shrink-0
                    {color}"
                  aria-hidden="true"
                />
              {:else}
                <!-- text / document fallback -->
                <Icon
                  icon="material-symbols:description"
                  class="
                    size-5 shrink-0
                    {color}"
                  aria-hidden="true"
                />
              {/if}
              <span class="truncate">{keyToName(file.key)}</span>
              {#if file.contentType}
                <span
                  class="
                    badge badge-ghost badge-sm ml-1 shrink-0 text-[10px]
                    opacity-50
                  "
                >
                  {file.contentType.split('/').at(-1) ?? ''}
                </span>
              {/if}
            </div>
          </td>
          <td class="text-right font-mono text-sm">{prettyBytes(file.size)}</td>
          <td class="text-base-content/60 text-sm">{formatDate(file.lastModified)}</td>
          <td class="w-10 py-0 pr-2 text-right">
            <button
              class="
                btn btn-ghost btn-xs opacity-0
                group-hover:opacity-100
              "
              title="Actions"
              aria-label="Actions for {keyToName(file.key)}"
              onclick={(e) => onContextMenu(e, file.key)}
            >
              <Icon icon="material-symbols:more-horiz" class="size-4" aria-hidden="true" />
            </button>
          </td>
        </tr>
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
