<script lang="ts">
  import IconImage from 'virtual:icons/material-symbols/image';
  import IconCode from 'virtual:icons/material-symbols/code';
  import IconArchive from 'virtual:icons/material-symbols/archive';
  import IconPictureAsPdf from 'virtual:icons/material-symbols/picture-as-pdf';
  import IconDescription from 'virtual:icons/material-symbols/description';
  import IconMoreHoriz from 'virtual:icons/material-symbols/more-horiz';
  import {
    fileIconKind,
    iconColors,
    keyToName,
    formatFileSize,
    isArchiveExtension
  } from '$lib/storage/utils.js';
  import type { StorageObject } from '$lib/storage/types.js';
  import TimestampDisplay from '$lib/components/storage/shared/TimestampDisplay.svelte';
  import { getStorageState } from '$lib/storage/context.js';

  interface Props {
    file: StorageObject;
  }

  let { file }: Props = $props();

  const storage = getStorageState();

  const selected = $derived(storage.selectedKeys.has(file.key));
  const isCtx = $derived(storage.contextMenu?.key === file.key);
  const kind = $derived(fileIconKind(file.contentType));
  const color = $derived(iconColors[kind]);
  const isArchive = $derived(isArchiveExtension(file.key));
</script>

<tr
  class="
    group cursor-pointer select-none
    {isCtx
    ? 'bg-base-300 outline-base-content/30 outline -outline-offset-2'
    : selected
      ? 'bg-primary/10 hover:bg-primary/15'
      : 'hover:bg-base-200/60'}"
  onclick={(e) => storage.toggleSelect(file.key, e.ctrlKey || e.metaKey)}
  ondblclick={() => {
    if (isArchive) {
      void storage.enterArchive(file.key);
    } else {
      storage.executeAction('preview');
    }
  }}
  oncontextmenu={(e) => storage.openContextMenu(e, file.key)}
>
  <td class="pr-0">
    <input
      type="checkbox"
      class="checkbox checkbox-xs {!storage.showCheckboxes ? 'pointer-events-none invisible' : ''}"
      checked={selected}
      onchange={() => storage.toggleSelect(file.key, true)}
      onclick={(e) => e.stopPropagation()}
      disabled={!storage.showCheckboxes}
      aria-label="Select {keyToName(file.key)}"
    />
  </td>
  <td>
    <div class="flex items-center gap-2.5">
      {#if kind === 'image'}
        <IconImage class="size-5 shrink-0 {color}" aria-hidden="true" />
      {:else if kind === 'code'}
        <IconCode class="size-5 shrink-0 {color}" aria-hidden="true" />
      {:else if kind === 'archive'}
        <IconArchive class="size-5 shrink-0 {color}" aria-hidden="true" />
      {:else if kind === 'pdf'}
        <IconPictureAsPdf class="size-5 shrink-0 {color}" aria-hidden="true" />
      {:else}
        <IconDescription class="size-5 shrink-0 {color}" aria-hidden="true" />
      {/if}
      <span class="truncate">{keyToName(file.key)}</span>
      {#if file.contentType}
        <span class="badge badge-ghost badge-sm ml-1 shrink-0 text-[10px] opacity-50">
          {file.contentType.split('/').at(-1) ?? ''}
        </span>
      {/if}
    </div>
  </td>
  <td class="text-right font-mono text-sm">{formatFileSize(file.size)}</td>
  <td class="text-base-content/60 text-sm"
    ><TimestampDisplay date={file.lastModified} relative /></td
  >
  <td class="w-10 py-0 pr-2 text-right">
    <button
      class="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100"
      title="Actions"
      aria-label="Actions for {keyToName(file.key)}"
      onclick={(e) => storage.openContextMenu(e, file.key)}
    >
      <IconMoreHoriz class="size-4" aria-hidden="true" />
    </button>
  </td>
</tr>
