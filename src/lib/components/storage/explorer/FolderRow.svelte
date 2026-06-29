<script lang="ts">
  import IconMoreHoriz from 'virtual:icons/material-symbols/more-horiz';
  import IconFolder from 'virtual:icons/material-symbols/folder';
  import { keyToName } from '$lib/storage/utils.js';
  import type { StorageObject } from '$lib/storage/types.js';
  import { getStorageState } from '$lib/storage/context.js';

  interface Props {
    folder: StorageObject;
  }

  let { folder }: Props = $props();

  const storage = getStorageState();

  const selected = $derived(storage.selectedKeys.has(folder.key));
  const isCtx = $derived(storage.contextMenu?.key === folder.key);
</script>

<tr
  class="
    group cursor-pointer select-none
    {isCtx
    ? 'bg-base-300 outline-base-content/30 outline -outline-offset-2'
    : selected
      ? 'bg-primary/10 hover:bg-primary/15'
      : 'hover:bg-base-200/60'}"
  onclick={(e) => {
    if (storage.selectionMode || e.ctrlKey || e.metaKey) {
      storage.toggleSelect(folder.key, true);
    } else {
      storage.navigate(folder.key);
    }
  }}
  ondblclick={(e) => {
    if (e.ctrlKey || e.metaKey) {
      storage.navigate(folder.key);
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
