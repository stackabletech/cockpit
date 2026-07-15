<script lang="ts">
  import IconVisibility from 'virtual:icons/material-symbols/visibility';
  import IconDownload from 'virtual:icons/material-symbols/download';
  import IconInfo from 'virtual:icons/material-symbols/info';
  import IconDelete from 'virtual:icons/material-symbols/delete';
  import IconRefresh from 'virtual:icons/material-symbols/refresh';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageState } from '$lib/storage/context.js';

  const storage = getStorageState();

  const selectedCount = $derived(storage.selectedKeys.size);
  const canPreview = $derived(
    storage.selectedFiles.length === 1 && storage.selectedFolders.length === 0
  );
  const canDownload = $derived(
    storage.selectedFiles.length === 1 && storage.selectedFolders.length === 0
  );
</script>

<tr class="border-primary/20 bg-primary/5 z-30 border-t">
  <th colspan={5} class="px-4 py-1.5 font-normal">
    <div class="flex items-center gap-1">
      <span class="text-base-content/50 mr-1 text-xs">
        {m.storage_selected({ count: selectedCount })}
      </span>

      <button
        class="btn btn-ghost btn-xs gap-1"
        title={m.storage_action_preview()}
        onclick={() => storage.executeAction('preview')}
        disabled={!canPreview}
      >
        <IconVisibility class="size-3.5" aria-hidden="true" />
        {m.storage_action_preview()}
      </button>

      <button
        class="btn btn-ghost btn-xs gap-1"
        title={m.storage_action_download()}
        onclick={() => storage.executeAction('download')}
        disabled={!canDownload}
      >
        <IconDownload class="size-3.5" aria-hidden="true" />
        {m.storage_action_download()}
      </button>

      <button
        class="btn btn-ghost btn-xs gap-1"
        title={m.storage_action_details()}
        onclick={() => storage.executeAction('details')}
        disabled={selectedCount !== 1}
      >
        <IconInfo class="size-3.5" aria-hidden="true" />
        {m.storage_action_details()}
      </button>

      {#if !storage.isInArchive}
        <button
          class="
            btn btn-ghost btn-xs gap-1
            {selectedCount > 0 ? 'text-error hover:bg-error/10' : ''}
          "
          title="{m.storage_action_delete()} (Del)"
          onclick={() => storage.executeAction('delete')}
          disabled={selectedCount === 0}
        >
          <IconDelete class="size-3.5" aria-hidden="true" />
          {m.storage_action_delete()}
        </button>
      {/if}

      <div class="ml-auto">
        <button
          class="btn btn-ghost btn-xs gap-1 text-white"
          title={m.storage_action_refresh()}
          onclick={() => storage.refresh()}
          disabled={storage.loading}
        >
          <IconRefresh class="size-3.5" aria-hidden="true" />
          {m.storage_action_refresh()}
        </button>
      </div>
    </div>
  </th>
</tr>
