<script lang="ts">
  import IconError from 'virtual:icons/material-symbols/error';
  import IconCheckCircle from 'virtual:icons/material-symbols/check-circle';
  import IconBlock from 'virtual:icons/material-symbols/block';
  import IconSchedule from 'virtual:icons/material-symbols/schedule';
  import * as m from '$lib/paraglide/messages.js';
  import type { FileEntry } from './types.js';

  interface Props {
    entry: FileEntry;
  }

  let { entry }: Props = $props();

  let nameOnly = $derived(
    entry.resolution === 'rename' && entry.customName.trim()
      ? entry.customName.trim()
      : (entry.targetKey.split('/').at(-1) ?? entry.file.name)
  );
</script>

<li class="px-4 py-2.5">
  <div class="flex items-center gap-2 text-sm">
    {#if entry.status === 'done'}
      <IconCheckCircle class="text-success size-4 shrink-0" aria-hidden="true" />
    {:else if entry.status === 'error'}
      <IconError class="text-error size-4 shrink-0" aria-hidden="true" />
    {:else if entry.status === 'skipped'}
      <IconBlock class="text-base-content/30 size-4 shrink-0" aria-hidden="true" />
    {:else if entry.status === 'uploading'}
      <span class="loading loading-spinner loading-xs text-primary shrink-0" aria-hidden="true"
      ></span>
    {:else}
      <IconSchedule class="text-base-content/30 size-4 shrink-0" aria-hidden="true" />
    {/if}
    <span class="min-w-0 flex-1 truncate">{nameOnly}</span>
    <span class="text-base-content/50 shrink-0 text-xs">
      {#if entry.status === 'uploading'}
        {entry.progress}%
      {:else if entry.status === 'done'}
        {m.storage_upload_status_done()}
      {:else if entry.status === 'skipped'}
        {m.storage_upload_status_skipped()}
      {:else if entry.status === 'error'}
        {m.storage_upload_status_failed()}
      {:else}
        {m.storage_upload_status_queued()}
      {/if}
    </span>
  </div>
  {#if entry.status === 'uploading'}
    <progress
      class="progress progress-primary mt-1.5 w-full"
      value={entry.progress}
      max="100"
      aria-valuenow={entry.progress}
      aria-valuemin={0}
      aria-valuemax={100}
    ></progress>
  {/if}
  {#if entry.status === 'error' && entry.errorMessage}
    <p class="text-error mt-1 text-xs">{entry.errorMessage}</p>
  {/if}
</li>
