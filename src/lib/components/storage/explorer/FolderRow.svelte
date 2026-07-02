<script lang="ts">
  import IconMoreHoriz from 'virtual:icons/material-symbols/more-horiz';
  import IconFolder from 'virtual:icons/material-symbols/folder';
  import { keyToName } from '$lib/storage/utils.js';
  import type { StorageObject } from '$lib/storage/types.js';
  import { getStorageState } from '$lib/storage/context.js';
  import { storageCutCopyEnabled, storagePasteEnabled } from '$lib/client/feature-flags.js';

  interface Props {
    folder: StorageObject;
  }

  let { folder }: Props = $props();

  const storage = getStorageState();

  const selected = $derived(storage.selectedKeys.has(folder.key));
  const isCtx = $derived(storage.contextMenu?.key === folder.key);
  const isCut = $derived(storage.isCutKey(folder.key));

  let dragOver = $state(false);

  function handleDragStart(e: DragEvent) {
    if (!storageCutCopyEnabled || storage.isInArchive) return;
    e.dataTransfer?.setData(
      'application/x-storage-keys',
      JSON.stringify([...storage.selectedKeys])
    );
    e.dataTransfer!.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent) {
    if (!storagePasteEnabled || storage.isInArchive) return;
    // Don't allow dropping onto a selected folder (moving into itself)
    if (storage.selectedKeys.has(folder.key)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    dragOver = false;
    if (!storagePasteEnabled || storage.isInArchive) return;
    e.preventDefault();
    const raw = e.dataTransfer?.getData('application/x-storage-keys');
    if (!raw) return;
    try {
      const keys: string[] = JSON.parse(raw);
      // Don't drop onto a selected folder
      if (keys.includes(folder.key)) return;
      // Move items into this folder
      void storage.performMove(folder.key, keys);
    } catch {
      // invalid JSON - ignore
    }
  }
</script>

<tr
  class="
    group cursor-pointer select-none
    {isCut ? 'opacity-40' : ''}
    {dragOver ? 'bg-primary/20 outline-primary/50 outline -outline-offset-2' : ''}
    {isCtx
    ? 'bg-base-300 outline-base-content/30 outline -outline-offset-2'
    : selected
      ? 'bg-primary/10 hover:bg-primary/15'
      : 'hover:bg-base-200/60'}"
  draggable={storageCutCopyEnabled && !storage.isInArchive}
  ondragstart={handleDragStart}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  onclick={(e) => {
    if (storage.selectionMode || e.ctrlKey || e.metaKey) {
      storage.toggleSelect(folder.key, true);
    } else if (storage.isInArchive) {
      storage.navigateInArchive(folder.key);
    } else {
      storage.navigate(folder.key);
    }
  }}
  ondblclick={(e) => {
    if (e.ctrlKey || e.metaKey) {
      if (storage.isInArchive) {
        storage.navigateInArchive(folder.key);
      } else {
        storage.navigate(folder.key);
      }
    }
  }}
  oncontextmenu={(e) => storage.openContextMenu(e, folder.key)}
>
  <td class="pr-0">
    <input
      type="checkbox"
      class="checkbox checkbox-xs {!storage.showCheckboxes ? 'pointer-events-none invisible' : ''}"
      checked={selected}
      onchange={() => storage.toggleSelect(folder.key, true)}
      onclick={(e) => e.stopPropagation()}
      disabled={!storage.showCheckboxes}
      aria-label="Select {keyToName(folder.key)}"
    />
  </td>
  <td>
    <div class="flex items-center gap-2.5">
      <IconFolder class="text-warning pointer-events-none size-5 shrink-0" aria-hidden="true" />
      <span class="font-medium">{keyToName(folder.key)}</span>
    </div>
  </td>
  <td class="text-base-content/30 text-right">—</td>
  <td class="text-base-content/30">—</td>
  <td class="w-10 py-0 pr-2 text-right">
    <button
      class="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100"
      title="Actions"
      aria-label="Actions for {keyToName(folder.key)}"
      onclick={(e) => storage.openContextMenu(e, folder.key)}
    >
      <IconMoreHoriz class="size-4" aria-hidden="true" />
    </button>
  </td>
</tr>
