<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { formatFileSize } from '$lib/storage/utils.js';
  import type { DirectoryChildItem } from '$lib/storage/details-types.js';
  import TimestampDisplay from '$lib/components/storage/shared/TimestampDisplay.svelte';
  import IconFolder from 'virtual:icons/material-symbols/folder';
  import IconDescription from 'virtual:icons/material-symbols/description';

  interface Props {
    items: DirectoryChildItem[];
  }

  let { items }: Props = $props();
</script>

<div class="overflow-x-auto">
  <table class="table-xs table">
    <thead>
      <tr>
        <th class="w-6" aria-hidden="true"></th>
        <th>{m.storage_details_name()}</th>
        <th class="text-right">{m.storage_details_size()}</th>
        <th>{m.storage_details_last_modified()}</th>
      </tr>
    </thead>
    <tbody>
      {#each items as item (item.name)}
        <tr class="hover:bg-base-200/50">
          <td class="text-base-content/50 p-1" aria-hidden="true">
            {#if item.isDirectory}
              <IconFolder class="text-warning size-4" />
            {:else}
              <IconDescription class="text-base-content/50 size-4" />
            {/if}
          </td>
          <td class="font-mono text-sm">
            {item.name}
          </td>
          <td class="text-right font-mono text-sm tabular-nums">
            {formatFileSize(item.size)}
          </td>
          <td class="text-sm">
            {#if item.lastModified}
              <TimestampDisplay date={item.lastModified} tooltip="tooltip-left" />
            {:else}
              <span class="text-base-content/40">—</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
