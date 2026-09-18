<script lang="ts">
  import IconDriveFileMove from 'virtual:icons/material-symbols/drive-file-move-outline';
  import IconFolder from 'virtual:icons/material-symbols/folder-outline';
  import IconDescription from 'virtual:icons/material-symbols/description-outline';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import { formatFileSize } from '$lib/storage/utils.js';

  interface MoveItem {
    key: string;
    name: string;
    isDirectory: boolean;
    size?: number;
  }

  interface Props {
    open?: boolean;
    keys: string[];
    destPrefix: string;
    items: MoveItem[];
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { open = $bindable(false), keys, destPrefix, items, onConfirm, onCancel }: Props = $props();

  const destination = $derived(destPrefix || '/');

  const totalSize = $derived(
    items
      .filter((i) => !i.isDirectory && i.size !== undefined)
      .reduce((acc, i) => acc + (i.size ?? 0), 0)
  );

  const hasSizes = $derived(items.some((i) => !i.isDirectory && i.size !== undefined));

  // Limit item list to 8 items to keep dialog compact
  const MAX_VISIBLE = 8;
  const visibleItems = $derived(items.slice(0, MAX_VISIBLE));
  const hiddenCount = $derived(Math.max(0, items.length - MAX_VISIBLE));
</script>

<Modal bind:open class="modal">
  <div class="modal-box max-w-md">
    <h3 class="mb-1 flex items-center gap-2 text-lg font-bold">
      <IconDriveFileMove class="size-5 shrink-0" aria-hidden="true" />
      {m.storage_move_confirm_title()}
    </h3>

    <p class="text-base-content/70 mt-2 text-sm">
      {m.storage_move_confirm_body({ count: keys.length, destination })}
    </p>

    <ul
      class="bg-base-200/50 mt-3 max-h-40 overflow-y-auto rounded-lg p-2 text-sm"
      aria-label={m.storage_move_confirm_title()}
    >
      {#each visibleItems as item (item.key)}
        <li class="flex items-center gap-2 py-0.5">
          {#if item.isDirectory}
            <IconFolder class="text-warning size-4 shrink-0" aria-hidden="true" />
          {:else}
            <IconDescription class="text-base-content/50 size-4 shrink-0" aria-hidden="true" />
          {/if}
          <span class="min-w-0 flex-1 truncate">{item.name}</span>
          {#if !item.isDirectory && item.size !== undefined}
            <span class="text-base-content/40 shrink-0 font-mono text-xs"
              >{formatFileSize(item.size)}</span
            >
          {/if}
        </li>
      {/each}
      {#if hiddenCount > 0}
        <li class="text-base-content/40 py-0.5 pl-6 text-xs">
          {m.storage_move_confirm_more({ count: hiddenCount })}
        </li>
      {/if}
    </ul>

    {#if hasSizes && totalSize > 0}
      <p class="text-base-content/50 mt-2 text-xs">
        {m.storage_move_confirm_total_size({ size: formatFileSize(totalSize) })}
      </p>
    {/if}

    <div class="modal-action mt-6">
      <button class="btn btn-ghost btn-sm" onclick={onCancel}>
        {m.storage_move_confirm_cancel()}
      </button>
      <button class="btn btn-primary btn-sm" onclick={onConfirm}>
        {m.storage_move_confirm_label()}
      </button>
    </div>
  </div>
</Modal>
