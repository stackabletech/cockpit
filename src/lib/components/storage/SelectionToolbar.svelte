<script lang="ts">
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    /** Total number of selected items. */
    selectedCount: number;
    canPreview: boolean;
    canDownload: boolean;
    onAction: (action: string) => void;
  }

  let { selectedCount, canPreview, canDownload, onAction }: Props = $props();
</script>

<tr class="border-primary/20 bg-primary/5 border-t">
  <th colspan={5} class="px-4 py-1.5 font-normal">
    <div class="flex items-center gap-1">
      <span class="text-base-content/50 mr-1 text-xs">
        {m.storage_selected({ count: selectedCount })}
      </span>

      <button
        class="btn btn-ghost btn-xs gap-1"
        title={m.storage_action_preview()}
        onclick={() => onAction('preview')}
        disabled={!canPreview}
      >
        <Icon icon="material-symbols:visibility" class="size-3.5" aria-hidden="true" />
        {m.storage_action_preview()}
      </button>

      <button
        class="btn btn-ghost btn-xs gap-1"
        title={m.storage_action_download()}
        onclick={() => onAction('download')}
        disabled={!canDownload}
      >
        <Icon icon="material-symbols:download" class="size-3.5" aria-hidden="true" />
        {m.storage_action_download()}
      </button>

      <button
        class="btn btn-ghost btn-xs gap-1"
        title={m.storage_action_move()}
        onclick={() => onAction('move')}
        disabled={selectedCount === 0}
      >
        <Icon icon="material-symbols:drive-file-move" class="size-3.5" aria-hidden="true" />
        {m.storage_action_move()}
      </button>

      <button
        class="
          btn text-error btn-ghost btn-xs hover:bg-error/10
          gap-1
        "
        title="{m.storage_action_delete()} (Del)"
        onclick={() => onAction('delete')}
        disabled={selectedCount === 0}
      >
        <Icon icon="material-symbols:delete" class="size-3.5" aria-hidden="true" />
        {m.storage_action_delete()}
      </button>
    </div>
  </th>
</tr>
