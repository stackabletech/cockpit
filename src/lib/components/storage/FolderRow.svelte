<script lang="ts">
  import Icon from '@iconify/svelte';
  import { keyToName } from '$lib/storage/utils.js';
  import type { StorageObject } from '$lib/storage/types.js';

  interface Props {
    folder: StorageObject;
    selected: boolean;
    isCtx: boolean;
    showCheckboxes: boolean;
    onNavigate: (prefix: string) => void;
    onToggleSelect: (key: string, force?: boolean) => void;
    onContextMenu: (e: MouseEvent, key: string) => void;
  }

  let {
    folder,
    selected,
    isCtx,
    showCheckboxes,
    onNavigate,
    onToggleSelect,
    onContextMenu
  }: Props = $props();
</script>

<tr
  class="
    group cursor-pointer select-none
    {isCtx
    ? 'bg-base-300 outline-base-content/30 outline -outline-offset-2'
    : selected
      ? 'bg-primary/10 hover:bg-primary/15'
      : 'hover'}"
  onclick={(e) => {
    if (showCheckboxes || e.ctrlKey || e.metaKey) {
      onToggleSelect(folder.key, true);
    } else {
      onNavigate(folder.key);
    }
  }}
  ondblclick={(e) => {
    if (e.ctrlKey || e.metaKey) {
      onNavigate(folder.key);
    }
  }}
  oncontextmenu={(e) => onContextMenu(e, folder.key)}
>
  <td class="pr-0">
    <input
      type="checkbox"
      class="checkbox checkbox-xs {!showCheckboxes ? 'pointer-events-none invisible' : ''}"
      checked={selected}
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
      onclick={(e) => onContextMenu(e, folder.key)}
    >
      <Icon icon="material-symbols:more-horiz" class="size-4" aria-hidden="true" />
    </button>
  </td>
</tr>
