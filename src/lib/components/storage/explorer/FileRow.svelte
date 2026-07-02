<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import IconMoreHoriz from 'virtual:icons/material-symbols/more-horiz';
  import { keyToName, formatFileSize, isArchiveExtension } from '$lib/storage/utils.js';
  import type { StorageObject } from '$lib/storage/types.js';
  import TimestampDisplay from '$lib/components/storage/shared/TimestampDisplay.svelte';
  import FileIconAndName from './file-icon/FileIconAndName.svelte';
  import { getStorageState } from '$lib/storage/context.js';
  import { storageCutCopyEnabled } from '$lib/client/feature-flags.js';

  interface Props {
    file: StorageObject;
  }

  let { file }: Props = $props();

  const storage = getStorageState();

  const selected = $derived(storage.selectedKeys.has(file.key));
  const isCtx = $derived(storage.contextMenu?.key === file.key);
  const isArchive = $derived(isArchiveExtension(file.key));
  const isCut = $derived(storage.isCutKey(file.key));

  function handleDragStart(e: DragEvent) {
    if (!storageCutCopyEnabled) return;
    // Auto-select the dragged item if not already selected
    if (!storage.selectedKeys.has(file.key)) {
      storage.selectedKeys = new SvelteSet<string>([file.key]);
    }
    e.dataTransfer?.setData(
      'application/x-storage-keys',
      JSON.stringify([...storage.selectedKeys])
    );
    e.dataTransfer!.effectAllowed = 'move';
  }
</script>

<tr
  class="
    group cursor-pointer select-none
    {isCut ? 'opacity-40' : ''}
    {isCtx
    ? 'bg-base-300 outline-base-content/30 outline -outline-offset-2'
    : selected
      ? 'bg-primary/10 hover:bg-primary/15'
      : 'hover:bg-base-200/60'}"
  draggable={storageCutCopyEnabled && !storage.isInArchive}
  ondragstart={handleDragStart}
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
    <FileIconAndName {file} />
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
